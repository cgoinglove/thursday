#!/usr/bin/env node
/**
 * Many pictures as one image, each with a label under it, so one look sees a
 * whole feed: covers side by side, or every slide of one post.
 *
 *   node sheet.mjs --out sheet.png <posts.json>              covers of every post
 *   node sheet.mjs --out sheet.png <posts.json> --post 3     every slide of post 3
 *   node sheet.mjs --out sheet.png <image url | file>...     any pictures
 */
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fail, inPage, orFail, parseArgs } from "./lib.mjs";
import { short } from "./media.mjs";

/** Pictures are fetched by the browser (page.request) and inlined, so the sheet needs no server. */
export async function makeSheet(items, out, cols = 4) {
  return orFail(
    await inPage(
      async (page, { items, out, cols }) => {
        const cells = [];
        for (const it of items) {
          let src = it.data ?? "";
          if (!src && it.src)
            try {
              const r = await page.request.get(it.src, { timeout: 30000 });
              if (r.ok())
                src = `data:${r.headers()["content-type"] ?? "image/jpeg"};base64,${(await r.body()).toString("base64")}`;
            } catch {}
          cells.push({ src, label: it.label });
        }
        const esc = (s) =>
          String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
        const html = `<!doctype html><meta charset="utf-8"><style>
          body{margin:0;background:#fff;font:13px/1.35 system-ui,sans-serif;color:#111}
          .grid{display:grid;grid-template-columns:repeat(${cols},240px);gap:10px;padding:10px}
          .cell img,.cell .none{width:240px;height:300px;object-fit:contain;background:#e8e8e8;display:block}
          .cell div{padding:3px 2px;height:36px;overflow:hidden}</style>
          <div class="grid">${cells
            .map(
              (c) =>
                `<div class="cell">${c.src ? `<img src="${c.src}">` : `<div class="none"></div>`}<div>${esc(c.label)}</div></div>`,
            )
            .join("")}</div>`;
        const tab = await page.context().newPage();
        try {
          await tab.setViewportSize({ width: cols * 250 + 10, height: 400 });
          await tab.setContent(html, { waitUntil: "load" });
          await tab.screenshot({ path: out, fullPage: true, scale: "css" });
        } finally {
          await tab.close();
        }
        return { out, missing: cells.filter((c) => !c.src).length };
      },
      { items, out: resolve(out), cols },
    ),
  );
}

const MIME = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const inline = (path) =>
  `data:${MIME[extname(path).toLowerCase()] ?? "image/jpeg"};base64,${readFileSync(path).toString("base64")}`;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = parseArgs();
  if (!opts.out || !opts._.length)
    fail(
      "usage: node sheet.mjs --out sheet.png <posts.json> [--post N] | <image url | file>...",
    );
  let items;
  if (opts._[0].endsWith(".json")) {
    const saved = JSON.parse(readFileSync(opts._[0], "utf8"));
    const posts = saved.posts ?? saved;
    if (opts.post) {
      const p = posts[Number(opts.post) - 1];
      if (!p) fail(`No post ${opts.post}; there are ${posts.length}.`);
      items = p.images.map((src, i) => ({
        src,
        label: `${i + 1}/${p.images.length} ${p.ratio ?? ""}`,
      }));
    } else
      items = posts.map((p, i) => ({
        src: p.cover,
        label: `#${i + 1} ${p.type}${p.type === "carousel" ? `×${p.slides}` : ""} ${p.ratio ?? ""} likes ${short(p.likes)}${p.owner ? ` @${p.owner}` : ""}`,
      }));
  } else
    items = opts._.map((x, i) =>
      /^https?:/.test(x)
        ? { src: x, label: `${i + 1}` }
        : { data: inline(x), label: `${i + 1} ${x.split("/").pop()}` },
    );
  const made = await makeSheet(items, opts.out, Number(opts.cols ?? 4));
  console.log(
    `${made.out} — ${items.length} pictures${made.missing ? `, ${made.missing} did not load` : ""}`,
  );
}
