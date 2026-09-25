#!/usr/bin/env node
// Draws a CSV into a page as one figure: an inline SVG chart, its source, and the rows
// behind it with a CSV download. The page is a document (the artifact skill's document.mjs)
// or any HTML file; the figure takes the place of the element with the given id, or ends
// the document's body (before </body> on any other page) when there is none. Run it again
// and the same figure is replaced.
//
//   node chart.mjs <page.html> <id> <data.csv> [options]
//   node chart.mjs <picture.svg> <data.csv> [options]
//                        the chart alone as a picture, its title and source on it, on a
//                        light card that reads on any ground: a deck's image slide (fit
//                        whole), a board, a post
//
//   --kind line|bar      line when the first column is dates, bar otherwise
//   --title "<text>"     what the chart shows (default: the CSV's `# title:`)
//   --columns a,b        which value columns to draw (default: all)
//   --from / --to        a date range to draw, YYYY[-MM[-DD]] or YYYY-Qn. Each bound takes
//                        the whole period named: --to 2025 keeps all of 2025.
//   --index              rebase every line to 100 at its first shared date
//   --mark "2025-03=Rate cut"   a dated event line, on a line chart; repeat for more
//   --unit "%"  --prefix "$"    around every number shown
//   --highlight "<label>"       the one bar in the accent color; the rest go quiet (bars only)
//   --keep-order         bars in the CSV's order instead of largest first
//   --source "<url or text>"    when the CSV has no `# source:` line
//   --note "<text>"      one line under the chart: an estimate, a gap, a break in the series
//   --locale de          how numbers and dates are written: the reader's language tag
//
// An unknown --kind, a bound that is not a date, a --highlight naming no row and a --mark
// outside the range drawn all stop, rather than draw something quietly wrong.
//
// The figure carries no words of its own beyond what it is given, so it reads the same
// in any language: the site's name, a date, "CSV".
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  END,
  editedSince,
  getBetween,
  keep,
  restamp,
} from "../runtime/shell/put.mjs";

class Stop extends Error {}

/** The comment at the top of this file, which is its manual. */
const usage = () => {
  const lines = readFileSync(new URL(import.meta.url), "utf8")
    .split("\n")
    .slice(1);
  const end = lines.findIndex((line) => !line.startsWith("//"));
  return lines
    .slice(0, end)
    .map((line) => line.replace(/^\/\/ ?/, ""))
    .join("\n");
};

function parseArgs(argv) {
  const positional = [];
  const flags = { mark: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    const value =
      next === undefined || next.startsWith("--") ? true : (i++, next);
    if (key === "mark") flags.mark.push(value);
    else flags[key] = value;
  }
  return { positional, flags };
}

// ── CSV ────────────────────────────────────────────────────────────────────

function splitLine(line) {
  const cells = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") cells.push(cur), (cur = "");
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function readCsv(path) {
  if (!existsSync(path)) throw new Stop(`No CSV at ${path}.`);
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const meta = {};
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^#\s*([\w-]+):\s*(.*)$/);
    if (m) meta[m[1].toLowerCase()] = m[2];
    else if (!line.startsWith("#")) lines.push(splitLine(line));
  }
  if (lines.length < 2) throw new Stop(`${path} has no rows under its header.`);
  const [header, ...rows] = lines;
  return { meta, header, rows, text };
}

