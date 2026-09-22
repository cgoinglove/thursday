// A deck from a JSON outline. Every slide is laid out once, as boxes in inches; the browser
// draws those boxes as the deck's PDF twin and shrinks any text that does not fit, and the
// .pptx is written from the same boxes at the sizes the browser settled on. So what the
// pictures show is what PowerPoint opens, as closely as two renderers allow.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { asPng, inTab } from "./browser.mjs";
import { chartSvg } from "./deck-chart.mjs";
import {
  clearPictures,
  escapeHtml as esc,
  input,
  kit,
  output,
  readJson,
  Stop,
  shippedSkill,
  shown,
  twin,
  workDir,
} from "./kit.mjs";

// 16:9 in inches, the size PowerPoint calls widescreen
const W = 13.333;
const H = 7.5;
const PX = 96;
const MX = 0.75;
const CW = W - 2 * MX;
const BOTTOM = 6.72;

const THEMES = {
  ink: { accent: "2563EB", cover: "0B1220", surface: "F1F5F9" },
  sand: { accent: "C2410C", cover: "1C1917", surface: "F3EEE6", bg: "FBF9F5" },
  forest: { accent: "047857", cover: "052E26", surface: "ECF5F1" },
  plum: { accent: "7C3AED", cover: "1E1B3A", surface: "F3F0FB" },
  mono: { accent: "111827", cover: "111827", surface: "F3F4F6" },
};

const TYPES = [
  "title",
  "section",
  "bullets",
  "two",
  "stats",
  "chart",
  "table",
  "steps",
  "cards",
  "quote",
  "image",
  "closing",
];

