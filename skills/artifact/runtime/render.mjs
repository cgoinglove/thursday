#!/usr/bin/env node
/**
 * Screenshots HTML slides to PNGs, in a tab of its own beside whatever page the
 * session has open. Every `[data-slide]` element in the file is one PNG; a file with
 * none is one PNG of the whole viewport. With `--size` every slide must come out
 * exactly that size, and one that does not fails the run; without it each slide is
 * shot at the size it is drawn at and its size is printed, for the caller to judge.
 * The file's folder is served over http for the length of the run, so pictures
 * beside it load.
 *
 * `--shot` serves the file in its shot mode, `<body class="shot">`: a deck or a canvas
 * lays every slide flat at true size, as it does for printing. `--most n` takes at most
 * n pictures: the first n slides, or, down a file with none, one window at a time at the
 * window's own pixel density, each ending where no line or picture runs across it. The
 * app sends a page to a phone this way (features/reach/pictures). `--apart` shoots in a
 * headless browser of its own, closed after, never in the session's: a bot's pictures of
 * its own work must not appear in a window on the user's screen. `--sheet <file.png>` also
 * lays every picture it took on one image, numbered, so all of them are seen in one look.
 * `--strict` fails the run, exit 1, when a picture on the page did not load, for a caller
 * that goes on from the pictures without a look; without it they are listed and it goes on.
 *
 *   node render.mjs <slides.html> --out <dir> [--size 1080x1350] [--name slide] [--shot] [--most n] [--apart] [--sheet <file.png>] [--strict]
 */
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { imageSize } from "../../browser/scripts/image-size.mjs";
import { serveFolder } from "../../browser/scripts/serve.mjs";
import {
  fail,
  inPage,
  inPageApart,
  orFail,
  parseArgs,
} from "../../browser/scripts/session.mjs";

const USAGE =
  "usage: node render.mjs <slides.html> --out <dir> [--size 1080x1350] [--name slide] [--shot] [--most n] [--apart] [--sheet <file.png>] [--strict]";
const opts = parseArgs();
const file = opts._[0] && resolve(opts._[0]);
const [w, h] = String(opts.size ?? "")
  .split("x")
  .map(Number);
const most = opts.most === undefined ? 0 : Number(opts.most);
if (
  !file ||
  !opts.out ||
  (opts.size !== undefined && !(w && h)) ||
  opts.sheet === true ||
  !(Number.isInteger(most) && most >= 0)
)
  fail(USAGE);
if (!existsSync(file)) fail(`No such file: ${file}`);
const out = resolve(opts.out);
mkdirSync(out, { recursive: true });
const name = opts.name ?? "slide";
const sheet = opts.sheet ? resolve(opts.sheet) : "";
if (sheet) mkdirSync(dirname(sheet), { recursive: true });