const toNumber = (cell) => {
  if (cell === undefined || cell === "") return null;
  const n = Number(String(cell).replace(/[,\s%$₩€£¥]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** YYYY, YYYY-MM, YYYY-MM-DD, YYYY-Qn and YYYYQn as a UTC time; null when it is not a date. */
function toTime(cell) {
  const s = String(cell).trim();
  let m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?(?:[T ].*)?$/);
  if (m) return Date.UTC(+m[1], m[2] ? +m[2] - 1 : 0, m[3] ? +m[3] : 1);
  m = s.match(/^(\d{4})-?Q([1-4])$/i);
  if (m) return Date.UTC(+m[1], (+m[2] - 1) * 3, 1);
  return null;
}

/**
 * A `--from` or `--to` bound, as the start of the period named or (with `end`) its last day:
 * a bound written as a year or a month covers all of it. Null when it is not a date.
 */
function toBound(value, end) {
  const s = String(value).trim();
  let m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (m) {
    const [, y, mo, d] = m;
    if (d) return Date.UTC(+y, +mo - 1, +d);
    if (mo) return end ? Date.UTC(+y, +mo, 0) : Date.UTC(+y, +mo - 1, 1);
    return end ? Date.UTC(+y, 11, 31) : Date.UTC(+y, 0, 1);
  }
  m = s.match(/^(\d{4})-?Q([1-4])$/i);
  if (m)
    return end
      ? Date.UTC(+m[1], +m[2] * 3, 0)
      : Date.UTC(+m[1], (+m[2] - 1) * 3, 1);
  return null;
}

// ── Numbers ────────────────────────────────────────────────────────────────

function formatter(locale, flags) {
  const prefix = typeof flags.prefix === "string" ? flags.prefix : "";
  const unit = typeof flags.unit === "string" ? flags.unit : "";
  const wrap = (s) =>
    `${prefix}${s}${unit && !unit.startsWith(" ") && unit.length > 1 ? " " : ""}${unit}`;
  const compact = (v) =>
    new Intl.NumberFormat(locale, {
      notation: Math.abs(v) >= 10_000 ? "compact" : "standard",
      maximumSignificantDigits: 3,
    }).format(v);
  // As published: the decimals the source gave, only grouped
  const exact = (raw) => {
    const v = toNumber(raw);
    const decimals = (String(raw).split(".")[1] ?? "").replace(
      /\D/g,
      "",
    ).length;
    return wrap(
      new Intl.NumberFormat(locale, {
        maximumFractionDigits: Math.min(decimals, 6),
      }).format(v),
    );
  };
  // A label on a point: up to two decimals below a million, compact past it
  const label = (v) =>
    wrap(
      Math.abs(v) >= 1_000_000
        ? compact(v)
        : new Intl.NumberFormat(locale, {
            maximumFractionDigits: Math.abs(v) >= 1 ? 2 : 4,
          }).format(v),
    );
  return { short: (v) => wrap(compact(v)), exact, label };
}

function niceTicks(min, max, count = 5) {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step)
    ticks.push(+v.toPrecision(12));
  return ticks;
}

function timeTicks(t0, t1, locale, most = 7) {
  const DAY = 86_400_000;
  const years = (t1 - t0) / (365.25 * DAY);
  const ticks = [];
  const d0 = new Date(t0);
  if (years >= 3) {
    const every = [1, 2, 5, 10, 20, 50].find((k) => years / k <= most);
    for (
      let y = Math.ceil(d0.getUTCFullYear() / every) * every;
      Date.UTC(y, 0, 1) <= t1;
      y += every
    )
      if (Date.UTC(y, 0, 1) >= t0)
        ticks.push({ t: Date.UTC(y, 0, 1), label: String(y) });
    return ticks;
  }
  const months = years * 12;
  if (months >= 2) {
    const every = [1, 2, 3, 6].find((k) => months / k <= most) ?? 12;
    const month = new Intl.DateTimeFormat(locale, {
      month: "short",
      timeZone: "UTC",
    });
    let y = d0.getUTCFullYear();
    let m = d0.getUTCMonth() + (d0.getUTCDate() > 1 ? 1 : 0);
    m = Math.ceil(m / every) * every;
    for (let first = true; ; m += every) {
      const t = Date.UTC(y, m, 1);
      if (t > t1) break;
      const date = new Date(t);
      const label =
        first || date.getUTCMonth() === 0
          ? `${month.format(date)} ${date.getUTCFullYear()}`
          : month.format(date);
      ticks.push({ t, label });
      first = false;
    }
    return ticks;
  }
  const dayFmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const days = (t1 - t0) / DAY;
  const every = [1, 2, 7, 14].find((k) => days / k <= most) ?? 14;
  for (
    let t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
    t <= t1;
    t += every * DAY
  )
    ticks.push({ t, label: dayFmt.format(new Date(t)) });
  return ticks;
}

// ── Drawing ────────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
/** A width for text that is only measured, never shown: about 0.58em a character, 1em for CJK. */
const textWidth = (s, size) =>
  [...String(s)].reduce(
    (w, ch) =>
      w + (/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af]/.test(ch) ? 1 : 0.58),
    0,
  ) * size;
const FONT = 13;
// Every chart is drawn twice and CSS shows one: text in an SVG scales with it, so a
// wide drawing squeezed onto a phone would read at half size
const SIZES = {
  wide: { W: 640, ticks: 7, endCap: 170, labelChars: 26, nameChars: 24 },
  narrow: { W: 360, ticks: 4, endCap: 124, labelChars: 14, nameChars: 10 },
};
const cut = (s, n) =>
  [...String(s)].length > n
    ? `${[...String(s)].slice(0, n - 1).join("")}…`
    : String(s);

