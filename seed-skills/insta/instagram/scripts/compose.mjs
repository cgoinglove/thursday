#!/usr/bin/env node
/**
 * Takes pictures through Instagram's post composer up to its last screen — files,
 * crop set to the post's ratio (the composer starts every post at square), past
 * filters, caption typed, AI label set — and stops there. It never presses Share:
 * that is one click on the last screen's header, made only once posting is allowed.
 *
 *   node compose.mjs --ratio 4:5 --caption caption.txt [--ai-label] [--shot last.png] <picture>...
 *   node compose.mjs --discard        close an open composer and throw its draft away
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { shipped } from "./lib.mjs";
import { SEL } from "./selectors.mjs";

const { fail, inPage, orFail, parseArgs } = await shipped(
  "browser/scripts/session.mjs",
);

const opts = parseArgs();

if (opts.discard) {
  const done = orFail(
    await inPage(
      async (page, { SEL }) => {
        for (let i = 0; i < 3; i++) {
          const open = await page.locator(SEL.composer).count();
          if (!open) return { closed: true };
          const last = page.locator(SEL.composer).last();
          // The discard question: a small dialog of two buttons, the first one destructive
          const confirm =
            (await last.getAttribute("aria-label")) === null &&
            (await last.locator("button, [role=button]").count()) === 2 &&
            (await last.locator(SEL.caption).count()) === 0;
          if (confirm)
            await last.locator("button, [role=button]").first().click();
          else await page.keyboard.press("Escape");
          await page.waitForTimeout(1000);
        }
        return (await page.locator(SEL.composer).count())
          ? {
              error:
                "The composer did not close. Snapshot it and close it by hand.",
            }
          : { closed: true };
      },
      { SEL },
    ),
  );
  if (done.closed) console.log("No composer open; any draft was discarded.");
  process.exit(0);
}

const files = opts._.map((f) => resolve(f));
const ratio = String(opts.ratio ?? "");
if (!files.length || !SEL.cropOptions.includes(ratio) || !opts.caption)
  fail(
    `usage: node compose.mjs --ratio ${SEL.cropOptions.join("|")} --caption <file> [--ai-label] [--shot last.png] <picture>...`,
  );
if (files.length > 20) fail("A post holds at most 20 pictures.");
const caption = readFileSync(opts.caption, "utf8").replace(/\r/g, "").trim();
if (caption.length > 2200)
  fail(`The caption is ${caption.length} characters; the limit is 2200.`);

const started = Date.now();
const done = orFail(
  await inPage(
    async (page, { files, ratio, caption, aiLabel, shot, SEL }) => {
      const dialog = () => page.locator(SEL.composer).last();
      if (
        (await page.locator(`${SEL.composer} ${SEL.caption}`).count()) ||
        (await page.locator(`${SEL.composer} ${SEL.fileInput}`).count())
      )
        return {
          error:
            "A composer is already open. Run with --discard first, or finish it by hand.",
        };
      if (
        !/instagram\.com/.test(page.url()) ||
        /\/accounts\/|\/challenge\//.test(page.url())
      )
        await page.goto("https://www.instagram.com/", {
          waitUntil: "domcontentloaded",
        });

      // A narrow window swaps the sidebar for a bottom bar in another order: work wide
      const viewport = page.viewportSize();
      if (viewport && viewport.width < SEL.wideWidth)
        await page.setViewportSize({
          width: SEL.wideWidth,
          height: Math.max(viewport.height, 900),
        });

      // Create, then the menu's first entry (Post), until a dialog takes files. The
      // menu's entries land in the page right after Create's own link
      const shown = () =>
        page.locator(SEL.sidebarAction).evaluateAll((all) =>
          all.map((a, i) => ({
            i,
            x: a.getBoundingClientRect().x,
            w: a.getBoundingClientRect().width,
          })),
        );
      await page
        .locator(SEL.sidebarAction)
        .first()
        .waitFor({ timeout: 15000 })
        .catch(() => {});
      const side = (await shown()).filter((a) => a.w > 0 && a.x < 120);
      if (side.length <= SEL.createIndex)
        return {
          error:
            "Selectors changed: no Create entry in the sidebar (SEL.sidebarAction). Snapshot and fix selectors.mjs.",
        };
      const create = side[SEL.createIndex].i;
      const input = page.locator(`${SEL.composer} ${SEL.fileInput}`);
      // Twice at most: a menu left open closes on the first press
      for (let i = 0; i < 2 && !(await input.count()); i++) {
        const count = await page.locator(SEL.sidebarAction).count();
        await page.locator(SEL.sidebarAction).nth(create).click();
        await page.waitForTimeout(1000);
        if ((await page.locator(SEL.sidebarAction).count()) > count) {
          await page
            .locator(SEL.sidebarAction)
            .nth(create + 1)
            .click();
          await input
            .waitFor({ state: "attached", timeout: 8000 })
            .catch(() => {});
        }
      }
      if (!(await input.count())) {
        await page.keyboard.press("Escape");
        return {
          error:
            "Selectors changed: Create did not open a composer that takes files (SEL.createIndex). Snapshot and fix selectors.mjs.",
        };
      }
      await input.setInputFiles(files);

      // The crop step: files taken, a preview drawn
      const cropping = await page
        .waitForFunction(
          (SEL) => {
            const d = [...document.querySelectorAll(SEL.composer)].at(-1);
            return (
              d &&
              !d.querySelector(SEL.fileInput) &&
              [...d.querySelectorAll(SEL.preview)].some(
                (i) => i.getBoundingClientRect().width > 200,
              )
            );
          },
          SEL,
          { timeout: 30000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!cropping)
        return {
          error:
            "The composer did not reach its crop step after the files went in (a file refused, or the page changed). Snapshot and look.",
        };

      // The crop toggle is the leftmost icon along the preview's bottom edge
      const toggled = await dialog().evaluate((d) => {
        const box = d.getBoundingClientRect();
        const icons = [...d.querySelectorAll("button, [role=button]")]
          .filter((b) => !b.innerText.trim() && b.querySelector("svg"))
          .map((b) => ({ b, r: b.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.bottom > box.bottom - 90)
          .sort((a, b) => a.r.x - b.r.x);
        if (!icons.length) return false;
        icons[0].b.setAttribute("data-kit-crop", "");
        return true;
      });
      if (!toggled)
        return {
          error:
            "Selectors changed: no crop control on the crop step. Snapshot and fix compose.mjs.",
        };
      await page.locator("[data-kit-crop]").first().click();
      await page.waitForTimeout(700);
      const picked = await dialog().evaluate((d, ratio) => {
        const options = [...d.querySelectorAll("button, [role=button]")];
        const square = options.findIndex((b) =>
          b.textContent.trim().startsWith("1:1"),
        );
        if (square < 1) return false;
        const target =
          ratio === "original"
            ? options[square - 1]
            : options.find((b) => b.textContent.trim().startsWith(ratio));
        if (!target) return false;
        target.setAttribute("data-kit-ratio", "");
        return true;
      }, ratio);
      if (!picked)
        return {
          error:
            "Selectors changed: the crop menu has no ratio options. Snapshot and fix compose.mjs.",
        };
      await page.locator("[data-kit-ratio]").click();
      await page.waitForTimeout(800);
      // The crop is the frame the picture shows through, not the picture itself
      const measured = await dialog().evaluate((d, preview) => {
        const el = [...d.querySelectorAll(preview)]
          .filter((e) => e.getBoundingClientRect().width > 200)
          .sort(
            (a, b) =>
              b.getBoundingClientRect().width - a.getBoundingClientRect().width,
          )[0];
        if (!el) return null;
        let { left, top, right, bottom } = el.getBoundingClientRect();
        for (
          let a = el.parentElement;
          a && a !== d.parentElement;
          a = a.parentElement
        ) {
          if (getComputedStyle(a).overflow === "visible") continue;
          const r = a.getBoundingClientRect();
          left = Math.max(left, r.left);
          top = Math.max(top, r.top);
          right = Math.min(right, r.right);
          bottom = Math.min(bottom, r.bottom);
        }
        return bottom > top ? (right - left) / (bottom - top) : null;
      }, SEL.preview);
      const want = { "1:1": 1, "4:5": 0.8, "16:9": 16 / 9 }[ratio];
      if (want && (!measured || Math.abs(measured - want) / want > 0.03))
        return {
          error: `The crop did not take: the preview is ${measured?.toFixed(3)} wide per tall, not ${ratio}. Snapshot and set it by hand.`,
        };
      await page
        .locator("[data-kit-crop]")
        .first()
        .click()
        .catch(() => {});

      // Crop, then filters, then the caption: two Nexts and never a third, since the
      // caption step's header button in the same place is Share
      for (let i = 0; i < 2; i++) {
        if (await dialog().locator(SEL.caption).count()) break;
        const before = await dialog().getAttribute("aria-label");
        const next = await dialog().evaluate((d) => {
          const top = d.getBoundingClientRect().top;
          const header = [...d.querySelectorAll("button, [role=button]")]
            .map((b) => ({ b, r: b.getBoundingClientRect() }))
            .filter(
              ({ b, r }) =>
                b.innerText.trim() && r.width > 0 && r.top < top + 60,
            )
            .sort((a, b) => b.r.x - a.r.x)[0];
          if (!header) return false;
          for (const e of d.querySelectorAll("[data-kit-next]"))
            e.removeAttribute("data-kit-next");
          header.b.setAttribute("data-kit-next", "");
          return true;
        });
        if (!next)
          return {
            error:
              "Selectors changed: no Next in the composer's header. Snapshot and go on by hand.",
          };
        await dialog().locator("[data-kit-next]").click();
        await page
          .waitForFunction(
            ([sel, before]) =>
              [...document.querySelectorAll(sel)]
                .at(-1)
                ?.getAttribute("aria-label") !== before,
            [SEL.composer, before],
            { timeout: 10000 },
          )
          .catch(() => {});
      }
      const box = dialog().locator(SEL.caption).first();
      await box.waitFor({ timeout: 10000 }).catch(() => {});
      if (!(await box.count()))
        return {
          error:
            "The composer did not reach its caption step in two Nexts. Snapshot and go on by hand.",
        };

      let label = null;
      const toggle = dialog().locator(SEL.aiLabel).first();
      if (await toggle.count()) {
        // The input itself does not take a click; the switch drawn around it does
        if ((await toggle.isChecked()) !== aiLabel)
          await toggle.locator("xpath=..").click({ timeout: 5000 });
        await page.waitForTimeout(400);
        label = await toggle.isChecked();
      }
      await box.click();
      const lines = caption.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (i) await page.keyboard.press("Enter");
        if (lines[i]) await page.keyboard.insertText(lines[i]);
      }
      await page.waitForTimeout(500);
      const typed = (await box.innerText()).replace(/\r/g, "").trim();

      // Close the tag suggestions typing a # opens, without Escape (which asks to discard)
      await dialog()
        .locator("h1, h2, [role=heading]")
        .first()
        .click({ timeout: 3000 })
        .catch(() => {});
      await page.waitForTimeout(300);
      if (shot) await dialog().screenshot({ path: shot, scale: "css" });
      if (viewport && viewport.width < SEL.wideWidth)
        await page.setViewportSize(viewport);
      return { measured, typed, label };
    },
    {
      files,
      ratio,
      caption,
      aiLabel: Boolean(opts["ai-label"]),
      shot: opts.shot ? resolve(opts.shot) : null,
      SEL,
    },
  ),
);

const same = done.typed.replace(/\s+/g, " ") === caption.replace(/\s+/g, " ");
console.log(
  `On the last screen: ${files.length} picture(s) at ${ratio}${done.measured ? ` (preview ${done.measured.toFixed(3)})` : ""}, ` +
    `caption ${done.typed.length} chars${same ? "" : " — NOT the same as the file; fix it in the composer"}, ` +
    `AI label ${done.label === null ? "not offered" : done.label ? "on" : "off"}. Share is not pressed.` +
    `${opts.shot ? ` Screenshot: ${resolve(opts.shot)}.` : ""} ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
if (!same) process.exit(1);
