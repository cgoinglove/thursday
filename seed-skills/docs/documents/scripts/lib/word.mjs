// A Word file from Markdown, with real styles (headings, lists, tables) that Word's own
// navigation and table of contents understand, and its PDF twin printed from the same text.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { asPng, printPdf } from "./browser.mjs";
import {
  escapeHtml as esc,
  input,
  kit,
  output,
  Stop,
  shippedSkill,
  twin,
  workDir,
} from "./kit.mjs";
import { report } from "./report.mjs";
import { printCss } from "./templates.mjs";

/** `key: value` lines between `---` fences at the top. */
function frontMatter(source) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) return { meta: {}, body: source };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { meta, body: source.slice(m[0].length) };
}

const PAGE_BREAK = /^<!--\s*page\s*-?break\s*-->$/i;

const STYLE = {
  // Sizes in points; Word stores half-points
  body: 10.5,
  h1: 18,
  h2: 14,
  h3: 12,
  title: 26,
  accent: "1F4E79",
  ink: "16181D",
  soft: "5B616E",
  rule: "D9DDE3",
  tint: "F2F4F7",
};

export async function docx(mdPath, opts) {
  const source = input(mdPath, ["md", "markdown", "txt"]);
  const { meta, body } = frontMatter(readFileSync(source, "utf8"));
  const D = await kit("docx");
  const { marked } = await kit("marked");
  const tokens = marked.lexer(body);
  const font = meta.font || "Arial";
  const accent = (meta.accent || STYLE.accent).replace(/^#/, "").toUpperCase();
  const base = dirname(source);
  const { imageSize } = await import(
    shippedSkill("browser", "scripts", "image-size.mjs")
  );
  const paper =
    String(meta.paper ?? "A4").toLowerCase() === "letter"
      ? { width: 12240, height: 15840 }
      : { width: 11906, height: 16838 };
  const margin = 1134; // 2 cm in twips
  const textWidthPx = ((paper.width - 2 * margin) / 1440) * 96;

  // Word takes PNG and JPEG; anything else is redrawn as a PNG before the document is built
  const pictures = new Map();
  const walkPictures = async (tok) => {
    if (tok.type === "image" && !pictures.has(tok.href)) {
      let file = input(resolve(base, decodeURI(tok.href)));
      if (!imageSize(file)) file = await asPng(file, workDir(source));
      if (!imageSize(file)) throw new Stop(`${tok.href} is not a picture.`);
      pictures.set(tok.href, file);
    }
    const list = (v) => (Array.isArray(v) ? v : []);
    const inner = [
      ...list(tok.tokens),
      ...list(tok.items),
      ...list(tok.header),
      ...list(tok.rows).flat(),
    ];
    for (const child of inner) await walkPictures(child);
  };
  for (const tok of tokens) await walkPictures(tok);

  let listInstance = 0;

  /** Inline tokens as runs; `style` carries bold/italic/code down the tree. */
  function inline(list, style = {}) {
    const out = [];
    for (const tok of list ?? []) {
      if (tok.type === "strong")
        out.push(...inline(tok.tokens, { ...style, bold: true }));
      else if (tok.type === "em")
        out.push(...inline(tok.tokens, { ...style, italics: true }));
      else if (tok.type === "del")
        out.push(...inline(tok.tokens, { ...style, strike: true }));
      else if (tok.type === "codespan")
        out.push(
          new D.TextRun({
            text: decode(tok.text),
            font: "Consolas",
            shading: {
              type: D.ShadingType.CLEAR,
              fill: STYLE.tint,
              color: "auto",
            },
            ...style,
          }),
        );
      else if (tok.type === "link")
        out.push(
          new D.ExternalHyperlink({
            link: tok.href,
            children: inline(tok.tokens, {
              ...style,
              color: accent,
              underline: {},
            }),
          }),
        );
      else if (tok.type === "br") out.push(new D.TextRun({ break: 1 }));
      else if (tok.type === "image") out.push(...picture(tok));
      else if (tok.tokens) out.push(...inline(tok.tokens, style));
      else if (tok.type === "html") continue;
      else
        out.push(
          new D.TextRun({ text: decode(tok.text ?? tok.raw ?? ""), ...style }),
        );
    }
    return out;
  }

  function picture(tok) {
    const file = pictures.get(tok.href);
    const size = imageSize(file);
    const width = Math.min(textWidthPx, size.w);
    return [
      new D.ImageRun({
        type: /\.png$/i.test(file) ? "png" : "jpg",
        data: readFileSync(file),
        transformation: { width, height: (width * size.h) / size.w },
        altText: {
          name: tok.text || "picture",
          description: tok.text || "",
          title: tok.text || "",
        },
      }),
    ];
  }

  function list(tok, level, out) {
    const reference = tok.ordered ? "numbers" : "bullets";
    const instance = tok.ordered ? ++listInstance : 0;
    for (const item of tok.items) {
      let first = true;
      for (const child of item.tokens) {
        if (child.type === "list") list(child, level + 1, out);
        else if (first) {
          out.push(
            new D.Paragraph({
              numbering: { reference, level: Math.min(level, 3), instance },
              children: [
                ...(item.task
                  ? [new D.TextRun({ text: item.checked ? "☑ " : "☐ " })]
                  : []),
                ...inline(child.tokens ?? [child]),
              ],
              spacing: { after: 60 },
            }),
          );
          first = false;
        } else out.push(...block(child));
      }
    }
  }

  function table(tok) {
    // Columns share the width by how much text they hold, so a short column stays narrow
    const textWidth = paper.width - 2 * margin;
    const weight = tok.header.map((h, i) =>
      Math.min(
        40,
        Math.max(
          4,
          ...[h, ...tok.rows.map((r) => r[i])].map((c) => c.text.length),
        ),
      ),
    );
    const sum = weight.reduce((a, b) => a + b, 0);
    const widths = weight.map((w) => Math.floor((textWidth * w) / sum));
    const cell = (cellTok, head, align, i) =>
      new D.TableCell({
        width: { size: widths[i], type: D.WidthType.DXA },
        children: [
          new D.Paragraph({
            alignment:
              align === "right"
                ? D.AlignmentType.RIGHT
                : align === "center"
                  ? D.AlignmentType.CENTER
                  : D.AlignmentType.LEFT,
            children: inline(
              cellTok.tokens,
              head ? { bold: true, color: "FFFFFF" } : {},
            ),
            spacing: { before: 40, after: 40 },
          }),
        ],
        shading: head
          ? { type: D.ShadingType.CLEAR, fill: accent, color: "auto" }
          : undefined,
        margins: { left: 100, right: 100 },
      });
    return new D.Table({
      width: { size: textWidth, type: D.WidthType.DXA },
      columnWidths: widths,
      layout: D.TableLayoutType.FIXED,
      rows: [
        new D.TableRow({
          tableHeader: true,
          children: tok.header.map((h, i) => cell(h, true, tok.align[i], i)),
        }),
        ...tok.rows.map(
          (row) =>
            new D.TableRow({
              cantSplit: true,
              children: row.map((c, i) => cell(c, false, tok.align[i], i)),
            }),
        ),
      ],
      borders: {
        top: { style: D.BorderStyle.SINGLE, size: 4, color: STYLE.rule },
        bottom: { style: D.BorderStyle.SINGLE, size: 4, color: STYLE.rule },
        left: { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" },
        right: { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" },
        insideHorizontal: {
          style: D.BorderStyle.SINGLE,
          size: 4,
          color: STYLE.rule,
        },
        insideVertical: { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" },
      },
    });
  }

  function block(tok) {
    switch (tok.type) {
      case "heading":
        return [
          new D.Paragraph({
            heading: [
              D.HeadingLevel.HEADING_1,
              D.HeadingLevel.HEADING_2,
              D.HeadingLevel.HEADING_3,
              D.HeadingLevel.HEADING_4,
            ][Math.min(tok.depth, 4) - 1],
            children: inline(tok.tokens),
          }),
        ];
      case "paragraph":
        return [new D.Paragraph({ children: inline(tok.tokens) })];
      case "list": {
        const out = [];
        list(tok, 0, out);
        return out;
      }
      case "table":
        return [
          table(tok),
          new D.Paragraph({ children: [], spacing: { after: 60 } }),
        ];
      case "blockquote":
        return tok.tokens.flatMap((child) =>
          child.type === "paragraph"
            ? [
                new D.Paragraph({
                  children: inline(child.tokens, { color: STYLE.soft }),
                  indent: { left: 360 },
                  border: {
                    left: {
                      style: D.BorderStyle.SINGLE,
                      size: 18,
                      color: accent,
                      space: 8,
                    },
                  },
                }),
              ]
            : block(child),
        );
      case "code":
        return [
          new D.Paragraph({
            children: tok.text
              .split("\n")
              .flatMap((line, i) => [
                ...(i ? [new D.TextRun({ break: 1 })] : []),
                new D.TextRun({ text: line, font: "Consolas", size: 18 }),
              ]),
            shading: {
              type: D.ShadingType.CLEAR,
              fill: STYLE.tint,
              color: "auto",
            },
            spacing: { before: 60, after: 160 },
          }),
        ];
      case "hr":
        return [
          new D.Paragraph({
            children: [],
            border: {
              bottom: {
                style: D.BorderStyle.SINGLE,
                size: 6,
                color: STYLE.rule,
                space: 1,
              },
            },
            spacing: { after: 200 },
          }),
        ];
      case "html":
        return PAGE_BREAK.test(tok.raw.trim())
          ? [new D.Paragraph({ children: [new D.PageBreak()] })]
          : [];
      case "space":
        return [];
      default:
        return tok.tokens
          ? [new D.Paragraph({ children: inline(tok.tokens) })]
          : [];
    }
  }

  const children = [];
  if (meta.title) {
    children.push(
      new D.Paragraph({
        style: "Title",
        children: [new D.TextRun(meta.title)],
      }),
    );
    if (meta.subtitle)
      children.push(
        new D.Paragraph({
          style: "Subtitle",
          children: [new D.TextRun(meta.subtitle)],
        }),
      );
    const byline = [meta.author, meta.date].filter(Boolean).join(" · ");
    if (byline)
      children.push(
        new D.Paragraph({
          children: [
            new D.TextRun({ text: byline, color: STYLE.soft, size: 18 }),
          ],
          spacing: { after: 360 },
          border: {
            bottom: {
              style: D.BorderStyle.SINGLE,
              size: 6,
              color: STYLE.rule,
              space: 8,
            },
          },
        }),
      );
  }
  for (const tok of tokens) children.push(...block(tok));

  const half = (pt) => Math.round(pt * 2);
  const level = (n, format, text, left) => ({
    level: n,
    format,
    text,
    alignment: D.AlignmentType.LEFT,
    style: { paragraph: { indent: { left, hanging: 280 } } },
  });
  const doc = new D.Document({
    creator: meta.author || "",
    title: meta.title || "",
    styles: {
      default: {
        document: {
          run: { font: font, size: half(STYLE.body), color: STYLE.ink },
          paragraph: { spacing: { after: 140, line: 288 } },
        },
        title: {
          run: { font, size: half(STYLE.title), bold: true, color: STYLE.ink },
          paragraph: { spacing: { after: 80 } },
        },
        heading1: {
          run: { font, size: half(STYLE.h1), bold: true, color: STYLE.ink },
          paragraph: { spacing: { before: 360, after: 120 }, keepNext: true },
        },
        heading2: {
          run: { font, size: half(STYLE.h2), bold: true, color: accent },
          paragraph: { spacing: { before: 280, after: 100 }, keepNext: true },
        },
        heading3: {
          run: { font, size: half(STYLE.h3), bold: true, color: STYLE.ink },
          paragraph: { spacing: { before: 220, after: 80 }, keepNext: true },
        },
        heading4: {
          run: {
            font,
            size: half(STYLE.body),
            bold: true,
            italics: true,
            color: STYLE.ink,
          },
          paragraph: { spacing: { before: 180, after: 60 }, keepNext: true },
        },
      },
      paragraphStyles: [
        {
          id: "Subtitle",
          name: "Subtitle",
          basedOn: "Normal",
          run: { size: half(13), color: STYLE.soft },
          paragraph: { spacing: { after: 160 } },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [0, 1, 2, 3].map((n) =>
            level(
              n,
              D.LevelFormat.BULLET,
              ["•", "–", "◦", "–"][n],
              360 + n * 360,
            ),
          ),
        },
        {
          reference: "numbers",
          levels: [0, 1, 2, 3].map((n) =>
            level(
              n,
              [
                D.LevelFormat.DECIMAL,
                D.LevelFormat.LOWER_LETTER,
                D.LevelFormat.LOWER_ROMAN,
                D.LevelFormat.DECIMAL,
              ][n],
              `%${n + 1}.`,
              360 + n * 360,
            ),
          ),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: paper,
            margin: {
              top: margin,
              bottom: margin,
              left: margin,
              right: margin,
            },
          },
        },
        headers: meta.header
          ? {
              default: new D.Header({
                children: [
                  new D.Paragraph({
                    alignment: D.AlignmentType.RIGHT,
                    children: [
                      new D.TextRun({
                        text: meta.header,
                        size: 16,
                        color: STYLE.soft,
                      }),
                    ],
                  }),
                ],
              }),
            }
          : undefined,
        footers: {
          default: new D.Footer({
            children: [
              new D.Paragraph({
                alignment: D.AlignmentType.RIGHT,
                children: [
                  new D.TextRun({
                    children: [D.PageNumber.CURRENT],
                    size: 16,
                    color: STYLE.soft,
                  }),
                  new D.TextRun({ text: " / ", size: 16, color: STYLE.soft }),
                  new D.TextRun({
                    children: [D.PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: STYLE.soft,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const out = output(
    opts.out,
    meta.title
      ? meta.title
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 60)
      : source
          .split("/")
          .pop()
          .replace(/\.[a-z]+$/i, ""),
    "docx",
  );
  writeFileSync(out, await withNormalStyle(await D.Packer.toBuffer(doc), font));

  // The twin: the same Markdown as a printed page in the same type
  const dir = workDir(out);
  const html = join(dir, "twin.html");
  writeFileSync(
    html,
    twinHtml(
      meta,
      marked.parse(
        body.replace(
          /^<!--\s*page\s*-?break\s*-->$/gim,
          '<div class="break"></div>',
        ),
      ),
      font,
      accent,
    ),
  );
  for (const tok of marked.lexer(body)) copyPictures(tok, base, dir);
  const pdf = twin(out, "pdf");
  const { broken, wide } = await printPdf(html, pdf);
  await report(pdf, { broken, wide, twinOf: out });
}

/**
 * The docx library writes the document defaults but no "Normal" style, and readers other
 * than Word (Pages, Quick Look, Google Docs) then set body text in their own serif.
 */
async function withNormalStyle(buffer, font) {
  const { default: JSZip } = await kit("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const styles = await zip.file("word/styles.xml").async("string");
  if (!styles.includes('w:styleId="Normal"')) {
    const f = esc(font);
    const normal = `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="140" w:line="288" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/><w:color w:val="${STYLE.ink}"/><w:sz w:val="${Math.round(STYLE.body * 2)}"/><w:szCs w:val="${Math.round(STYLE.body * 2)}"/></w:rPr></w:style>`;
    zip.file(
      "word/styles.xml",
      styles.replace(/(<\/w:docDefaults>)/, `$1${normal}`),
    );
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Pictures the Markdown names, copied beside the twin so its page finds them. */
function copyPictures(tok, base, dir) {
  if (tok.type === "image" && !/^[a-z]+:/i.test(tok.href)) {
    const from = resolve(base, decodeURI(tok.href));
    const to = resolve(dir, decodeURI(tok.href));
    if (to.startsWith(dir)) {
      try {
        writeFileSync(to, readFileSync(from));
      } catch {}
    }
  }
  for (const child of tok.tokens ?? []) copyPictures(child, base, dir);
  for (const item of tok.items ?? []) copyPictures(item, base, dir);
  for (const row of tok.rows ?? [])
    for (const c of row) copyPictures(c, base, dir);
}

function twinHtml(meta, bodyHtml, font, accent) {
  const letter = String(meta.paper ?? "").toLowerCase() === "letter";
  return `<!doctype html>
<html lang="${esc(meta.lang ?? "en")}">
<head>
<meta charset="utf-8">
<title>${esc(meta.title ?? "")}</title>
<style>
${printCss()}
</style>
<style>
@page { size: ${letter ? "letter" : "A4"}; margin: 20mm; }
:root { --accent: #${accent}; }
body { font-family: "${esc(font)}", var(--sans); font-size: ${STYLE.body}pt; line-height: 1.4; color: #${STYLE.ink}; }
h1 { font-size: ${STYLE.h1}pt; margin: 18pt 0 6pt; color: #${STYLE.ink}; letter-spacing: 0; }
h2 { font-size: ${STYLE.h2}pt; margin: 14pt 0 5pt; letter-spacing: 0; }
h3 { font-size: ${STYLE.h3}pt; margin: 11pt 0 4pt; }
.title { font-size: ${STYLE.title}pt; font-weight: 700; margin: 0 0 4pt; letter-spacing: 0; }
.subtitle { font-size: 13pt; color: #${STYLE.soft}; margin-bottom: 8pt; }
.byline { font-size: 9pt; color: #${STYLE.soft}; padding-bottom: 8pt; border-bottom: 0.75pt solid #${STYLE.rule}; margin-bottom: 18pt; }
p { margin: 0 0 7pt; }
th { background: #${accent}; color: #fff; text-transform: none; letter-spacing: 0; font-size: ${STYLE.body}pt; padding: 3pt 5pt; border: 0; }
td { padding: 3pt 5pt; }
th:first-child, td:first-child { padding-left: 5pt; }
blockquote { margin: 0 0 7pt; padding-left: 10pt; border-left: 2.25pt solid #${accent}; color: #${STYLE.soft}; }
code { font-family: Consolas, Menlo, monospace; background: #${STYLE.tint}; font-size: 0.92em; }
pre { background: #${STYLE.tint}; padding: 6pt 8pt; font-size: 9pt; white-space: pre-wrap; }
pre code { background: none; }
hr { border-top: 0.75pt solid #${STYLE.rule}; }
img { display: block; }
</style>
</head>
<body>
${meta.title ? `<div class="title">${esc(meta.title)}</div>` : ""}
${meta.subtitle ? `<div class="subtitle">${esc(meta.subtitle)}</div>` : ""}
${meta.author || meta.date ? `<div class="byline">${esc([meta.author, meta.date].filter(Boolean).join(" · "))}</div>` : ""}
${bodyHtml}
</body>
</html>
`;
}

const decode = (s) =>
  String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** A .docx as Markdown: headings, lists, emphasis and tables as Word stored them. */
export async function readDocx(file) {
  const { default: mammoth } = await kit("mammoth");
  const { value, messages } = await mammoth.convertToHtml({ path: file });
  const text = htmlToText(value);
  const warned = messages.filter((m) => m.type === "error").length;
  return warned ? `${text}\n\n(${warned} part(s) could not be read)` : text;
}

/** Just enough HTML to Markdown for reading: headings, lists, tables, emphasis. */
function htmlToText(html) {
  return decode(
    html
      .replace(
        /<t([dh])[^>]*>([\s\S]*?)<\/t\1>/g,
        (_, k, inner) =>
          `<t${k}>${inner.replace(/<\/?p>/g, " ").trim()}</t${k}>`,
      )
      .replace(/<h(\d)[^>]*>/g, (_, n) => `\n\n${"#".repeat(Number(n))} `)
      .replace(/<\/h\d>/g, "\n")
      .replace(/<li[^>]*>/g, "\n- ")
      .replace(/<tr[^>]*>/g, "\n| ")
      .replace(/<t[dh]>/g, " ")
      .replace(/<\/t[dh]>/g, " |")
      .replace(/<\/table>/g, "\n\n")
      .replace(/<\/li>/g, "\n")
      .replace(/<(strong|b)>/g, "**")
      .replace(/<\/(strong|b)>/g, "**")
      .replace(/<(em|i)>/g, "_")
      .replace(/<\/(em|i)>/g, "_")
      .replace(/<img [^>]*>/g, "[picture]")
      .replace(/<\/p>/g, "\n\n")
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