function lineChart({ xs, labels, series, fmt, marks, indexed, locale, size }) {
  const { W } = size;
  const H = size.W < 500 ? 260 : 320;
  const all = series.flatMap((s) => s.values).filter((v) => v !== null);
  const yTicks = niceTicks(
    Math.min(...all),
    Math.max(...all),
    size.W < 500 ? 4 : 5,
  );
  const [yMin, yMax] = [yTicks[0], yTicks.at(-1)];
  const lastOf = (s) => {
    for (let i = s.values.length - 1; i >= 0; i--)
      if (s.values[i] !== null) return i;
    return -1;
  };
  const ends = series.map((s) => {
    const i = lastOf(s);
    const text = `${series.length > 1 ? `${cut(s.name, size.nameChars)} ` : ""}${fmt.label(s.values[i])}`;
    return { s, i, text };
  });
  const left =
    Math.max(...yTicks.map((v) => textWidth(fmt.short(v), FONT))) + 14;
  const right = Math.min(
    size.endCap,
    Math.max(...ends.map((e) => textWidth(e.text, FONT))) + 16,
  );
  const top = marks.length ? 34 : 14;
  const bottom = 30;
  const [t0, t1] = [xs[0], xs.at(-1)];
  const px = (t) => left + ((t - t0) / (t1 - t0 || 1)) * (W - left - right);
  const py = (v) => top + (1 - (v - yMin) / (yMax - yMin)) * (H - top - bottom);

  const parts = [];
  for (const v of yTicks) {
    parts.push(
      `<line class="grid${indexed && v === 100 ? " base" : ""}" x1="${left}" x2="${W - right}" y1="${py(v)}" y2="${py(v)}"/>`,
    );
    parts.push(
      `<text class="tick" x="${left - 8}" y="${py(v) + 4}" text-anchor="end">${esc(fmt.short(v))}</text>`,
    );
  }
  for (const { t, label } of timeTicks(t0, t1, locale, size.ticks))
    parts.push(
      `<text class="tick" x="${px(t)}" y="${H - 8}" text-anchor="middle">${esc(label)}</text>`,
    );
  marks.forEach(({ t, text }, k) => {
    if (t < t0 || t > t1) return;
    const x = px(t);
    const anchor = x > left + (W - left - right) * 0.7 ? "end" : "start";
    parts.push(
      `<line class="mark" x1="${x}" x2="${x}" y1="${top - 6}" y2="${H - bottom}"/>`,
    );
    parts.push(
      `<text class="mark-label" x="${x + (anchor === "start" ? 4 : -4)}" y="${k % 2 ? top - 20 : top - 8}" text-anchor="${anchor}">${esc(cut(text, size.labelChars + 6))}</text>`,
    );
  });
  series.forEach((s, n) => {
    let d = "";
    let pen = false;
    // A series published less often than the others (weekly beside daily) is empty on most
    // rows and joins across them; a denser one breaks its line where a value is missing
    const sparse =
      s.values.filter((v) => v !== null).length < s.values.length / 2;
    s.values.forEach((v, i) => {
      if (v === null) return void (pen = pen && sparse);
      d += `${pen ? "L" : "M"}${px(xs[i]).toFixed(1)},${py(v).toFixed(1)}`;
      pen = true;
    });
    parts.push(`<path class="line c${(n % 6) + 1}" d="${d}"/>`);
  });
  // End labels, pushed apart so two lines ending close together stay readable
  const placed = ends
    .filter((e) => e.i >= 0)
    .map((e) => ({ ...e, y: py(e.s.values[e.i]) }))
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < placed.length; k++)
    placed[k].y = Math.max(placed[k].y, placed[k - 1].y + 16);
  for (const e of placed) {
    const n = series.indexOf(e.s);
    parts.push(
      `<circle class="dot c${(n % 6) + 1}" cx="${px(xs[e.i])}" cy="${py(e.s.values[e.i])}" r="3.5"/>`,
    );
    parts.push(
      `<text class="end c${(n % 6) + 1}" x="${W - right + 8}" y="${e.y + 4}">${esc(e.text)}</text>`,
    );
  }
  const data = {
    x: xs.map((t) => +px(t).toFixed(1)),
    labels,
    series: series.map((s) => ({
      name: s.name,
      values: s.values.map((v) => (v === null ? null : fmt.label(v))),
      y: s.values.map((v) => (v === null ? null : +py(v).toFixed(1))),
    })),
    top,
    bottom: H - bottom,
    width: W,
  };
  return {
    svg: `<svg class="chart-svg ${size.W < 500 ? "narrow" : "wide"}" viewBox="0 0 ${W} ${H}" role="img" data-chart='${esc(JSON.stringify(data))}'>${parts.join("")}<g class="hover"></g></svg>`,
    axis: indexed ? `100 = ${indexed}` : null,
  };
}

