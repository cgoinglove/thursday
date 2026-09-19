#!/usr/bin/env node
/**
 * Lists DM threads from the inbox page without opening any of them — opening a
 * thread marks it seen. One line a thread: unread mark, name, last message, when, id.
 *
 *   node inbox.mjs [--folder primary|general|requests] [--max 30] [--unread] [--json]
 */
import { oneLine, shipped, stamp } from "./lib.mjs";
import { SEL } from "./selectors.mjs";

const { fail, inPage, orFail, parseArgs } = await shipped(
  "browser/scripts/session.mjs",
);

const opts = parseArgs();
const folder = opts.folder ?? "primary";
if (!SEL.folders[folder])
  fail(`--folder is one of ${Object.keys(SEL.folders).join(", ")}`);
const max = Number(opts.max ?? 30);

const started = Date.now();
const found = orFail(
  await inPage(
    async (page, { url, tab, SEL, max }) => {
      if (!page.url().startsWith(url))
        await page.goto(url, { waitUntil: "domcontentloaded" });
      if (tab != null) {
        const pick = page.locator(SEL.folderTab).nth(tab);
        await pick.waitFor({ timeout: 15000 }).catch(() => {});
        if (
          (await pick.count()) &&
          (await pick.getAttribute("aria-selected")) !== "true"
        )
          await pick.click();
      }
      // Loaded when the list is there and its loading placeholders are gone
      await page
        .waitForFunction(
          (SEL) => {
            const list = document.querySelector(SEL.inboxList);
            return (
              list &&
              (list.querySelector(SEL.inboxRow) ||
                !list.querySelector("[role=status]"))
            );
          },
          SEL,
          { timeout: 15000 },
        )
        .catch(() => {});
      await page.waitForTimeout(500);

      const count = () =>
        page.evaluate(
          (SEL) =>
            document.querySelectorAll(`${SEL.inboxList} ${SEL.inboxRow}`)
              .length,
          SEL,
        );
      // More threads load as the list scrolls
      for (let n = await count(), tries = 0; n < max && tries < 20; tries++) {
        await page.evaluate((SEL) => {
          const row = document.querySelector(
            `${SEL.inboxList} ${SEL.inboxRow}`,
          );
          for (let e = row?.parentElement; e; e = e.parentElement)
            if (e.scrollHeight > e.clientHeight + 4) {
              e.scrollTop = e.scrollHeight;
              break;
            }
        }, SEL);
        const grew = await page
          .waitForFunction(
            ([SEL, n]) =>
              document.querySelectorAll(`${SEL.inboxList} ${SEL.inboxRow}`)
                .length > n,
            [SEL, n],
            { timeout: 3000 },
          )
          .then(() => true)
          .catch(() => false);
        if (!grew) break;
        n = await count();
      }

      return page.evaluate(
        ({ SEL, max }) => {
          if (/\/accounts\/login|\/challenge\//.test(location.pathname))
            return {
              error: `Not signed in (${location.pathname}). Borrow the kept sign-in, goto the inbox, run again.`,
            };
          const list = document.querySelector(SEL.inboxList);
          if (!list)
            return {
              error: document.querySelector("main")
                ? "Selectors changed: no thread list (SEL.inboxList). Snapshot the inbox once and fix selectors.mjs."
                : "No inbox on the page: something covers it (a dialog, a daily time-limit screen). Snapshot, close it, run again.",
            };
          const fiberOf = (el) =>
            el[Object.keys(el).find((k) => k.startsWith("__reactFiber"))];
          const findProp = (el, name) => {
            for (let f = fiberOf(el), d = 0; f && d < 30; f = f.return, d++) {
              const p = f.memoizedProps;
              if (!p || typeof p !== "object") continue;
              if (p[name] != null) return p[name];
              for (const v of Object.values(p))
                if (v && typeof v === "object" && v[name] != null)
                  return v[name];
            }
            return null;
          };
          const rows = [...list.querySelectorAll(SEL.inboxRow)].slice(0, max);
          const threads = rows.map((row) => {
            const lines = row.innerText
              .split("\n")
              .map((l) => l.trim())
              .filter((l) => l && l !== "·");
            const abbr = row.querySelector("abbr");
            return {
              id: findProp(row, SEL.threadIdProp),
              name: lines[0] ?? "",
              last: lines[1] ?? "",
              ago: abbr?.getAttribute("aria-label") || abbr?.innerText || "",
              at: Number(findProp(row, SEL.lastActivityProp)) || null,
              unread: [...row.querySelectorAll("span")].some(
                (s) =>
                  Number(getComputedStyle(s).fontWeight) >= SEL.unreadWeight,
              ),
            };
          });
          if (threads.length && threads.every((t) => !t.id))
            return {
              error:
                "Selectors changed: rows found but no thread id (SEL.threadIdProp). Fix selectors.mjs.",
            };
          return { threads };
        },
        { SEL, max },
      );
    },
    {
      url: `https://www.instagram.com${SEL.folders[folder].url}`,
      tab: SEL.folders[folder].tab,
      SEL,
      max,
    },
  ),
);

let threads = found.threads;
if (opts.unread) threads = threads.filter((t) => t.unread);
if (opts.json) {
  process.stdout.write(`${JSON.stringify(threads)}\n`);
} else {
  for (const t of threads)
    console.log(
      `${t.unread ? "* " : "  "}${oneLine(t.name, 40)} — ${oneLine(t.last, 80)} · ${t.at ? stamp(t.at) : t.ago} · ${t.id ?? "no id"}`,
    );
  const unread = found.threads.filter((t) => t.unread).length;
  console.log(
    `${found.threads.length} threads in ${folder}, ${unread} unread (*). ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}
