// A chart in the deck's PDF twin, drawn as SVG in the deck's colours. The .pptx carries
// PowerPoint's own chart of the same numbers, which stays editable there.
import { escapeHtml as esc } from "./kit.mjs";

const PX = 96;

/** The value as the chart labels it: its prefix and unit around a short number. */
const chartLabel = (c, v) =>
  `${c.prefix ?? ""}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v)}${v === 0 ? "" : (c.unit ?? "")}`;

export function chartSvg(s, t) {
  const c = s.chart;
  const w = s.w * PX;
  const h = s.h * PX;
  const kind = c.type ?? "bar";
  const colors = t.series;
  const series = c.series.map((one) => ({
    name: String(one.name ?? ""),
    values: one.values.map(Number),
  }));
  const fmt = (v) => chartLabel(c, v);
  const legend = series.length > 1 && kind !== "pie" && kind !== "doughnut";
  const font = `font-family="${esc(t.font)}, sans-serif"`;
  if (kind === "pie" || kind === "doughnut") {
    const values = series[0].values;
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const r = Math.min(h * 0.42, w * 0.25);
    const cx = r + 20;
    const cy = h / 2;
    let a0 = -Math.PI / 2;
    const arcs = values
      .map((v, i) => {
        const a1 = a0 + (v / total) * Math.PI * 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (a) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
        const d = `M${cx},${cy} L${p(a0)} A${r},${r} 0 ${large} 1 ${p(a1)} Z`;
        a0 = a1;
        return `<path d="${d}" fill="#${colors[i % colors.length]}" stroke="#fff" stroke-width="2"/>`;
      })
      .join("");
    const hole =
      kind === "doughnut"
        ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#${t.bg}"/>`
        : "";
    const keys = c.labels
      .map(
        (label, i) =>
          `<rect x="${cx + r + 40}" y="${cy - (c.labels.length * 30) / 2 + i * 30}" width="14" height="14" rx="3" fill="#${colors[i % colors.length]}"/><text x="${cx + r + 64}" y="${cy - (c.labels.length * 30) / 2 + i * 30 + 12}" font-size="16" fill="#${t.ink}" ${font}>${esc(label)} <tspan fill="#${t.soft}">${c.unit === "%" ? "" : `${fmt(values[i])} · `}${Math.round((values[i] / total) * 100)}%</tspan></text>`,
      )
      .join("");
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${arcs}${hole}${keys}</svg>`;
  }
  const horizontal = kind === "bar" && c.horizontal;
  const all = series.flatMap((one) => one.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const step = niceStep((max - min) / 5);
  const top = Math.ceil(max / step) * step || step;
  const bottom = Math.floor(min / step) * step;
  const padL = horizontal ? 150 : 64;
  const padB = legend ? 70 : 40;
  const padT = 14;
  const plotW = w - padL - 16;
  const plotH = h - padB - padT;
  const ticks = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v);
  const n = c.labels.length;
  const out = [];
  if (horizontal) {
    const sx = (v) => padL + ((v - bottom) / (top - bottom)) * plotW;
    for (const v of ticks)
      out.push(
        `<line x1="${sx(v)}" x2="${sx(v)}" y1="${padT}" y2="${padT + plotH}" stroke="#${t.rule}"/><text x="${sx(v)}" y="${padT + plotH + 22}" font-size="13" text-anchor="middle" fill="#${t.soft}" ${font}>${fmt(v)}</text>`,
      );
    const band = plotH / n;
    const bh = (band * 0.7) / series.length;
    c.labels.forEach((label, i) => {
      out.push(
        `<text x="${padL - 10}" y="${padT + band * i + band / 2 + 5}" font-size="14" text-anchor="end" fill="#${t.ink}" ${font}>${esc(label)}</text>`,
      );
      series.forEach((one, k) => {
        const y = padT + band * i + band * 0.15 + bh * k;
        out.push(
          `<rect x="${sx(Math.min(0, one.values[i]))}" y="${y}" width="${Math.abs(sx(one.values[i]) - sx(0))}" height="${bh - 2}" fill="#${colors[k % colors.length]}"/>`,
        );
        if (c.values !== false && series.length === 1)
          out.push(
            `<text x="${sx(one.values[i]) + 6}" y="${y + bh / 2 + 4}" font-size="13" fill="#${t.ink}" ${font}>${fmt(one.values[i])}</text>`,
          );
      });
    });
  } else {
    const sy = (v) => padT + plotH - ((v - bottom) / (top - bottom)) * plotH;
    for (const v of ticks)
      out.push(
        `<line x1="${padL}" x2="${padL + plotW}" y1="${sy(v)}" y2="${sy(v)}" stroke="#${t.rule}"/><text x="${padL - 10}" y="${sy(v) + 4}" font-size="13" text-anchor="end" fill="#${t.soft}" ${font}>${fmt(v)}</text>`,
      );
    const band = plotW / n;
    c.labels.forEach((label, i) => {
      out.push(
        `<text x="${padL + band * i + band / 2}" y="${padT + plotH + 22}" font-size="14" text-anchor="middle" fill="#${t.ink}" ${font}>${esc(label)}</text>`,
      );
    });
    if (kind === "line") {
      series.forEach((one, k) => {
        const pts = one.values.map(
          (v, i) => `${padL + band * i + band / 2},${sy(v)}`,
        );
        out.push(
          `<polyline points="${pts.join(" ")}" fill="none" stroke="#${colors[k % colors.length]}" stroke-width="3.5" stroke-linejoin="round"/>`,
        );
        one.values.forEach((v, i) =>
          out.push(
            `<circle cx="${padL + band * i + band / 2}" cy="${sy(v)}" r="4.5" fill="#${colors[k % colors.length]}"/>`,
          ),
        );
      });
    } else {
      const bw = (band * 0.66) / series.length;
      c.labels.forEach((_, i) => {
        series.forEach((one, k) => {
          const x = padL + band * i + band * 0.17 + bw * k;
          const v = one.values[i];
          out.push(
            `<rect x="${x}" y="${Math.min(sy(v), sy(0))}" width="${bw - 3}" height="${Math.abs(sy(v) - sy(0))}" fill="#${colors[k % colors.length]}"/>`,
          );
          if (c.values !== false && series.length === 1)
            out.push(
              `<text x="${x + (bw - 3) / 2}" y="${sy(v) - 8}" font-size="13" text-anchor="middle" fill="#${t.ink}" ${font}>${fmt(v)}</text>`,
            );
        });
      });
    }
  }
  if (legend)
    series.forEach((one, k) => {
      const x = padL + k * 180;
      out.push(
        `<rect x="${x}" y="${h - 24}" width="14" height="14" rx="3" fill="#${colors[k % colors.length]}"/><text x="${x + 22}" y="${h - 12}" font-size="14" fill="#${t.ink}" ${font}>${esc(one.name)}</text>`,
      );
    });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${out.join("")}</svg>`;
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}