function barChart({ labels, series, fmt, highlight, size }) {
  const { W } = size;
  const groups = labels.length;
  const per = series.length;
  const barH = per > 1 ? 14 : 22;
  const gap = per > 1 ? 14 : 10;
  const legend = per > 1 ? 26 : 0;
  const H = legend + groups * (per * barH + gap) + 8;
  const all = series.flatMap((s) => s.values).filter((v) => v !== null);
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const shownLabel = (l) => cut(l, size.labelChars);
  const left = Math.min(
    size.W < 500 ? 130 : 220,
    Math.max(...labels.map((l) => textWidth(shownLabel(l), FONT))) + 14,
  );
  const valueRoom =
    Math.max(...all.map((v) => textWidth(fmt.label(v), FONT))) + 12;
  const span = W - left - valueRoom - (lo < 0 ? valueRoom : 0);
  const px = (v) =>
    left + (lo < 0 ? valueRoom : 0) + ((v - lo) / (hi - lo || 1)) * span;
  const parts = [];
  if (per > 1)
    series.forEach((s, n) => {
      const x = (size.W < 500 ? 0 : left) + n * (size.W < 500 ? 110 : 130);
      parts.push(
        `<rect class="bar c${(n % 6) + 1}" x="${x}" y="4" width="12" height="12" rx="2"/>`,
      );
      parts.push(
        `<text class="tick" x="${x + 18}" y="14">${esc(cut(s.name, size.nameChars + 2))}</text>`,
      );
    });
  labels.forEach((label, g) => {
    const y0 = legend + g * (per * barH + gap);
    const quiet = highlight && label !== highlight;
    parts.push(
      `<text class="label${quiet ? " quiet-text" : ""}" x="${left - 10}" y="${y0 + (per * barH) / 2 + 4}" text-anchor="end">${esc(shownLabel(label))}<title>${esc(label)}</title></text>`,
    );
    series.forEach((s, n) => {
      const v = s.values[g];
      if (v === null) return;
      const [a, b] = [px(Math.min(0, v)), px(Math.max(0, v))];
      const y = y0 + n * barH;
      // One series: the highlighted bar takes the accent. Several: it keeps the legend's colors
      const color = quiet
        ? "quiet"
        : highlight && per === 1
          ? "c1"
          : `c${(n % 6) + 1}`;
      parts.push(
        `<rect class="bar ${color}" x="${a}" y="${y + 1}" width="${Math.max(1, b - a)}" height="${barH - 2}" rx="3"><title>${esc(label)}${per > 1 ? ` — ${esc(s.name)}` : ""}: ${esc(fmt.label(v))}</title></rect>`,
      );
      const tx = v < 0 ? a - 6 : b + 6;
      parts.push(
        `<text class="value" x="${tx}" y="${y + barH / 2 + 4}" text-anchor="${v < 0 ? "end" : "start"}">${esc(fmt.label(v))}</text>`,
      );
    });
  });
  if (lo < 0)
    parts.push(
      `<line class="zero" x1="${px(0)}" x2="${px(0)}" y1="${legend}" y2="${H - 8}"/>`,
    );
  return {
    svg: `<svg class="chart-svg ${size.W < 500 ? "narrow" : "wide"}" viewBox="0 0 ${W} ${H}" role="img">${parts.join("")}</svg>`,
    axis: null,
  };
}

// ── The page ───────────────────────────────────────────────────────────────

