#!/usr/bin/env node
/**
 * Reads one DM thread into a JSONL file, oldest first, by walking its message pane
 * up from the newest message. Opening a thread marks it seen.
 *
 *   node read.mjs <thread id | thread url> --out <file.jsonl>
 *     [--since 2026-09-01] [--max 200] [--tail 10]
 *
 * Stops at whichever comes first: --max messages, a message older than --since,
 * the top of the thread, or two rounds that brought nothing new.
 */
import { writeFileSync } from "node:fs";
import { oneLine, shipped, stamp } from "./lib.mjs";
import { SEL } from "./selectors.mjs";

const { fail, inPage, orFail, parseArgs } = await shipped(
  "browser/scripts/session.mjs",
);

const opts = parseArgs();
const target = opts._[0];
if (!target || !opts.out)
  fail(
    "usage: node read.mjs <thread id | url> --out <file.jsonl> [--since YYYY-MM-DD] [--max 200] [--tail 10]",
  );
const id = String(target).match(/(\d{6,})/)?.[1];
if (!id) fail(`Not a thread id or url: ${target}`);
const url = `https://www.instagram.com/direct/t/${id}/`;
const max = Number(opts.max ?? 200);
const since = opts.since ? new Date(opts.since).getTime() : null;
if (opts.since && Number.isNaN(since))
  fail(`--since is not a date: ${opts.since}`);
const tail = Number(opts.tail ?? 10);
/** Each round is one browser call of a few screens; this caps a runaway thread. */
const ROUNDS = 60;

/**
 * One round: a few screens of the pane, each read and then moved up by most of a
 * screen. The pane unmounts rows that leave the screen, so it is walked, never
 * jumped to the top: a jump skips everything in between.
 */
async function round(page, { SEL, url, first, steps }) {
  const extract = (SEL) => {
    if (/\/accounts\/login|\/challenge\//.test(location.pathname))
      return { error: `Not signed in (${location.pathname}).` };
    const pane = [...document.querySelectorAll("main *")].find(
      (e) =>
        e.clientHeight > 200 &&
        !e.closest(SEL.inboxList) &&
        /(auto|scroll)/.test(getComputedStyle(e).overflowY) &&
        e.querySelector(SEL.messageRow),
    );
    if (!pane)
      return {
        error: document.querySelector("main")
          ? "Selectors changed: no message pane (SEL.messageRow). Snapshot the thread once and fix selectors.mjs."
          : "No thread on the page: something covers it (a dialog, a daily time-limit screen). Snapshot, close it, run again.",
      };
    pane.setAttribute("data-read-pane", "");
    const fiberOf = (el) =>
      el[Object.keys(el).find((k) => k.startsWith("__reactFiber"))];
    const findProp = (el, name) => {
      for (let f = fiberOf(el), d = 0; f && d < 40; f = f.return, d++) {
        const p = f.memoizedProps;
        if (p && typeof p === "object" && p[name] != null) return p[name];
      }
      return null;
    };
    const paneBox = pane.getBoundingClientRect();
    const messages = [];
    for (const row of pane.querySelectorAll(SEL.messageRow)) {
      const body = row.querySelector(SEL.messageBody);
      if (!body) continue; // a date line, a "seen" line
      const ref = findProp(row, SEL.messageRefProp);
      const deep =
        body.querySelector("[dir=auto], img, video, a") ??
        body.firstElementChild ??
        body;
      let outgoing = findProp(deep, SEL.outgoingProp);
      if (typeof outgoing !== "boolean") {
        // Heuristic: no flag on the row, so a bubble nearer the right edge is the account's own
        const box = body.getBoundingClientRect();
        outgoing = box.left - paneBox.left > paneBox.right - box.right;
      }
      messages.push({
        id: ref?.id ?? null,
        ts: ref?.timestamp_ms ? Number(ref.timestamp_ms) : null,
        from: outgoing ? "me" : "them",
        sender: ref?.sender_fbid ?? null,
        text: body.innerText.trim(),
        images: [...body.querySelectorAll("img")]
          .filter((i) => i.getBoundingClientRect().width >= SEL.minImagePx)
          .map((i) => i.currentSrc || i.src),
        video: body.querySelector("video") !== null,
        links: [
          ...new Set(
            [...body.querySelectorAll("a[href]")]
              .map((a) => a.href)
              .filter((h) => h.startsWith("http")),
          ),
        ],
      });
    }
    // A column-reverse pane counts scrollTop from the bottom, as zero and below
    const reversed = getComputedStyle(pane).flexDirection === "column-reverse";
    const atTop = reversed
      ? Math.abs(pane.scrollTop) + pane.clientHeight >= pane.scrollHeight - 2
      : pane.scrollTop <= 1;
    return { messages, atTop, height: pane.scrollHeight };
  };

  if (first) {
    if (!page.url().startsWith(url)) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page
        .waitForFunction(
          (SEL) => document.querySelector(`main ${SEL.messageBody}`),
          SEL,
          { timeout: 20000 },
        )
        .catch(() => {});
    }
    await page.waitForTimeout(800);
    const found = await page.evaluate(extract, SEL);
    if (found.error) return found;
    // Start from the newest message, wherever an earlier look left the pane
    await page.evaluate(() => {
      const pane = document.querySelector("[data-read-pane]");
      pane.scrollTop =
        getComputedStyle(pane).flexDirection === "column-reverse"
          ? 0
          : pane.scrollHeight;
    });
    await page.waitForTimeout(500);
  }

  const messages = [];
  let moved = Number.POSITIVE_INFINITY;
  for (let s = 0; s < steps; s++) {
    const seen = await page.evaluate(extract, SEL);
    if (seen.error) return seen;
    messages.push(...seen.messages);
    // At the top, or held in place while older rows load: wait for the pane to grow
    if (seen.atTop || moved < 10) {
      const grew = await page
        .waitForFunction(
          (height) =>
            (document.querySelector("[data-read-pane]")?.scrollHeight ?? 0) >
            height,
          seen.height,
          { timeout: 5000 },
        )
        .then(() => true)
        .catch(() => false);
      if (!grew && seen.atTop) return { messages, top: true };
      await page.waitForTimeout(300);
    }
    moved = await page.evaluate(() => {
      const pane = document.querySelector("[data-read-pane]");
      const before = pane.scrollTop;
      pane.scrollTop -= pane.clientHeight * 0.8;
      return Math.abs(pane.scrollTop - before);
    });
    await page.waitForTimeout(350);
  }
  return { messages, top: false };
}

