#!/usr/bin/env node
/**
 * Screenshots HTML slides to PNGs of exactly the given size, in a tab of its own
 * beside whatever page the session has open. Every `[data-slide]` element in the
 * file is one PNG; a file with none is one PNG of the whole viewport. The file's
 * folder is served over http for the length of the run, so pictures beside it load.
 *
 *   node render.mjs <slides.html> --size 1080x1350 --out <dir> [--name slide]
 */
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { imageSize } from "./image-size.mjs";
import { fail, inPage, orFail, parseArgs } from "./session.mjs";

const opts = parseArgs();
const file = opts._[0] && resolve(opts._[0]);
const [w, h] = String(opts.size ?? "")
  .split("x")
  .map(Number);
if (!file || !opts.out || !w || !h)
  fail(
    "usage: node render.mjs <slides.html> --size 1080x1350 --out <dir> [--name slide]",
  );
if (!existsSync(file)) fail(`No such file: ${file}`);
const out = resolve(opts.out);
mkdirSync(out, { recursive: true });
const name = opts.name ?? "slide";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};
const root = dirname(file);
// Port 0: the system picks a free one, so two jobs rendering at once never meet
const server = createServer((req, res) => {
  const path = resolve(
    root,
    `.${decodeURIComponent(new URL(req.url, "http://x").pathname)}`,
  );
  if (
    !path.startsWith(root + sep) ||
    !existsSync(path) ||
    statSync(path).isDirectory()
  ) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type":
      TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
  });
  createReadStream(path).pipe(res);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}/${encodeURIComponent(basename(file))}`;

const done = orFail(
  await inPage(
    async (page, { url, w, h, out, name }) => {
      const tab = await page.context().newPage();
      try {
        await tab.setViewportSize({ width: w, height: h });
        await tab.goto(url, { waitUntil: "load" });
        await tab.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            [...document.images].map((i) => i.decode().catch(() => {})),
          );
        });
        const broken = await tab.evaluate(() =>
          [...document.images]
            .filter((i) => !i.naturalWidth)
            .map((i) => i.getAttribute("src")),
        );
        const slides = tab.locator("[data-slide]");
        const n = await slides.count();
        const files = [];
        const pad = (i) => String(i + 1).padStart(2, "0");
        if (n === 0) {
          const path = `${out}/${name}-01.png`;
          await tab.screenshot({ path, scale: "css" });
          files.push(path);
        }
        for (let i = 0; i < n; i++) {
          const path = `${out}/${name}-${pad(i)}.png`;
          await slides.nth(i).screenshot({ path, scale: "css" });
          files.push(path);
        }
        return { files, broken };
      } finally {
        await tab.close();
      }
    },
    { url, w, h, out, name },
  ),
);
server.close();

let wrong = 0;
for (const path of done.files) {
  const size = imageSize(path);
  const ok = size && size.w === w && size.h === h;
  if (!ok) wrong++;
  console.log(
    `${path} ${size ? `${size.w}x${size.h}` : "?"}${ok ? "" : ` — not ${w}x${h}`}`,
  );
}
if (done.broken.length)
  console.log(`Pictures that did not load: ${done.broken.join(", ")}`);
if (wrong)
  fail(
    `${wrong} slide(s) came out at the wrong size: give every [data-slide] exactly width ${w}px and height ${h}px, with nothing overflowing it.`,
  );
console.log(`${done.files.length} slide(s) at ${w}x${h} in ${out}`);