const STYLE = `<style id="chart-style">
.chart{margin:1.5rem 0 2rem}
.chart-title{margin:0 0 .15rem;font-weight:600}
.chart-sub{margin:0 0 .6rem;font-size:.85rem;color:var(--muted,#71717a)}
.chart-svg{display:block;width:100%;height:auto;overflow:visible;border-radius:0;font:${FONT}px ui-sans-serif,system-ui,-apple-system,sans-serif;font-variant-numeric:tabular-nums;touch-action:pan-y}
.chart-svg .grid{stroke:var(--line,#e4e4e7);stroke-width:1}
.chart-svg .grid.base,.chart-svg .zero{stroke:var(--muted,#71717a);stroke-dasharray:3 3}
.chart-svg .tick,.chart-svg .mark-label{fill:var(--muted,#71717a)}
.chart-svg .label,.chart-svg .value{fill:var(--fg,#18181b)}
.chart-svg .quiet-text{fill:var(--muted,#71717a)}
.chart-svg .mark{stroke:var(--muted,#71717a);stroke-dasharray:2 3}
.chart-svg .mark-label{font-size:11px}
.chart-svg .line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.chart-svg .end{font-weight:600}
.chart-svg .c1{--c:#2563eb}.chart-svg .c2{--c:#d97706}.chart-svg .c3{--c:#059669}.chart-svg .c4{--c:#db2777}.chart-svg .c5{--c:#7c3aed}.chart-svg .c6{--c:#64748b}
.chart-svg .quiet{--c:color-mix(in srgb,var(--muted,#71717a) 45%,transparent)}
.chart-svg .line{stroke:var(--c)}.chart-svg .dot,.chart-svg .bar{fill:var(--c)}.chart-svg .end{fill:var(--c)}
.chart-svg .hover line{stroke:var(--muted,#71717a)}
.chart-svg .hover rect{fill:var(--bg,#fff);stroke:var(--line,#e4e4e7)}
.chart-svg .hover text{fill:var(--fg,#18181b);font-size:12px}
.chart-svg.narrow{display:none}
@media (max-width:560px){.chart-svg.wide{display:none}.chart-svg.narrow{display:block}}
.chart .source{margin:.4rem 0 .6rem;font-size:.85rem;color:var(--muted,#71717a)}
.chart details{margin:0;font-size:.9rem}
@media (prefers-color-scheme:dark){.chart-svg .c1{--c:#60a5fa}.chart-svg .c2{--c:#fbbf24}.chart-svg .c3{--c:#34d399}.chart-svg .c4{--c:#f472b6}.chart-svg .c5{--c:#a78bfa}.chart-svg .c6{--c:#94a3b8}}
</style>`;

// Reads every line chart's own data off its svg: a readout follows the pointer
const SCRIPT = `<script id="chart-script">
document.querySelectorAll("svg[data-chart]").forEach(function(svg){
  var d=JSON.parse(svg.getAttribute("data-chart")),g=svg.querySelector(".hover"),NS="http://www.w3.org/2000/svg";
  function el(n,a){var e=document.createElementNS(NS,n);for(var k in a)e.setAttribute(k,a[k]);g.appendChild(e);return e}
  function show(ev){
    var p=svg.createSVGPoint();p.x=ev.clientX;p.y=ev.clientY;var x=p.matrixTransform(svg.getScreenCTM().inverse()).x,i=0;
    for(var k=1;k<d.x.length;k++)if(Math.abs(d.x[k]-x)<Math.abs(d.x[i]-x))i=k;
    g.innerHTML="";el("line",{x1:d.x[i],x2:d.x[i],y1:d.top,y2:d.bottom});
    var lines=[d.labels[i]].concat(d.series.filter(function(s){return s.values[i]!==null}).map(function(s){return(d.series.length>1?s.name+": ":"")+s.values[i]}));
    d.series.forEach(function(s,n){if(s.y[i]!==null)el("circle",{cx:d.x[i],cy:s.y[i],r:4,"class":"dot c"+(n%6+1)})});
    var w=Math.max.apply(null,lines.map(function(l){return l.length}))*7+16,h=lines.length*16+10,bx=d.x[i]+10+w>d.width?d.x[i]-10-w:d.x[i]+10;
    el("rect",{x:bx,y:d.top,width:w,height:h,rx:6});
    lines.forEach(function(l,n){var t=el("text",{x:bx+8,y:d.top+18+n*16});t.textContent=l;if(!n)t.setAttribute("font-weight","600")});
  }
  svg.addEventListener("pointermove",show);svg.addEventListener("pointerleave",function(){g.innerHTML=""});
});
</script>`;

function both(draw) {
  const wide = draw(SIZES.wide);
  return { svg: `${wide.svg}\n${draw(SIZES.narrow).svg}`, axis: wide.axis };
}

function sourceLinks(text) {
  const hosts = new Set();
  return String(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (!/^https?:\/\//.test(part)) return esc(part);
      const host = new URL(part).hostname.replace(/^www\./, "");
      // One link a site: the CSV keeps every address
      if (hosts.has(host)) return "";
      hosts.add(host);
      return `<a href="${esc(part)}">${esc(host)}</a>`;
    })
    .filter(Boolean)
    .join(" ")
    .replace(/(<\/a>) (<a )/g, "$1, $2");
}