const started = Date.now();
const byKey = new Map();
let fallbackKeys = 0;
let stop = `the round limit (${ROUNDS})`;
let quiet = 0;
for (let i = 0; i < ROUNDS; i++) {
  const r = orFail(await inPage(round, { SEL, url, first: i === 0, steps: 5 }));
  if (i === 0 && r.messages.length === 0)
    fail(
      "Selectors changed: the pane has rows but no message was read (SEL.messageBody). Fix selectors.mjs.",
    );
  let fresh = 0;
  for (const m of r.messages) {
    // Heuristic when the row carries no message id: side + time + text stand in for one
    const key =
      m.id ?? `${m.from}|${m.ts}|${m.text.slice(0, 120)}|${m.images[0] ?? ""}`;
    const known = byKey.get(key);
    if (known) {
      // A picture that had not loaded on the first sighting may have by now
      known.images = [...new Set([...known.images, ...m.images])];
      known.links = [...new Set([...known.links, ...m.links])];
      if (m.text.length > known.text.length) known.text = m.text;
      continue;
    }
    if (!m.id) fallbackKeys++;
    byKey.set(key, m);
    fresh++;
  }
  quiet = fresh ? 0 : quiet + 1;
  const oldest = Math.min(
    ...[...byKey.values()].map((m) => m.ts ?? Number.POSITIVE_INFINITY),
  );
  if (byKey.size >= max) {
    stop = `--max ${max}`;
    break;
  }
  if (since && oldest < since) {
    stop = `--since ${opts.since}`;
    break;
  }
  if (r.top) {
    stop = "the top of the thread";
    break;
  }
  if (quiet >= 2) {
    stop = "two rounds with nothing new";
    break;
  }
}

let messages = [...byKey.values()].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
if (since) messages = messages.filter((m) => m.ts == null || m.ts >= since);
messages = messages.slice(-max);
writeFileSync(
  opts.out,
  messages
    .map((m) => JSON.stringify({ ...m, at: m.ts ? stamp(m.ts) : null }))
    .join("\n") + (messages.length ? "\n" : ""),
);

const count = (f) => messages.filter(f).length;
console.log(
  `${messages.length} messages (${count((m) => m.from === "me")} from me, ${count((m) => m.from === "them")} from them), ` +
    `${messages.length ? `${stamp(messages[0].ts)} to ${stamp(messages.at(-1).ts)}` : "none"}; ` +
    `${count((m) => m.images.length)} with pictures, ${count((m) => m.links.length)} with links. ` +
    `Stopped at ${stop}. ${((Date.now() - started) / 1000).toFixed(1)}s → ${opts.out}`,
);
if (fallbackKeys)
  console.log(
    `${fallbackKeys} rows had no message id; they were told apart by side, time and text.`,
  );
for (const m of tail > 0 ? messages.slice(-tail) : [])
  console.log(
    `${stamp(m.ts)} ${m.from}: ${oneLine(m.text, 160) || "(no text)"}` +
      `${m.images.length ? ` [${m.images.length} picture]` : ""}${m.links.length ? ` [${m.links[0]}]` : ""}`,
  );
