// A deck that was written as one HTML file (the shipped `interactive-page` skill) turned into
// a .pptx. The slides are already laid out at 1920x1080, so nothing is laid out again here:
// a browser measures every box and every computed style, and each one becomes a shape at the
// same place. 1920px across is PowerPoint's 13.333in, so one inch is 144px exactly.
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { onePropertyBlock } from "./deck.mjs";
import { kit, output, Stop, shippedSkill, shown } from "./kit.mjs";

/** PowerPoint's wide slide is 13.333 x 7.5in; a deck is written at 1920 x 1080. */
const PER_INCH = 144;

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
};

/** Serves the deck's folder on a port the system picks, so two jobs never meet. */
async function serve(root) {
  const server = createServer((req, res) => {
    const path = resolve(
      root,
      `.${decodeURIComponent(new URL(req.url, "http://x").pathname)}`,
    );
    if (
      !path.startsWith(root + sep) ||
      !existsSync(path) ||
      statSync(path).isDirectory()
    )
      return void res.writeHead(404).end();
    res.writeHead(200, {
      "content-type":
        TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
    });
    createReadStream(path).pipe(res);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { port: server.address().port, close: () => server.close() };
}

/**
 * Runs in the page: every slide's boxes, in paint order. Nothing here decides what a slide
 * should look like — it reports what the browser already drew.
 */
function measureInPage() {
  const hex = (colour) => {
    const n = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(
      colour || "",
    );
    if (!n || Number(n[4] ?? 1) === 0) return null;
    return [n[1], n[2], n[3]]
      .map((v) => Number(v).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  };
  const ownText = (el) =>
    [...el.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent)
      .join("")
      .replace(/\s+/g, " ")
      .trim();

  const slides = [];
  for (const section of document.querySelectorAll("[data-slide]")) {
    const frame = section.getBoundingClientRect();
    // A deck scales itself to the window, and a rect carries that transform. The
    // untransformed layout width is what the slide was written at, so this undoes it.
    const scale = section.offsetWidth ? frame.width / section.offsetWidth : 1;
    const aside = section.querySelector("aside");
    const notes = aside ? aside.textContent.trim() : "";
    const shapes = [];
    const at = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - frame.left) / scale,
        y: (r.top - frame.top) / scale,
        w: r.width / scale,
        h: r.height / scale,
      };
    };

    for (const el of section.querySelectorAll("*")) {
      if (el.tagName === "ASIDE" || el.closest("aside")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const box = at(el);
      if (box.w < 1 || box.h < 1) continue;

      const fill = hex(cs.backgroundColor);
      const border = Number.parseFloat(cs.borderTopWidth) || 0;
      if (fill || border)
        shapes.push({
          kind: "rect",
          ...box,
          fill,
          line: border ? hex(cs.borderTopColor) : null,
          lineWidth: border,
          radius: Number.parseFloat(cs.borderTopLeftRadius) || 0,
        });

      if (el.tagName === "IMG") {
        shapes.push({
          kind: "image",
          ...box,
          src: el.getAttribute("src"),
          cover: cs.objectFit !== "contain",
        });
        continue;
      }
      if (el.tagName === "TABLE") {
        const rows = [...el.rows].map((row) =>
          [...row.cells].map((cell) => {
            const s = getComputedStyle(cell);
            return {
              text: cell.textContent.replace(/\s+/g, " ").trim(),
              bold: Number(s.fontWeight) >= 600,
              colour: hex(s.color),
              size: Number.parseFloat(s.fontSize),
              align: s.textAlign === "start" ? "left" : s.textAlign,
            };
          }),
        );
        shapes.push({ kind: "table", ...box, rows });
        continue;
      }

      const text = ownText(el);
      if (!text) continue;
      shapes.push({
        kind: "text",
        ...box,
        text,
        size: Number.parseFloat(cs.fontSize),
        colour: hex(cs.color) ?? "000000",
        bold: Number(cs.fontWeight) >= 600,
        italic: cs.fontStyle === "italic",
        face: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
        align: cs.textAlign === "start" ? "left" : cs.textAlign,
        line: Number.parseFloat(cs.lineHeight) / Number.parseFloat(cs.fontSize),
        spacing: Number.parseFloat(cs.letterSpacing) || 0,
      });
    }
    slides.push({
      bg: hex(getComputedStyle(section).backgroundColor) ?? "FFFFFF",
      size: { w: section.offsetWidth, h: section.offsetHeight },
      notes,
      shapes,
    });
  }
  return slides;
}

/** Measures the deck through the job's browser; the shipped skill opens a headless one when none is. */
async function measure(html) {
  if (!process.env.THURSDAY_SKILLS)
    throw new Stop(
      "THURSDAY_SKILLS is not set: run this from a bot's shell, where it names the shipped skills.",
    );
  const { inPage, orFail } = await import(
    shippedSkill("browser", "scripts", "session.mjs")
  );
  const server = await serve(dirname(html));
  try {
    return orFail(
      await inPage(
        async (page, a) => {
          const tab = await page.context().newPage();
          try {
            await tab.setViewportSize({ width: 1920, height: 1080 });
            await tab.goto(a.url, { waitUntil: "load" });
            await tab.evaluate(async () => {
              await document.fonts.ready;
              await Promise.all(
                [...document.images].map((i) => i.decode().catch(() => {})),
              );
            });
            // The deck scales itself to the window; the shot copy's class turns that off
            await tab.evaluate(() => document.body.classList.add("shot"));
            return await tab.evaluate(a.measure);
          } finally {
            await tab.close();
          }
        },
        {
          url: `http://127.0.0.1:${server.port}/${encodeURIComponent(basename(html))}`,
          measure: `(${measureInPage.toString()})()`,
        },
      ),
    );
  } finally {
    server.close();
  }
}

/**
 * `doc.mjs deck-from <deck.html> [--out name]` — the same slides as a PowerPoint file.
 * Every shape keeps the place the browser gave it, so what is in the file is what was seen.
 */
export async function deckFromHtml(htmlPath, opts) {
  const html = resolve(htmlPath);
  if (!existsSync(html) || extname(html).toLowerCase() !== ".html")
    throw new Stop(
      `${shown(html)} is not a deck: give the .html that \`interactive-page\` wrote.`,
    );
  const slides = await measure(html);
  if (!slides.length)
    throw new Stop(
      `${shown(html)} holds no slides: a slide is one <section data-slide>.`,
    );
  const odd = slides.findIndex(
    (s) => Math.round(s.size.w) !== 1920 || Math.round(s.size.h) !== 1080,
  );
  if (odd !== -1)
    throw new Stop(
      `Slide ${odd + 1} is ${Math.round(slides[odd].size.w)}x${Math.round(slides[odd].size.h)}, not 1920x1080. A PowerPoint slide is one size: fix it in the deck and run this again.`,
    );

  const { default: PptxGenJS } = await kit("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = basename(html, ".html");

  const inches = (px) => px / PER_INCH;
  const missing = new Set();
  for (const slide of slides) {
    const s = pptx.addSlide();
    s.background = { color: slide.bg };
    for (const shape of slide.shapes) {
      const at = {
        x: inches(shape.x),
        y: inches(shape.y),
        w: inches(shape.w),
        h: inches(shape.h),
      };
      if (shape.kind === "rect")
        s.addShape(shape.radius >= 8 ? "roundRect" : "rect", {
          ...at,
          fill: shape.fill ? { color: shape.fill } : { type: "none" },
          line: shape.line
            ? { color: shape.line, width: shape.lineWidth * 0.75 }
            : { type: "none" },
          ...(shape.radius >= 8 ? { rectRadius: inches(shape.radius) } : {}),
        });
      else if (shape.kind === "image") {
        const file = join(dirname(html), shape.src ?? "");
        if (!shape.src || !existsSync(file)) {
          missing.add(shape.src ?? "(no src)");
          continue;
        }
        s.addImage({
          path: file,
          ...at,
          sizing: { type: shape.cover ? "cover" : "contain", w: at.w, h: at.h },
        });
      } else if (shape.kind === "table")
        s.addTable(
          shape.rows.map((row) =>
            row.map((cell) => ({
              text: cell.text,
              options: {
                bold: cell.bold,
                color: cell.colour ?? "000000",
                fontSize: cell.size * 0.75,
                align: cell.align ?? "left",
                valign: "middle",
              },
            })),
          ),
          { ...at, border: { type: "none" }, autoPage: false },
        );
      else
        s.addText(
          [
            {
              text: shape.text,
              options: {
                fontSize: shape.size * 0.75,
                bold: shape.bold,
                italic: shape.italic,
                color: shape.colour,
                ...(shape.spacing ? { charSpacing: shape.spacing * 0.75 } : {}),
              },
            },
          ],
          {
            ...at,
            fontFace: shape.face,
            align: shape.align ?? "left",
            valign: "top",
            margin: 0,
            lineSpacingMultiple: Number.isFinite(shape.line) ? shape.line : 1,
            fit: "none",
            wrap: true,
          },
        );
    }
    if (slide.notes) s.addNotes(slide.notes);
  }

  const out = output(opts.out, basename(html, ".html"), "pptx");
  writeFileSync(
    out,
    await onePropertyBlock(await pptx.write({ outputType: "nodebuffer" })),
  );
  if (missing.size)
    throw new Stop(
      `Pictures that are not beside the deck: ${[...missing].join(", ")}. ${shown(out)} has their gaps — put them there and run this again.`,
    );
  console.log(
    `Made ${shown(out)}: ${slides.length} slides, every box where the deck put it. The deck itself still prints a slide a page, so hand back both paths.`,
  );
}