/**
 * The chart alone as an SVG file: its title and unit above, its source below, on a light card
 * of its own, since a picture does not know the ground it will sit on. The page's stylesheet
 * travels inside it, with the light colours only, and without the readout, which needs a page.
 */
function writePicture(path, { svg, title, sub, source }) {
  const [, W, H] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) ?? [];
  const pad = 24;
  const head = 22 + (sub ? 20 : 0) + 12;
  const foot = source ? 30 : 8;
  const width = Number(W) + pad * 2;
  const height = pad + head + Number(H) + foot + pad;
  const inner = svg
    .replace(/ data-chart='[^']*'/, "")
    .replace('<g class="hover"></g>', "")
    .replace(/class="chart-svg (wide|narrow)"/, 'class="chart-svg"')
    .replace(
      "<svg ",
      `<svg x="${pad}" y="${pad + head}" width="${W}" height="${H}" `,
    );
  // The drawing's own rules; the page's sizing rule (width 100%) would stretch the inner
  // drawing past the card, where its size attributes are what it keeps
  const style = STYLE.replace(/<\/?style[^>]*>/g, "")
    .split("\n")
    .filter(
      (line) =>
        line.startsWith(".chart-svg") &&
        !line.startsWith(".chart-svg{") &&
        !line.includes(".narrow") &&
        !line.includes(".hover"),
    )
    .join("\n");
  const plainSource = String(source ?? "")
    .split(/\s+/)
    .map((part) =>
      /^https?:\/\//.test(part)
        ? new URL(part).hostname.replace(/^www\./, "")
        : part,
    )
    .join(" ");
  const file = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">