/** The file as its shot mode draws it: `shot` on <body>, beside any class it already has. */
const asShot = (html) =>
  html.replace(/<body\b([^>]*)>/i, (tag, attrs) =>
    /\sclass\s*=\s*"/i.test(attrs)
      ? tag.replace(/(\sclass\s*=\s*")/i, "$1shot ")
      : `<body class="shot"${attrs}>`,
  );

// The file's folder, so pictures beside it load; in shot mode the file itself as that draws it
const served = await serveFolder(dirname(file), {
  instead: opts.shot ? { [file]: asShot(await readFile(file, "utf8")) } : {},
});
const url = served.url(basename(file));

const done = orFail(
  await (opts.apart ? inPageApart : inPage)(
    async (page, { url, w, h, out, name, most, sheet }) => {
      const tab = await page.context().newPage();
      try {
        // Slides of their own size lay out the same in any window; the viewport only
        // matters for a file with none, whose picture is the window itself. Taken down
        // the page, the windows are the session's own unless a size is named: a phone's,
        // when the session was opened as one
        if (w || !most)
          await tab.setViewportSize({ width: w || 1280, height: h || 800 });
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
        const taken = [];
        if (n === 0 && !most) {
          const path = `${out}/${name}-01.png`;
          taken.push(await tab.screenshot({ path, scale: "css" }));
          files.push(path);
        }
        if (n === 0 && most) {
          // Where each window ends: the last place past its middle that no line of text
          // and no picture runs across, else the window's own bottom
          const cuts = await tab.evaluate((most) => {
            const spans = [];
            const add = (r) => {
              if (r.height > 0)
                spans.push([r.top + scrollY, r.bottom + scrollY]);
            };
            const walk = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
            );
            const range = document.createRange();
            for (let node = walk.nextNode(); node; node = walk.nextNode()) {
              if (!node.textContent.trim()) continue;
              range.selectNodeContents(node);
              for (const r of range.getClientRects()) add(r);
            }
            for (const el of document.querySelectorAll(
              "img, svg, canvas, video, iframe, input, textarea, select, button",
            ))
              add(el.getBoundingClientRect());
            const inside = (y) => spans.some(([a, b]) => a < y && y < b);
            const ends = [...new Set(spans.map(([, b]) => Math.ceil(b)))]
              .filter((y) => !inside(y))
              .sort((a, b) => a - b);
            const end = document.documentElement.scrollHeight;
            const cuts = [0];
            while (cuts.length <= most && cuts.at(-1) < end) {
              const from = cuts.at(-1);
              if (from + innerHeight >= end) cuts.push(end);
              else
                cuts.push(
                  ends
                    .filter((y) => y > from + innerHeight / 2)
                    .findLast((y) => y <= from + innerHeight) ??
                    from + innerHeight,
                );
            }
            return cuts;
          }, most);
          const width = await tab.evaluate(
            () => document.documentElement.clientWidth,
          );
          for (let i = 1; i < cuts.length; i++) {
            const path = `${out}/${name}-${pad(i - 1)}.png`;
            taken.push(
              await tab.screenshot({
                path,
                fullPage: true,
                scale: "device",
                clip: {
                  x: 0,
                  y: cuts[i - 1],
                  width,
                  height: cuts[i] - cuts[i - 1],
                },
              }),
            );
            files.push(path);
          }
        }
        for (let i = 0; i < (most ? Math.min(n, most) : n); i++) {
          const path = `${out}/${name}-${pad(i)}.png`;
          taken.push(await slides.nth(i).screenshot({ path, scale: "css" }));
          files.push(path);
        }
        if (sheet && taken.length) {
          // Every picture at most 480 wide and 600 tall, four to a row, each under its number
          const cells = taken
            .map(
              (png, i) =>
                `<figure><figcaption>${i + 1}</figcaption><img src="data:image/png;base64,${png.toString("base64")}"></figure>`,
            )
            .join("");
          await tab.setViewportSize({ width: 2048, height: 800 });
          await tab.setContent(
            `<!doctype html><style>body{margin:0;background:#e8e8e8}#sheet{display:inline-grid;grid-template-columns:repeat(${Math.min(4, taken.length)},480px);gap:24px 16px;padding:16px;align-items:start}figure{margin:0}figcaption{font:600 18px/1.4 system-ui,sans-serif;color:#1b1b1b;padding-bottom:6px}img{display:block;max-width:480px;max-height:600px;background:#fff;box-shadow:0 0 0 1px #0002}</style><div id="sheet">${cells}</div>`,
          );
          await tab.evaluate(() =>
            Promise.all([...document.images].map((i) => i.decode())),
          );
          await tab.locator("#sheet").screenshot({ path: sheet });
        }
        return { files, broken, windows: n === 0 && most > 0 };
      } finally {
        await tab.close();
      }
    },
    { url, w, h, out, name, most, sheet },
  ),
);
served.close();

let wrong = 0;
for (const path of done.files) {
  const size = imageSize(path);
  // Windows down a page end where its lines let them, so only slides answer to a size
  const ok = size && (!w || done.windows || (size.w === w && size.h === h));
  if (!ok) wrong++;
  console.log(
    `${path} ${size ? `${size.w}x${size.h}` : "?"}${ok ? "" : ` — not ${w}x${h}`}`,
  );
}
if (done.broken.length) {
  const said = `Pictures that did not load: ${done.broken.join(", ")}`;
  if (opts.strict) fail(`${said}. Fix them and run this again.`);
  console.log(said);
}
if (wrong)
  fail(
    `${wrong} slide(s) came out at the wrong size: give every [data-slide] exactly width ${w}px and height ${h}px, with nothing overflowing it.`,
  );
console.log(
  done.windows
    ? `${done.files.length} window(s) down the page in ${out}`
    : `${done.files.length} slide(s)${w ? ` at ${w}x${h}` : ""} in ${out}`,
);
if (sheet && done.files.length)
  console.log(`All of them on one picture: ${sheet}`);