const hex = (value, what) => {
  const h = String(value).replace(/^#/, "").toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(h))
    throw new Stop(`${what} is not a colour like #2563EB.`);
  return h;
};

/** `amount` of the way from colour `a` to colour `b`. */
function mix(a, b, amount) {
  const pa = [0, 2, 4].map((i) => Number.parseInt(a.slice(i, i + 2), 16));
  const pb = [0, 2, 4].map((i) => Number.parseInt(b.slice(i, i + 2), 16));
  return pa
    .map((v, i) =>
      Math.round(v + (pb[i] - v) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();
}

function theme(outline) {
  const name = outline.theme ?? "ink";
  if (!THEMES[name])
    throw new Stop(`"theme" is one of ${Object.keys(THEMES).join(", ")}.`);
  const base = THEMES[name];
  const accent = outline.accent ? hex(outline.accent, "accent") : base.accent;
  const cover = outline.cover ? hex(outline.cover, "cover") : base.cover;
  return {
    bg: base.bg ?? "FFFFFF",
    ink: "111827",
    soft: "4B5563",
    faint: "9CA3AF",
    rule: "E5E7EB",
    surface: base.surface,
    accent,
    accentSoft: mix(accent, "FFFFFF", 0.86),
    cover,
    coverSoft: mix(cover, "FFFFFF", 0.7),
    coverAccent: name === "mono" ? "D1D5DB" : mix(accent, "FFFFFF", 0.45),
    series: [
      accent,
      mix(accent, "FFFFFF", 0.5),
      mix(accent, "111827", 0.5),
      "F59E0B",
      "10B981",
      "EF4444",
    ],
    font: outline.font ?? "Arial",
    // Korean text marked as Korean, so PowerPoint breaks its lines between words
    lang: /[\uac00-\ud7af]/.test(JSON.stringify(outline.slides))
      ? "ko-KR"
      : "en-US",
  };
}

/** `**bold**` inside a line, as runs. */
const runs = (text) =>
  String(text ?? "")
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**")
        ? { text: part.slice(2, -2), bold: true }
        : { text: part },
    );

/** One paragraph; `size`, `color`, `bold`, `before` (pt) override the box's own. */
const para = (value, style = {}) => ({ runs: runs(value), ...style });

/** A list as paragraphs: a string is a point, an array right after it holds its sub-points. */
function points(list) {
  if (!list) return [];
  const out = [];
  for (const item of Array.isArray(list) ? list : [list]) {
    if (Array.isArray(item))
      for (const sub of item) out.push(para(sub, { level: 1 }));
    else out.push(para(item, { level: 0 }));
  }
  return out;
}

// Shapes: { kind: rect|ellipse|line|text|image|chart|table, x, y, w, h, …}, inches and points
const rect = (x, y, w, h, fill) => ({ kind: "rect", x, y, w, h, fill });

/**
 * A text box. `size` is its base size in points and `fit` the smallest it may shrink to;
 * `line` is PowerPoint's line spacing multiple, `after` the space after each paragraph.
 */
const text = (x, y, w, h, paragraphs, style) => ({
  kind: "text",
  x,
  y,
  w,
  h,
  paragraphs: typeof paragraphs === "string" ? [para(paragraphs)] : paragraphs,
  ...style,
});

/** The title, and the lead line under it in the same box, so a one-line title leaves no gap. */
function titleBlock(slide, t) {
  const paragraphs = [para(slide.title ?? "")];
  if (slide.lead)
    paragraphs.push(
      para(slide.lead, { size: 17, color: t.soft, bold: false, before: 9 }),
    );
  const h = slide.lead ? 1.5 : 1.12;
  return {
    shapes: [
      rect(MX, 0.62, 0.55, 0.06, t.accent),
      text(MX, 0.86, CW, h, paragraphs, {
        size: 30,
        bold: true,
        color: t.ink,
        fit: 20,
        line: 1.0,
      }),
    ],
    top: 0.86 + h + 0.22,
  };
}

function footer(outline, n, t) {
  const shapes = [];
  if (outline.footer)
    shapes.push(
      text(MX, 6.98, 9, 0.3, outline.footer, { size: 10, color: t.faint }),
    );
  shapes.push(
    text(W - MX - 1, 6.98, 1, 0.3, String(n), {
      size: 10,
      color: t.faint,
      align: "right",
    }),
  );
  return shapes;
}

const bulletStyle = (t, size, min) => ({
  size,
  color: t.ink,
  fit: min,
  line: 1.05,
  after: Math.round(size * 0.6),
  bullets: true,
  bulletColor: t.accent,
});

const imageShape = (file, x, y, w, h, fit = "cover") => ({
  kind: "image",
  file,
  x,
  y,
  w,
  h,
  fit,
});

/** One slide's background and shapes. */
function layout(slide, outline, n, t) {
  const type = slide.type ?? (slide.bullets ? "bullets" : "title");
  if (!TYPES.includes(type))
    throw new Stop(
      `Slide ${n}: no type "${type}". Types: ${TYPES.join(", ")}.`,
    );
  const shapes = [];
  const content = () => {
    const head = titleBlock(slide, t);
    shapes.push(...head.shapes);
    return head.top;
  };
  const done = (bg = t.bg, withFooter = true) => ({
    bg,
    shapes: withFooter ? [...shapes, ...footer(outline, n, t)] : shapes,
  });

  if (type === "title" || type === "closing") {
    shapes.push(rect(0, 0, 0.22, H, t.accent));
    const paragraphs = [];
    if (slide.kicker)
      paragraphs.push(
        para(String(slide.kicker).toUpperCase(), {
          size: 14,
          color: t.coverAccent,
          after: 14,
          spacing: 2,
        }),
      );
    paragraphs.push(para(slide.title ?? "", { size: 46 }));
    if (slide.subtitle)
      paragraphs.push(
        para(slide.subtitle, {
          size: 20,
          color: t.coverSoft,
          bold: false,
          before: 16,
        }),
      );
    shapes.push(
      text(MX + 0.4, 1.3, CW - 1.4, 4.4, paragraphs, {
        size: 46,
        bold: true,
        color: "FFFFFF",
        fit: 26,
        line: 1.0,
        valign: "middle",
      }),
    );
    if (slide.byline)
      shapes.push(
        text(MX, 6.4, CW, 0.4, slide.byline, { size: 13, color: t.coverSoft }),
      );
    return done(t.cover, false);
  }

  if (type === "section") {
    const paragraphs = [];
    if (slide.number != null)
      paragraphs.push(
        para(String(slide.number).padStart(2, "0"), {
          size: 60,
          color: mix(t.accent, "FFFFFF", 0.5),
          after: 6,
        }),
      );
    paragraphs.push(para(slide.title ?? "", { size: 40 }));
    if (slide.subtitle)
      paragraphs.push(
        para(slide.subtitle, {
          size: 19,
          color: mix(t.accent, "FFFFFF", 0.78),
          bold: false,
          before: 14,
        }),
      );
    shapes.push(
      text(MX, 1.2, CW - 1.2, 5.0, paragraphs, {
        size: 60,
        bold: true,
        color: "FFFFFF",
        fit: 30,
        line: 1.0,
        valign: "middle",
      }),
    );
    return done(t.accent, false);
  }

  if (type === "quote") {
    shapes.push(
      text(MX + 0.2, 0.75, 1.6, 2.0, "“", {
        size: 140,
        bold: true,
        color: t.accent,
        line: 0.8,
      }),
    );
    const paragraphs = [para(slide.quote ?? "", { size: 32 })];
    if (slide.by)
      paragraphs.push(
        para(`— ${slide.by}`, { size: 17, color: t.soft, before: 22 }),
      );
    shapes.push(
      text(MX + 1.0, 2.2, CW - 2.0, 3.9, paragraphs, {
        size: 32,
        color: t.ink,
        fit: 18,
        line: 1.08,
        valign: "top",
      }),
    );
    return done();
  }

  const top = type === "image" && !slide.title ? 0.75 : content();
  const room = BOTTOM - top;

  if (type === "bullets") {
    const paragraphs = points(slide.bullets);
    if (!paragraphs.length) throw new Stop(`Slide ${n}: "bullets" is empty.`);
    if (slide.numbered) {
      let k = 0;
      for (const p of paragraphs) if (!p.level) p.number = ++k;
    }
    const w = slide.image ? 6.6 : CW;
    shapes.push(text(MX, top, w, room, paragraphs, bulletStyle(t, 24, 14)));
    if (slide.image)
      shapes.push(
        imageShape(
          slide.image,
          MX + w + 0.45,
          top,
          CW - w - 0.45,
          room,
          slide.fit,
        ),
      );
  } else if (type === "two") {
    const gap = 0.4;
    const cw = (CW - gap) / 2;
    [slide.left, slide.right].forEach((col, i) => {
      if (!col) throw new Stop(`Slide ${n}: "two" needs "left" and "right".`);
      const x = MX + i * (cw + gap);
      shapes.push(rect(x, top, cw, room, t.surface));
      shapes.push(rect(x, top, cw, 0.06, i ? t.faint : t.accent));
      const body = col.bullets ? points(col.bullets) : [para(col.text ?? "")];
      shapes.push(
        text(
          x + 0.4,
          top + 0.38,
          cw - 0.8,
          room - 0.6,
          [
            para(col.heading ?? "", {
              size: 21,
              bold: true,
              after: 12,
              heading: true,
            }),
            ...body,
          ],
          { ...bulletStyle(t, 18, 12), bullets: Boolean(col.bullets) },
        ),
      );
    });
  } else if (type === "stats") {
    const stats = slide.stats ?? [];
    if (stats.length < 1 || stats.length > 4)
      throw new Stop(`Slide ${n}: "stats" holds 1 to 4 numbers.`);
    const gap = 0.35;
    const cw = (CW - gap * (stats.length - 1)) / stats.length;
    const h = Math.min(3.4, room);
    const y = top + (room - h) / 2;
    const big = stats.length > 3 ? 44 : 56;
    stats.forEach((s, i) => {
      const x = MX + i * (cw + gap);
      shapes.push(rect(x, y, cw, h, t.surface));
      shapes.push(rect(x, y, 0.07, h, t.accent));
      // The number on one line, shrunk to its card; its words under it at their own size
      shapes.push(
        text(x + 0.42, y + 0.3, cw - 0.72, 1.15, String(s.value ?? ""), {
          size: big,
          bold: true,
          color: t.accent,
          fit: 16,
          line: 0.95,
          valign: "bottom",
          nowrap: true,
        }),
      );
      const words = [para(String(s.label ?? ""), { bold: true })];
      if (s.detail)
        words.push(
          para(String(s.detail), { size: 14, color: t.soft, before: 8 }),
        );
      shapes.push(
        text(x + 0.42, y + 1.6, cw - 0.72, h - 1.85, words, {
          size: 18,
          color: t.ink,
          fit: 11,
          line: 1.05,
        }),
      );
    });
  } else if (type === "chart") {
    const chart = slide.chart;
    if (!chart?.labels?.length || !chart?.series?.length)
      throw new Stop(
        `Slide ${n}: "chart" needs "labels" and "series": [{ "name", "values" }].`,
      );
    for (const one of chart.series)
      if (
        !Array.isArray(one.values) ||
        one.values.length !== chart.labels.length
      )
        throw new Stop(
          `Slide ${n}: every series holds one value per label (${chart.labels.length}).`,
        );
    const side = slide.takeaway || slide.bullets;
    const cw = side ? 7.9 : CW;
    shapes.push({ kind: "chart", x: MX, y: top, w: cw, h: room, chart });
    if (side) {
      const paragraphs = [];
      if (slide.takeaway)
        paragraphs.push(
          para(slide.takeaway, {
            size: 24,
            bold: true,
            color: t.accent,
            after: 18,
            heading: true,
          }),
        );
      if (slide.bullets) paragraphs.push(...points(slide.bullets));
      shapes.push(
        text(MX + cw + 0.5, top + 0.2, CW - cw - 0.5, room - 0.2, paragraphs, {
          ...bulletStyle(t, 16, 11),
          bullets: Boolean(slide.bullets),
          line: 1.05,
        }),
      );
    }
  } else if (type === "table") {
    const columns = slide.columns ?? [];
    const rows = slide.rows ?? [];
    if (!columns.length || !rows.length)
      throw new Stop(`Slide ${n}: "table" needs "columns" and "rows".`);
    const bad = rows.findIndex((r) => r.length !== columns.length);
    if (bad >= 0)
      throw new Stop(
        `Slide ${n}: row ${bad + 1} has ${rows[bad].length} cells for ${columns.length} columns.`,
      );
    shapes.push({
      kind: "table",
      x: MX,
      y: top,
      w: CW,
      h: room,
      columns: columns.map(String),
      rows: rows.map((r) => r.map((c) => (c == null ? "" : String(c)))),
      size: rows.length <= 6 ? 16 : rows.length <= 10 ? 13 : 11,
      highlight: slide.highlight,
    });
  } else if (type === "steps") {
    const steps = slide.steps ?? [];
    if (steps.length < 2 || steps.length > 6)
      throw new Stop(`Slide ${n}: "steps" holds 2 to 6 steps.`);
    const cw = CW / steps.length;
    const lineY = top + 0.55;
    shapes.push({
      kind: "line",
      x: MX + cw / 2,
      y: lineY,
      w: CW - cw,
      h: 0,
      color: t.rule,
      width: 2,
    });
    steps.forEach((s, i) => {
      const cx = MX + cw * i + cw / 2;
      const filled = i === 0 || slide.all;
      shapes.push({
        kind: "ellipse",
        x: cx - 0.3,
        y: lineY - 0.3,
        w: 0.6,
        h: 0.6,
        fill: filled ? t.accent : t.bg,
        line: t.accent,
      });
      shapes.push(
        text(cx - 0.3, lineY - 0.3, 0.6, 0.6, String(i + 1), {
          size: 16,
          bold: true,
          color: filled ? "FFFFFF" : t.accent,
          align: "center",
          valign: "middle",
        }),
      );
      const paragraphs = [
        para(String(s.label ?? ""), { size: 19, bold: true, color: t.ink }),
      ];
      if (s.text)
        paragraphs.push(
          para(String(s.text), { size: 15, color: t.soft, before: 8 }),
        );
      shapes.push(
        text(
          MX + cw * i + 0.15,
          lineY + 0.55,
          cw - 0.3,
          BOTTOM - lineY - 0.55,
          paragraphs,
          {
            size: 19,
            color: t.ink,
            align: "center",
            fit: 11,
            line: 1.05,
          },
        ),
      );
    });
  } else if (type === "cards") {
    const cards = slide.cards ?? [];
    if (cards.length < 2 || cards.length > 6)
      throw new Stop(`Slide ${n}: "cards" holds 2 to 6 cards.`);
    const cols = cards.length === 4 ? 2 : Math.min(3, cards.length);
    const rowsN = Math.ceil(cards.length / cols);
    const gap = 0.3;
    const cw = (CW - gap * (cols - 1)) / cols;
    const ch = (room - gap * (rowsN - 1)) / rowsN;
    cards.forEach((c, i) => {
      const x = MX + (i % cols) * (cw + gap);
      const y = top + Math.floor(i / cols) * (ch + gap);
      shapes.push(rect(x, y, cw, ch, t.surface));
      shapes.push(rect(x + 0.4, y + 0.4, 0.45, 0.06, t.accent));
      const paragraphs = [
        para(String(c.title ?? ""), { size: 20, bold: true, color: t.ink }),
      ];
      if (c.text)
        paragraphs.push(
          para(String(c.text), { size: 15, color: t.soft, before: 8 }),
        );
      shapes.push(
        text(x + 0.4, y + 0.62, cw - 0.8, ch - 0.9, paragraphs, {
          size: 20,
          color: t.ink,
          fit: 11,
          line: 1.05,
        }),
      );
    });
  } else if (type === "image") {
    if (!slide.image) throw new Stop(`Slide ${n}: "image" names no file.`);
    const side = slide.bullets || slide.caption;
    const iw = side ? 7.7 : CW;
    shapes.push(imageShape(slide.image, MX, top, iw, room, slide.fit));
    if (side)
      shapes.push(
        text(
          MX + iw + 0.45,
          top,
          CW - iw - 0.45,
          room,
          slide.bullets ? points(slide.bullets) : [para(slide.caption)],
          {
            ...bulletStyle(t, 18, 12),
            bullets: Boolean(slide.bullets),
            color: slide.bullets ? t.ink : t.soft,
          },
        ),
      );
  }
  return done();
}

// ——— The twin: the same boxes as HTML ———

const box = (s) =>
  `left:${(s.x * PX).toFixed(1)}px;top:${(s.y * PX).toFixed(1)}px;width:${(s.w * PX).toFixed(1)}px;height:${(s.h * PX).toFixed(1)}px`;

// PowerPoint's line spacing multiplies the font's own line height, which for Arial is about 1.15em
const CSS_LINE = 1.15;

function textHtml(s, id) {
  const html = s.paragraphs
    .map((p) => {
      const size = p.size ?? (p.level ? s.size * 0.85 : s.size);
      const em = (pt) => `${(pt / size).toFixed(3)}em`;
      const style = [
        `font-size:${(size / s.size).toFixed(4)}em`,
        p.color ? `color:#${p.color}` : "",
        p.bold === true
          ? "font-weight:700"
          : p.bold === false
            ? "font-weight:400"
            : "",
        p.before ? `margin-top:${em(p.before)}` : "",
        `margin-bottom:${em(p.after ?? s.after ?? 0)}`,
        p.spacing ? `letter-spacing:${p.spacing}pt` : "",
      ]
        .filter(Boolean)
        .join(";");
      const inner = p.runs
        .map((r) => (r.bold ? `<b>${esc(r.text)}</b>` : esc(r.text)))
        .join("");
      const bullet = s.bullets && !p.heading;
      const mark = bullet
        ? `<i style="color:#${s.bulletColor}">${p.number ? `${p.number}.` : p.level ? "–" : "•"}</i>`
        : "";
      return `<p class="${bullet ? `li${p.level ? " sub" : ""}` : ""}" style="${style}">${mark}${inner}</p>`;
    })
    .join("");
  const style = [
    box(s),
    `font-size:${s.size}pt`,
    `color:#${s.color}`,
    s.bold ? "font-weight:700" : "",
    `text-align:${s.align ?? "left"}`,
    `line-height:${((s.line ?? 1) * CSS_LINE).toFixed(3)}`,
    `justify-content:${{ top: "flex-start", middle: "center", bottom: "flex-end" }[s.valign ?? "top"]}`,
  ]
    .filter(Boolean)
    .join(";");
  return `<div class="t${s.nowrap ? " nowrap" : ""}" data-id="${id}" data-size="${s.size}" data-min="${s.fit ?? s.size}" style="${style}"><div class="in">${html}</div></div>`;
}

/** A cell reads as a number: it is aligned right, in the twin and in PowerPoint. */
const numeric = (v) => /^[\s$€£¥₩+-]*[\d.,]+\s*[%kKmMbB×x]?$/.test(v);

function tableHtml(s, id, t) {
  const right = s.columns.map((_, i) =>
    s.rows.every((r) => !r[i] || numeric(r[i])),
  );
  const head = s.columns
    .map(
      (c, i) =>
        `<th style="text-align:${right[i] ? "right" : "left"}">${esc(c)}</th>`,
    )
    .join("");
  const body = s.rows
    .map((r, k) => {
      const hi = s.highlight === k + 1;
      const bg = hi ? t.accentSoft : k % 2 ? t.surface : t.bg;
      return `<tr style="background:#${bg}${hi ? ";font-weight:700" : ""}">${r
        .map(
          (c, i) =>
            `<td style="text-align:${right[i] ? "right" : "left"}">${esc(c)}</td>`,
        )
        .join("")}</tr>`;
    })
    .join("");
  return `<div class="tb t" data-id="${id}" data-size="${s.size}" data-min="9" style="${box(s)};font-size:${s.size}pt"><div class="in"><table><thead><tr style="background:#${t.cover};color:#fff">${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}

function slideHtml(slide, i, t) {
  const inner = slide.shapes
    .map((s, k) => {
      const id = `${i}-${k}`;
      if (s.kind === "rect")
        return `<div style="${box(s)};background:#${s.fill}"></div>`;
      if (s.kind === "ellipse")
        return `<div style="${box(s)};background:#${s.fill};border:2px solid #${s.line};border-radius:50%"></div>`;
      if (s.kind === "line")
        return `<div style="${box({ ...s, h: 0 })};border-top:${s.width}px solid #${s.color}"></div>`;
      if (s.kind === "text") return textHtml(s, id);
      if (s.kind === "image")
        return `<img src="${esc(s.src)}" style="${box(s)};object-fit:${s.fit}">`;
      if (s.kind === "chart")
        return `<div style="${box(s)}">${chartSvg(s, t)}</div>`;
      if (s.kind === "table") return tableHtml(s, id, t);
      return "";
    })
    .join("\n");
  return `<section data-slide style="background:#${slide.bg}">${inner}</section>`;
}

function deckHtml(slides, t, title) {
  return `<!doctype html><html lang="${t.lang.slice(0, 2)}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page { size: ${W}in ${H}in; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; background: #fff }
body { font-family: "${esc(t.font)}", "Liberation Sans", Helvetica, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Hiragino Sans", "PingFang SC", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact }
section { position: relative; width: ${W * PX}px; height: ${H * PX}px; overflow: hidden; break-after: page }
section > * { position: absolute }
.t { display: flex; flex-direction: column; overflow: hidden; overflow-wrap: break-word }
.t .in { flex: none }
.nowrap p { white-space: nowrap }
/* Korean breaks between words, as PowerPoint sets it for Korean text */
:lang(ko) .t { word-break: keep-all }
.t p { margin: 0 }
.t p:last-child { margin-bottom: 0 !important }
.li { position: relative; padding-left: 1.2em }
.li.sub { margin-left: 1.2em }
.li i { position: absolute; left: 0; font-style: normal; font-weight: 700 }
.tb table { width: 100%; border-collapse: collapse }
.tb th { font-weight: 700; padding: .45em .7em }
.tb td { padding: .45em .7em; border-bottom: 1px solid #${t.rule}; color: #${t.ink} }
/* Every slide at a third of its size, three to a row: one picture of the whole deck */
body.overview { display: grid; grid-template-columns: repeat(3, ${(W * PX) / 3}px); gap: 12px; padding: 12px; width: max-content; background: #d9dce1 }
body.overview section { zoom: 0.3333 }
</style></head><body>
${slides.map((s, i) => slideHtml(s, i, t)).join("\n")}
</body></html>`;
}

// ——— The .pptx, from the same boxes ———

function addText(s, shape, t) {
  const ratio = (shape.fitted ?? shape.size) / shape.size;
  const pt = (v) => Math.round(v * ratio * 2) / 2;
  const list = [];
  shape.paragraphs.forEach((p, pi) => {
    const size = p.size ?? (p.level ? shape.size * 0.85 : shape.size);
    const bullet = shape.bullets && !p.heading;
    const paragraph = {
      ...(bullet
        ? {
            bullet: p.number
              ? { type: "number", indent: pt(size * 1.2) }
              : {
                  characterCode: p.level ? "2013" : "2022",
                  indent: pt(size * 1.2),
                },
            indentLevel: p.level ?? 0,
          }
        : {}),
      paraSpaceBefore: p.before ? pt(p.before) : 0,
      paraSpaceAfter:
        pi < shape.paragraphs.length - 1 ? pt(p.after ?? shape.after ?? 0) : 0,
    };
    // Paragraph options ride on the first run only: on a later one they start a new paragraph
    p.runs.forEach((r, ri) => {
      list.push({
        text: r.text,
        options: {
          ...(ri === 0 ? paragraph : {}),
          fontSize: pt(size),
          bold: r.bold || (p.bold ?? shape.bold ?? false),
          color: p.color ?? shape.color,
          lang: t.lang,
          ...(p.spacing ? { charSpacing: p.spacing } : {}),
          ...(ri === p.runs.length - 1 && pi < shape.paragraphs.length - 1
            ? { breakLine: true }
            : {}),
        },
      });
    });
  });
  s.addText(list, {
    x: shape.x,
    y: shape.y,
    w: shape.w,
    h: shape.h,
    fontFace: t.font,
    color: shape.color,
    align: shape.align ?? "left",
    valign: shape.valign ?? "top",
    margin: 0,
    lineSpacingMultiple: shape.line ?? 1,
    fit: "none",
    wrap: !shape.nowrap,
  });
}

const formatCode = (c) =>
  `${c.prefix ? `"${c.prefix}"` : ""}#,##0.##${c.unit ? `"${c.unit}"` : ""}`;

function addChart(s, shape, t) {
  const c = shape.chart;
  const kind = c.type ?? "bar";
  const type = { bar: "bar", line: "line", pie: "pie", doughnut: "doughnut" }[
    kind
  ];
  if (!type)
    throw new Stop(`Chart type "${kind}": bar, line, pie or doughnut.`);
  const round = kind === "pie" || kind === "doughnut";
  const data = c.series.map((one) => ({
    name: one.name ?? "",
    labels: c.labels.map(String),
    values: one.values.map(Number),
  }));
  s.addChart(type, round ? data.slice(0, 1) : data, {
    x: shape.x,
    y: shape.y,
    w: shape.w,
    h: shape.h,
    barDir: c.horizontal ? "bar" : "col",
    chartColors: t.series,
    fontFace: t.font,
    showLegend: round || c.series.length > 1,
    legendPos: round ? "r" : "b",
    legendFontSize: 14,
    legendColor: t.ink,
    catAxisLabelColor: t.ink,
    catAxisLabelFontSize: 14,
    catAxisLineShow: false,
    valAxisLabelColor: t.soft,
    valAxisLabelFontSize: 12,
    valAxisLineShow: false,
    valGridLine: { color: t.rule, size: 0.75 },
    valAxisLabelFormatCode: formatCode(c),
    showValue: c.values !== false && !round && c.series.length === 1,
    showPercent: round,
    dataLabelColor: round ? "FFFFFF" : t.ink,
    dataLabelFontSize: 12,
    dataLabelFormatCode: formatCode(c),
    dataLabelPosition: round ? "bestFit" : "outEnd",
    barGapWidthPct: 55,
    lineSize: 3,
    lineDataSymbolSize: 8,
    holeSize: 55,
  });
}

function addTable(s, shape, t) {
  const size = shape.fitted ?? shape.size;
  const right = shape.columns.map((_, i) =>
    shape.rows.every((r) => !r[i] || numeric(r[i])),
  );
  const rows = [
    shape.columns.map((c, i) => ({
      text: c,
      options: {
        bold: true,
        color: "FFFFFF",
        fill: { color: t.cover },
        align: right[i] ? "right" : "left",
      },
    })),
    ...shape.rows.map((r, k) =>
      r.map((c, i) => ({
        text: c,
        options: {
          color: t.ink,
          align: right[i] ? "right" : "left",
          bold: shape.highlight === k + 1,
          fill: {
            color:
              shape.highlight === k + 1
                ? t.accentSoft
                : k % 2
                  ? t.surface
                  : t.bg,
          },
        },
      })),
    ),
  ];
  s.addTable(rows, {
    x: shape.x,
    y: shape.y,
    w: shape.w,
    fontFace: t.font,
    fontSize: size,
    margin: [size * 0.45, size * 0.7, size * 0.45, size * 0.7],
    border: { type: "solid", pt: 0.5, color: t.rule },
    autoPage: false,
  });
}

function addImage(s, shape) {
  const ratio = shape.natural.h / shape.natural.w;
  if (shape.fit === "contain") {
    const w = shape.h / shape.w > ratio ? shape.w : shape.h / ratio;
    const h = w * ratio;
    s.addImage({
      path: shape.file,
      x: shape.x + (shape.w - w) / 2,
      y: shape.y + (shape.h - h) / 2,
      w,
      h,
    });
  } else
    s.addImage({
      path: shape.file,
      x: shape.x,
      y: shape.y,
      w: shape.w,
      h: shape.w * ratio,
      sizing: { type: "cover", w: shape.w, h: shape.h },
    });
}

async function writePptx(slides, outline, t, out) {
  const { default: PptxGenJS } = await kit("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = outline.title ?? "";
  if (outline.author) pptx.author = outline.author;
  for (const slide of slides) {
    const s = pptx.addSlide();
    s.background = { color: slide.bg };
    for (const shape of slide.shapes) {
      const at = { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
      if (shape.kind === "rect")
        s.addShape("rect", {
          ...at,
          fill: { color: shape.fill },
          line: { type: "none" },
        });
      else if (shape.kind === "ellipse")
        s.addShape("ellipse", {
          ...at,
          fill: { color: shape.fill },
          line: { color: shape.line, width: 1.5 },
        });
      else if (shape.kind === "line")
        s.addShape("line", {
          ...at,
          h: 0,
          line: { color: shape.color, width: shape.width * 0.75 },
        });
      else if (shape.kind === "text") addText(s, shape, t);
      else if (shape.kind === "image") addImage(s, shape);
      else if (shape.kind === "chart") addChart(s, shape, t);
      else if (shape.kind === "table") addTable(s, shape, t);
    }
    if (slide.notes) s.addNotes(String(slide.notes));
  }
  writeFileSync(
    out,
    await onePropertyBlock(await pptx.write({ outputType: "nodebuffer" })),
  );
}

/**
 * pptxgenjs writes a paragraph's properties again before every run after the first, which
 * PowerPoint may call a damaged file: each paragraph keeps its first `<a:pPr>` only.
 */
export async function onePropertyBlock(buffer) {
  const { default: JSZip } = await kit("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const PPR = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/g;
  for (const name of Object.keys(zip.files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    const xml = await zip.file(name).async("string");
    zip.file(
      name,
      xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (_, body) => {
        let seen = false;
        const kept = body.replace(PPR, (block) => {
          if (seen) return "";
          seen = true;
          return block;
        });
        return `<a:p>${kept}</a:p>`;
      }),
    );
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function deck(outlinePath, opts) {
  const outline = readJson(outlinePath);
  if (!Array.isArray(outline.slides) || !outline.slides.length)
    throw new Stop('The outline holds "slides": [ { "type": …, … } ].');
  const t = theme(outline);
  const stem =
    String(outline.title ?? "deck")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "deck";
  const pptxPath = output(opts.out, stem, "pptx");
  const pdfPath = twin(pptxPath, "pdf");
  const dir = workDir(pptxPath);
  clearPictures(dir);
  const { imageSize } = await import(
    shippedSkill("browser", "scripts", "image-size.mjs")
  );

  const slides = [];
  for (const [i, slide] of outline.slides.entries()) {
    const laid = layout(slide, outline, i + 1, t);
    laid.notes = slide.notes;
    for (const [k, s] of laid.shapes.entries()) {
      if (s.kind !== "image") continue;
      let file = input(s.file);
      // PowerPoint takes PNG and JPEG; anything else is redrawn as a PNG first
      if (!imageSize(file)) file = await asPng(file, dir);
      const natural = imageSize(file);
      if (!natural)
        throw new Stop(`Slide ${i + 1}: ${basename(s.file)} is not a picture.`);
      Object.assign(s, {
        file,
        natural,
        src: `slide-${i + 1}-${k}${extname(file).toLowerCase()}`,
      });
      writeFileSync(join(dir, s.src), readFileSync(file));
    }
    slides.push(laid);
  }

  const htmlPath = join(dir, "deck.html");
  writeFileSync(htmlPath, deckHtml(slides, t, outline.title ?? ""));
  const pngs = slides.map((_, i) =>
    join(dir, `slide-${String(i + 1).padStart(2, "0")}.png`),
  );
  const sheet = join(dir, "overview.png");
  const measured = await inTab(
    htmlPath,
    async (tab, { pngs, pdf, sheet }) => {
      // Each box's text shrinks half a point at a time until it fits, down to its floor
      const fitted = await tab.evaluate(() => {
        const out = {};
        for (const el of document.querySelectorAll(".t[data-id]")) {
          const min = Number(el.dataset.min);
          let size = Number(el.dataset.size);
          // Measured on the inner block: text pushed past the top of a centred box scrolls nowhere
          const inner = el.firstElementChild;
          const over = () =>
            inner.offsetHeight > el.clientHeight + 1 ||
            inner.scrollWidth > el.clientWidth + 1;
          while (over() && size > min) {
            size -= 0.5;
            el.style.fontSize = `${size}pt`;
          }
          out[el.dataset.id] = {
            size,
            over: over(),
            text: el.textContent.trim().slice(0, 50),
          };
        }
        return out;
      });
      const slides = tab.locator("section[data-slide]");
      const n = await slides.count();
      for (let i = 0; i < n; i++)
        await slides.nth(i).screenshot({ path: pngs[i], scale: "css" });
      await tab.pdf({
        path: pdf,
        preferCSSPageSize: true,
        printBackground: true,
      });
      await tab.evaluate(() => document.body.classList.add("overview"));
      await tab.screenshot({ path: sheet, fullPage: true, scale: "css" });
      return fitted;
    },
    { pngs, pdf: pdfPath, sheet },
  );
  if (measured.broken.length)
    throw new Stop(`Pictures that did not load: ${measured.broken.join(", ")}`);

  const overflow = [];
  const shrunk = [];
  slides.forEach((slide, i) => {
    slide.shapes.forEach((s, k) => {
      const m = measured.result[`${i}-${k}`];
      if (!m) return;
      s.fitted = m.size;
      if (m.over) overflow.push(`slide ${i + 1} "${m.text}…"`);
      // A number held to one line may shrink further before it reads small
      else if (m.size < s.size * (s.nowrap ? 0.5 : 0.75))
        shrunk.push(`slide ${i + 1} (${s.size}→${m.size}pt)`);
    });
  });
  await writePptx(slides, outline, t, pptxPath);

  const lines = [
    `${shown(pptxPath)} — ${slides.length} slides`,
    `${shown(pdfPath)} — the same deck as a PDF: the app shows this one, PowerPoint and Keynote open the .pptx`,
  ];
  if (overflow.length)
    lines.push(
      `Text that does not fit even at its smallest — cut words: ${overflow.join("; ")}`,
    );
  if (shrunk.length)
    lines.push(
      `Shrunk to fit, so it reads small — shorten it or split the slide: ${shrunk.join(", ")}`,
    );
  lines.push(
    `Look: ${shown(sheet)} (every slide), one slide: ${shown(pngs[0]).replace(/01\.png$/, "NN.png")}`,
  );
  console.log(lines.join("\n"));
}

const decodeXml = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** The words of a .pptx, slide by slide, with its speaker notes. */
export async function readPptx(file) {
  const { default: JSZip } = await kit("jszip");
  const zip = await JSZip.loadAsync(readFileSync(file));
  const number = (name) => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => number(a) - number(b));
  const paragraphs = (xml) =>
    [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
      .map((p) =>
        [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)]
          .map((m) => decodeXml(m[1]))
          .join(""),
      )
      .filter((line) => line.trim());
  const out = [];
  for (const name of slides) {
    const n = number(name);
    out.push(
      `## Slide ${n}`,
      ...paragraphs(await zip.file(name).async("string")),
    );
    const notes = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    if (notes) {
      const said = paragraphs(await notes.async("string")).filter(
        (l) => !/^\d+$/.test(l),
      );
      if (said.length) out.push(`Notes: ${said.join(" ")}`);
    }
  }
  return out.join("\n");
}