<style>
.pic{font:${FONT}px ui-sans-serif,system-ui,-apple-system,sans-serif;font-variant-numeric:tabular-nums}
.pic-title{font-size:16px;font-weight:600;fill:#18181b}
.pic-sub,.pic-source{font-size:12px;fill:#71717a}
${style}
</style>
<g class="pic">
<rect width="${width}" height="${height}" rx="14" fill="#ffffff"/>
<text class="pic-title" x="${pad}" y="${pad + 16}">${esc(title)}</text>
${sub ? `<text class="pic-sub" x="${pad}" y="${pad + 36}">${esc(sub)}</text>` : ""}
${inner}
${plainSource ? `<text class="pic-source" x="${pad}" y="${height - pad}">${esc(plainSource)}</text>` : ""}
</g>
</svg>
`;
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, file);
}

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  // A picture takes no page and no id: the first path names what is written
  const picture = /\.svg$/i.test(positional[0] ?? "") ? positional[0] : null;
  const [pagePath, id, csvPath] = picture
    ? [null, null, positional[1]]
    : positional;
  if (!csvPath || (!picture && (!pagePath || !id))) throw new Stop(usage());
  if (!picture && !/^[\w-]+$/.test(id))
    throw new Stop(`"${id}" is not an id: letters, numbers, - and _ only.`);
  if (!picture && !existsSync(pagePath))
    throw new Stop(
      `No page at ${pagePath}. Put a document first (the artifact skill's document.mjs), or give any HTML file.`,
    );
  const locale = typeof flags.locale === "string" ? flags.locale : "en";
  const fmt = formatter(locale, flags);

  const { meta, header, rows, text } = readCsv(csvPath);
  const wanted =
    typeof flags.columns === "string"
      ? flags.columns.split(",").map((c) => c.trim())
      : header.slice(1);
  const cols = wanted.map((name) => {
    const at = header.indexOf(name);
    if (at < 1)
      throw new Stop(
        `No column "${name}" in ${csvPath}; it has ${header.slice(1).join(", ")}.`,
      );
    return at;
  });
  const dated = rows.every((r) => toTime(r[0]) !== null);
  const kind = flags.kind ?? (dated ? "line" : "bar");
  if (kind !== "line" && kind !== "bar")
    throw new Stop(`"${flags.kind}" is not a kind: --kind line or --kind bar.`);
  if (kind === "line" && !dated)
    throw new Stop(
      "A line needs dates in the first column (YYYY, YYYY-MM, YYYY-MM-DD or YYYY-Qn); draw categories with --kind bar.",
    );

  const bound = (key, end) => {
    if (flags[key] === undefined) return null;
    const t = toBound(flags[key], end);
    if (t === null)
      throw new Stop(
        `--${key} "${flags[key]}" is not a date: YYYY, YYYY-MM, YYYY-MM-DD or YYYY-Qn.`,
      );
    return t;
  };
  const lo = bound("from", false);
  const hi = bound("to", true);
  if (!dated && (lo !== null || hi !== null))
    throw new Stop(
      "--from and --to need dates in the first column; this CSV has categories in it.",
    );

  let body = rows;
  if (dated)
    body = rows
      .map((r) => ({ r, t: toTime(r[0]) }))
      .filter(({ t }) => (lo === null || t >= lo) && (hi === null || t <= hi))
      .sort((a, b) => a.t - b.t)
      .map(({ r }) => r);
  if (!body.length) throw new Stop("No rows left to draw in that range.");

  const highlight = flags.highlight;
  if (highlight !== undefined) {
    if (typeof highlight !== "string")
      throw new Stop('--highlight needs a row: --highlight "<label>".');
    if (kind !== "bar")
      throw new Stop(
        "--highlight picks out one bar; a line chart has none. Drop it, or draw --kind bar.",
      );
    if (!body.some((r) => r[0] === highlight))
      throw new Stop(
        `--highlight "${highlight}" is not one of the rows: ${body.map((r) => r[0]).join(", ")}.`,
      );
  }
  if (flags.mark.length && kind !== "line")
    throw new Stop(
      "--mark draws a dated line on a line chart; a bar chart has no date axis. Put the event in --note instead.",
    );

  let series = cols.map((c) => ({
    name: header[c],
    values: body.map((r) => toNumber(r[c])),
  }));
  if (series.every((s) => s.values.every((v) => v === null)))
    throw new Stop(`No numbers in ${wanted.join(", ")}.`);

  let chart;
  let lineDraw;
  let barDraw;
  if (kind === "line") {
    let indexed = null;
    if (flags.index) {
      const start = body.findIndex((_, i) =>
        series.every((s) => s.values[i] !== null && s.values[i] !== 0),
      );
      if (start < 0)
        throw new Stop(
          "--index needs one date where every column has a value.",
        );
      indexed = body[start][0];
      series = series.map((s) => ({
        ...s,
        values: s.values.map((v, i) =>
          v === null || i < start ? null : (v / s.values[start]) * 100,
        ),
      }));
    }
    const xs = body.map((r) => toTime(r[0]));
    const marks = flags.mark.map((m) => {
      const [date, ...label] = String(m).split("=");
      const t = toTime(date);
      if (t === null)
        throw new Stop(
          `--mark "${m}" needs a date first: --mark "2025-03=Rate cut".`,
        );
      if (t < xs[0] || t > xs.at(-1))
        throw new Stop(
          `--mark "${m}" falls outside ${body[0][0]} → ${body.at(-1)[0]}, the rows drawn; it would not appear. Widen --from/--to or drop the mark.`,
        );
      return { t, text: label.join("=") || date };
    });
    lineDraw = (size) =>
      lineChart({
        xs,
        labels: body.map((r) => r[0]),
        series,
        fmt: indexed ? formatter(locale, {}) : fmt,
        marks,
        indexed,
        locale,
        size,
      });
    chart = both(lineDraw);
  } else {
    let order = body.map((_, i) => i);
    if (!flags["keep-order"])
      order.sort(
        (a, b) =>
          (series[0].values[b] ?? -Infinity) -
          (series[0].values[a] ?? -Infinity),
      );
    barDraw = (size) =>
      barChart({
        labels: order.map((i) => body[i][0]),
        series: series.map((s) => ({
          ...s,
          values: order.map((i) => s.values[i]),
        })),
        fmt,
        highlight: highlight ?? null,
        size,
      });
    chart = both(barDraw);
  }

  const title =
    typeof flags.title === "string"
      ? flags.title
      : (meta.title ?? header.slice(1).join(", "));
  const sub = [
    chart.axis,
    meta.unit && !flags.unit && !flags.prefix && !chart.axis ? meta.unit : null,
  ]
    .filter(Boolean)
    .join(" ");
  const source = typeof flags.source === "string" ? flags.source : meta.source;
  // A note given here replaces the CSV's own, so it can be said in the page's language
  const note = typeof flags.note === "string" ? flags.note : meta.note;
  const said = [
    source
      ? `${sourceLinks(source)}${meta.fetched ? ` (${esc(meta.fetched)})` : ""}`
      : "",
    note ? esc(note) : "",
  ].filter(Boolean);
  const sourceLine = said.length
    ? `<p class="source">${said.join(". ")}</p>`
    : "";
  const table = `<table><thead><tr>${[header[0], ...cols.map((c) => header[c])].map((h, i) => `<th${i ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body
    .map(
      (r) =>
        `<tr><td>${esc(r[0])}</td>${cols.map((c) => `<td class="num">${toNumber(r[c]) === null ? "—" : esc(fmt.exact(r[c]))}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody></table>`;
  if (picture) {
    const drawn = (kind === "line" ? lineDraw : barDraw)(SIZES.wide);
    writePicture(picture, {
      svg: drawn.svg,
      title,
      sub,
      source: [source, note].filter(Boolean).join(". "),
    });
    console.log(
      `Drew "${title}" (${kind}, ${body.length} rows) as a picture: ${picture}. On a deck, an image slide with fit "whole"; elsewhere an <img>.`,
    );
    return;
  }
  const download = `data:text/csv;charset=utf-8,${encodeURIComponent(text)}`;
  const figure = `<figure id="${id}" class="chart">
<p class="chart-title">${esc(title)}</p>${sub ? `\n<p class="chart-sub">${esc(sub)}</p>` : ""}
${chart.svg}
${sourceLine}
<details><summary>CSV (${body.length})</summary><div class="scroll">${table}</div><p><a download="${esc(id)}.csv" href="${download}">${esc(id)}.csv</a></p></details>
</figure>`;

  let html = readFileSync(pagePath, "utf8");
  // Whether the reader changed the document since the bot last put or got it (put.mjs)
  const edited = editedSince(html);
  const span = elementSpan(html, id);
  const selfClosed = new RegExp(
    `<(figure|div|section|p)\\b[^>]*\\bid=["']${id}["'][^>]*/>`,
  );
  // An empty figure still waiting under another id is where this chart was meant to go: a
  // mismatched id would leave that place blank and put the chart at the end of the page
  const waiting = [
    ...html.matchAll(/<figure\b[^>]*\bid=["']([\w-]+)["'][^>]*>\s*<\/figure>/g),
  ].map((match) => match[1]);
  if (span) html = html.slice(0, span[0]) + figure + html.slice(span[1]);
  else if (selfClosed.test(html)) html = html.replace(selfClosed, () => figure);
  else if (waiting.length)
    throw new Stop(
      `The page has no element with id "${id}", and its empty figures wait for ${waiting.map((one) => `"${one}"`).join(", ")}. Draw into one of those ids, or fill them first.`,
    );
  else if (html.includes(END))
    html = html.replace(END, () => `${figure}\n${END}`);
  else if (html.includes("</body>"))
    html = html.replace("</body>", () => `${figure}\n</body>`);
  else html += `\n${figure}\n`;

  html = html.replace(/<style id="chart-style">[\s\S]*?<\/style>\s*/, "");
  html = html.replace(/<script id="chart-script">[\s\S]*?<\/script>\s*/, "");
  html = html.includes("</head>")
    ? html.replace("</head>", () => `${STYLE}\n</head>`)
    : STYLE + html;
  html = html.includes("</body>")
    ? html.replace("</body>", () => `${SCRIPT}\n</body>`)
    : html + SCRIPT;
  // The figure is the bot's own writing, so a document keeps it as part of what the bot
  // put: its next put goes through, unless the reader's edits came first and it must get
  // them. A new revision turns away a save from the page open in the app before this.
  if (!edited) html = getBetween(html)?.html ?? html;
  keep(pagePath, restamp(html));

  const drawn = series.map((s) => {
    const vals = s.values.filter((v) => v !== null);
    return `${s.name} ${fmt.label(vals[0])} → ${fmt.label(vals.at(-1))}`;
  });
  console.log(
    `Drew "${title}" (${kind}, ${body.length} rows) into ${pagePath} as #${id}. ${kind === "line" ? `First → last: ${drawn.join("; ")}.` : ""}`.trim(),
  );
}

/**
 * Where the element holding `id` starts and ends in the page: its opening tag, then every tag
 * of its own name after it counted in and out until its own close. Stopping at the first
 * close instead cut a placeholder holding one of its kind short, and left the rest of it
 * after the chart.
 */
function elementSpan(html, id) {
  const safe = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(
    `<(figure|div|section|p)\\b[^>]*\\bid=["']${safe}["'][^>]*>`,
    "i",
  ).exec(html);
  if (!found || found[0].endsWith("/>")) return null;
  const tags = new RegExp(`<(/?)${found[1]}\\b[^>]*>`, "gi");
  tags.lastIndex = found.index + found[0].length;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    if (tag[0].endsWith("/>")) continue;
    depth += tag[1] ? -1 : 1;
    if (!depth) return [found.index, tag.index + tag[0].length];
  }
  throw new Stop(
    `The <${found[1]} id="${id}"> in the page is never closed: close it, then draw again.`,
  );
}

try {
  main();
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
