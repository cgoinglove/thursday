#!/usr/bin/env node
/**
 * Many pictures as one image, each with a label under it, so one look sees them all:
 * a page's photos, rendered slides, a feed's covers. Pictures are fetched by the
 * session's browser (it carries its cookies) and inlined, so the sheet needs no server.
 *
 *   node sheet.mjs --out sheet.png <image url | file>... [--cols 4]
 */
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fail, inPage, orFail, parseArgs } from "./session.mjs";

const MIME = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

/**
 * Draws `items` — `{ src }` an http(s) url, `{ file }` a local path, or `{ data }` a data
 * URL, each with a `label` — into one PNG at `out`. Resolves to `{ out, missing }`.
 */
export async function makeSheet(items, out, cols = 4) {
  const lost = items.find((it) => it.file && !existsSync(it.file));
  if (lost) fail(`No such file: ${lost.file}`);
  const cells = items.map(({ file, ...it }) =>
    file
      ? {
          ...it,
          data: `data:${MIME[extname(file).toLowerCase()] ?? "image/jpeg"};base64,${readFileSync(file).toString("base64")}`,
        }
      : it,
  );
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
      { items: cells, out: resolve(out), cols },
    ),
  );
}

/** Command-line pictures as items: a url stays a url, anything else is a file. */
export const pictures = (args) =>
  args.map((x, i) =>
    /^https?:/.test(x)
      ? { src: x, label: `${i + 1}` }
      : { file: x, label: `${i + 1} ${x.split("/").pop()}` },
  );

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = parseArgs();
  if (!opts.out || !opts._.length)
    fail(
      "usage: node sheet.mjs --out sheet.png <image url | file>... [--cols 4]",
    );
  const items = pictures(opts._);
  const made = await makeSheet(items, opts.out, Number(opts.cols ?? 4));
  console.log(
    `${made.out} — ${items.length} pictures${made.missing ? `, ${made.missing} did not load` : ""}`,
  );
}
