// The browser the shell's session already has, used as a typesetter: HTML in, PDF or
// PNG out. Driven only through the shipped browser skill's session.mjs; a file is
// served from its own folder on a port the system picks, so two jobs never meet.
import {
  copyFileSync,
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { kitFile, Stop, shippedSkill } from "./kit.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
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
  ".pdf": "application/pdf",
};

/** Where the kit's own files are served, beside the document's folder. */
const KIT_ROUTE = "/__docs-kit/";

let session = null;
/** The one way in: session.mjs opens a headless browser itself when the job has none. */
async function sessionScripts() {
  if (!session)
    session = await import(
      shippedSkill("browser", "scripts", "session.mjs")
    ).catch(() => {
      throw new Stop(
        "The shipped browser skill's session.mjs is missing; this command prints through the browser.",
      );
    });
  return session;
}

/** Serves `root` and the kit on a free port; resolves to its base url and a stop. */
async function serve(root) {
  const kitRoot = kitFile();
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const [base, rel] = path.startsWith(KIT_ROUTE)
      ? [kitRoot, path.slice(KIT_ROUTE.length)]
      : [root, path];
    const full = resolve(base, `.${sep}${rel}`);
    if (
      !full.startsWith(base + sep) ||
      !existsSync(full) ||
      statSync(full).isDirectory()
    ) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type":
        TYPES[extname(full).toLowerCase()] ?? "application/octet-stream",
    });
    createReadStream(full).pipe(res);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
  };
}

/**
 * Inter for Latin, Greek and Cyrillic, served from the kit, so a document prints the same on
 * every machine; everything else falls through to the system's fonts.
 */
function fontCss() {
  const css = readFileSync(
    kitFile("@fontsource-variable", "inter", "wght.css"),
    "utf8",
  );
  const italic = readFileSync(
    kitFile("@fontsource-variable", "inter", "wght-italic.css"),
    "utf8",
  );
  return `${css}\n${italic}`.replaceAll(
    "url(./files/",
    `url(${KIT_ROUTE}@fontsource-variable/inter/files/`,
  );
}

/**
 * Opens `file` in a tab of its own, with the kit's fonts, and runs `work(tab, args)` in the
 * session's VM (not Node: see session.mjs). Resolves to what `work` returned.
 */
export async function inTab(file, work, args = {}, { viewport } = {}) {
  const { inPage, orFail } = await sessionScripts();
  const server = await serve(dirname(file));
  try {
    return orFail(
      await inPage(
        async (page, a, h) => {
          const tab = await page.context().newPage();
          try {
            if (a.viewport) await tab.setViewportSize(a.viewport);
            await tab.goto(a.url, { waitUntil: "load" });
            await tab.addStyleTag({ content: a.fonts });
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
            const result = await h.work(tab, a.args);
            return { result, broken };
          } catch (error) {
            return { error: String(error?.message ?? error).slice(0, 800) };
          } finally {
            await tab.close();
          }
        },
        {
          url: `${server.base}/${encodeURIComponent(basename(file))}`,
          fonts: fontCss(),
          args,
          viewport,
        },
        { work },
      ),
    );
  } finally {
    server.close();
  }
}

/**
 * Prints an HTML file to PDF. The page size and margins are the file's own `@page` rule.
 * Resolves to the pictures that did not load and what overflows the page's width.
 */
export async function printPdf(file, out) {
  const done = await inTab(
    file,
    async (tab, { out }) => {
      await tab.emulateMedia({ media: "print" });
      // Lay the page out at the printed width, from its own @page rule, to find what
      // sticks out sideways: print cuts it rather than wrapping it
      const page = await tab.evaluate(() => {
        for (const sheet of document.styleSheets)
          for (const rule of sheet.cssRules ?? [])
            if (rule instanceof CSSPageRule && !rule.selectorText)
              return {
                size: rule.style.getPropertyValue("size"),
                left: rule.style.getPropertyValue("margin-left"),
                right: rule.style.getPropertyValue("margin-right"),
              };
        return null;
      });
      const PX = { mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, px: 1 };
      const length = (v) => {
        const m = /^([\d.]+)(mm|cm|in|pt|px)$/.exec(String(v).trim());
        return m ? Number(m[1]) * PX[m[2]] : null;
      };
      const NAMED = {
        a4: 793.7,
        a5: 559.4,
        a3: 1122.5,
        letter: 816,
        legal: 816,
      };
      const words = String(page?.size ?? "")
        .toLowerCase()
        .split(/\s+/);
      const named = words.find((w) => w in NAMED);
      let width = named ? NAMED[named] : (length(words[0]) ?? NAMED.letter);
      if (words.includes("landscape"))
        width =
          { a4: 1122.5, a5: 793.7, a3: 1587.4, letter: 1056, legal: 1344 }[
            named
          ] ?? width;
      width -= (length(page?.left) ?? 0) + (length(page?.right) ?? 0);
      await tab.setViewportSize({ width: Math.round(width), height: 1000 });
      const wide = await tab.evaluate(() => {
        const limit = document.documentElement.clientWidth + 1;
        const found = [];
        for (const el of document.body.querySelectorAll("*")) {
          const box = el.getBoundingClientRect();
          if (box.width && box.right > limit && found.length < 5)
            found.push(
              `<${el.tagName.toLowerCase()}${el.className ? ` class="${el.className}"` : ""}> ${(el.textContent ?? "").trim().slice(0, 40)}`,
            );
        }
        return found;
      });
      await tab.pdf({
        path: out,
        preferCSSPageSize: true,
        printBackground: true,
      });
      return { wide };
    },
    { out },
  );
  return { broken: done.broken, wide: done.result.wide };
}

/**
 * A picture PowerPoint and Word cannot take (WebP, AVIF, GIF, SVG) redrawn as a PNG in `dir`,
 * by the browser, which reads them all.
 */
export async function asPng(file, dir) {
  const name = basename(file);
  const out = join(dir, `${name.replace(/\.[^.]+$/, "")}.png`);
  copyFileSync(file, join(dir, name));
  const page = join(dir, "picture.html");
  writeFileSync(
    page,
    `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;max-width:2400px}</style><img src="${encodeURIComponent(name)}">`,
  );
  const done = await inTab(
    page,
    async (tab, { out }) => {
      await tab.locator("img").screenshot({ path: out, omitBackground: true });
    },
    { out },
    { viewport: { width: 2400, height: 1600 } },
  );
  if (done.broken.length)
    throw new Stop(`${name} is not a picture the browser can open.`);
  return out;
}
