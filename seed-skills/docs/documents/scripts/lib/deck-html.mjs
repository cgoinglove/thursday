// A deck that was written as one HTML file (the shipped `slides` skill) turned into
// a .pptx. The slides are already laid out at 1920x1080, so nothing is laid out again here:
// a browser measures every box and every computed style, and each one becomes a shape at the
// same place. 1920px across is PowerPoint's 13.333in, so one inch is 144px exactly.
import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { inTab } from "./browser.mjs";
import { onePropertyBlock } from "./deck.mjs";
import { kit, output, Stop, shown } from "./kit.mjs";

/** PowerPoint's wide slide is 13.333 x 7.5in; a deck is written at 1920 x 1080. */
const PER_INCH = 144;

/**
 * Measures the deck in a tab of its own: `browser.mjs` inTab serves the folder, waits for
 * the fonts and the pictures, and says which pictures never loaded. What runs in the page
 * is written here, inside the call, because only what the callback itself holds crosses
 * into the browser — nothing reads from this module out there.
 */
const measure = (html) =>
  inTab(
    html,
    async (tab) =>
      tab.evaluate(() => {
        const hex = (colour) => {
          const n =
            /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(
              colour || "",
            );
          if (!n || Number(n[4] ?? 1) === 0) return null;
          return [n[1], n[2], n[3]]
            .map((v) => Number(v).toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase();
        };
        // A typeface PowerPoint can name: `system-ui` and its kin are the browser's words
        // for whatever the machine has, which no .pptx can carry
        const faceOf = (family) =>
          family
            .split(",")
            .map((one) => one.replace(/["']/g, "").trim())
            .find(
              (one) =>
                !/^(system-ui|-apple-system|blinkmacsystemfont|ui-[a-z]+|sans-serif|serif|monospace|cursive|fantasy)$/i.test(
                  one,
                ),
            ) ?? "Arial";
        const ownText = (el) =>
          [...el.childNodes]
            .filter((node) => node.nodeType === 3)
            .map((node) => node.textContent)
            .join("")
            .replace(/\s+/g, " ")
            .trim();

        // The deck scales itself to the window and animates a turn; this is the class its own
        // stylesheet uses to stand still at true size, which is what a picture is taken through.
        document.body.classList.add("shot");

        const slides = [];
        for (const section of document.querySelectorAll("[data-slide]")) {
          const frame = section.getBoundingClientRect();
          // A deck scales itself to the window, and a rect carries that transform. The
          // untransformed layout width is what the slide was written at, so this undoes it.
          const scale = section.offsetWidth
            ? frame.width / section.offsetWidth
            : 1;
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
              face: faceOf(cs.fontFamily),
              align: cs.textAlign === "start" ? "left" : cs.textAlign,
              line:
                Number.parseFloat(cs.lineHeight) /
                Number.parseFloat(cs.fontSize),
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
      }),
    {},
    { viewport: { width: 1920, height: 1080 } },
  );

/**
 * `doc.mjs deck-from <deck.html> [--out name]` — the same slides as a PowerPoint file.
 * Every shape keeps the place the browser gave it, so what is in the file is what was seen.
 */
export async function deckFromHtml(htmlPath, opts) {
  const html = resolve(htmlPath);
  if (!existsSync(html) || extname(html).toLowerCase() !== ".html")
    throw new Stop(
      `${shown(html)} is not a deck: give the .html that \`slides\` wrote.`,
    );
  const { result: slides, broken } = await measure(html);
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
  // What the browser could not load is already known; this is what is not on disk at all
  const missing = new Set(broken);
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
        s.addShape(shape.radius ? "roundRect" : "rect", {
          ...at,
          fill: shape.fill ? { color: shape.fill } : { type: "none" },
          line: shape.line
            ? { color: shape.line, width: shape.lineWidth * 0.75 }
            : { type: "none" },
          ...(shape.radius ? { rectRadius: inches(shape.radius) } : {}),
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
