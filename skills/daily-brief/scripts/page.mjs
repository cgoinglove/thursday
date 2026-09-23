#!/usr/bin/env node
/**
 * The brief as one page: what the model wrote (brief.json) laid over what the scripts
 * fetched (stories.json, glance.json), written to `brief-<date>.html` in the bot's artifacts
 * folder. Pictures and audio are inlined, so the one file opens anywhere — on this screen,
 * or on a phone it was sent to. The layout is never typed by hand.
 *
 *   node page.mjs <brief.json> [--look <dir>]
 *
 * With --look it also renders the page at phone width through the artifact skill's camera,
 * for one look at the photos.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  artifactsDir,
  host,
  parseArgs,
  run,
  Stop,
  shown,
  workspace,
} from "./lib.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Past this, a summary is a paragraph, not two lines
const SUMMARY_MAX = 280;

const LABELS = {
  title: "Morning Brief",
  why: "Why it matters",
  listen: "The 60-second version",
  read: "Read",
  photo: "Photo",
  made: "Made {time} from {count} publishers. Photos belong to the publishers credited on them.",
};

const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};
const inline = (file) =>
  `data:${TYPES[extname(file).toLowerCase()] ?? "application/octet-stream"};base64,${readFileSync(file).toString("base64")}`;

const SKY = {
  clear:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  partly:
    '<path d="M12 2v2M4.9 4.9l1.4 1.4M20 12h2M19.1 4.9l-1.4 1.4M15.9 12.7a4 4 0 0 0-5.9-4.1"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/>',
  cloudy: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9Z"/>',
  fog: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 17H7M17 21H9"/>',
  rain: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 14v6M8 14v6M12 16v6"/>',
  snow: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M8 15h.01M8 19h.01M12 17h.01M12 21h.01M16 15h.01M16 19h.01"/>',
  storm:
    '<path d="M6 16.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 .5 9"/><path d="m13 12-3 5h4l-3 5"/>',
};
const skyIcon = (sky) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SKY[sky] ?? SKY.cloudy}</svg>`;

run(async () => {
  const opts = parseArgs();
  const briefFile = opts._[0] && resolve(opts._[0]);
  if (!briefFile)
    throw new Stop("usage: node page.mjs <brief.json> [--look <dir>]");
  if (!existsSync(briefFile)) throw new Stop(`No such file: ${briefFile}`);
  let brief;
  try {
    brief = JSON.parse(readFileSync(briefFile, "utf8"));
  } catch (error) {
    throw new Stop(`${briefFile} is not JSON: ${error.message}`);
  }
  // A path in brief.json is relative to it, or to the workspace: what a tool hands back
  // (`generate_speech` answers `artifacts/<bot>/….mp3`) is written down as it came
  const from = (p) => {
    if (!p) return null;
    const beside = resolve(dirname(briefFile), p);
    if (existsSync(beside)) return beside;
    const inWorkspace = resolve(workspace(), p);
    return existsSync(inWorkspace) ? inWorkspace : beside;
  };
  const storiesFile = from(brief.stories);
  if (!storiesFile || !existsSync(storiesFile))
    throw new Stop(
      `"stories" must name the stories.json story.mjs wrote (got ${brief.stories ?? "nothing"}).`,
    );
  const stories = JSON.parse(readFileSync(storiesFile, "utf8"));
  const glanceFile = from(brief.glance);
  const glance =
    glanceFile && existsSync(glanceFile)
      ? JSON.parse(readFileSync(glanceFile, "utf8"))
      : null;
  if (brief.glance && !glance)
    throw new Stop(`No glance file at ${glanceFile}.`);
  const audioFile = from(brief.audio);
  if (brief.audio && !existsSync(audioFile))
    throw new Stop(`No audio file at ${audioFile}.`);

  const lang = brief.lang ?? "en";
  const L = { ...LABELS, ...brief.labels };
  const day = brief.date ? new Date(`${brief.date}T12:00:00`) : new Date();
  const date =
    brief.date ??
    new Date(day.getTime() - day.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);

  // Every story the model wrote about must be one the scripts fetched
  const wrote = [brief.lead, ...(brief.items ?? [])].filter(Boolean);
  const problems = [];
  if (!brief.lead)
    problems.push('"lead" is missing: the one story that opens the page.');
  const joined = wrote.map((w, i) => {
    const s = stories.find((x) => x.id === w.id);
    const at = i === 0 ? "lead" : `items[${i - 1}]`;
    if (!s)
      problems.push(`${at}: no story "${w.id}" in ${shown(storiesFile)}.`);
    if (!w.headline?.trim()) problems.push(`${at}: "headline" is empty.`);
    if (!w.summary?.trim()) problems.push(`${at}: "summary" is empty.`);
    else if (w.summary.length > SUMMARY_MAX)
      problems.push(
        `${at}: the summary runs ${w.summary.length} characters; two lines are under ${SUMMARY_MAX}.`,
      );
    return { ...s, ...w };
  });
  if (problems.length)
    throw new Stop(
      `Nothing written. Fix brief.json:\n- ${problems.join("\n- ")}`,
    );

  const rel = new Intl.RelativeTimeFormat(lang, {
    numeric: "auto",
    style: "short",
  });
  const when = (iso) => {
    const h = (Date.now() - Date.parse(iso)) / 3_600_000;
    if (!Number.isFinite(h)) return "";
    return h < 1
      ? rel.format(-Math.max(1, Math.round(h * 60)), "minute")
      : rel.format(-Math.round(h), "hour");
  };

  const picture = (s) => {
    if (!s.image?.file || !existsSync(s.image.file))
      return `<div class="pic"><div class="none">${esc(s.site ?? host(s.url))}</div></div>`;
    return `<div class="pic"><img src="${inline(s.image.file)}" alt="${esc(s.headline)}"><span class="credit">${esc(L.photo)}: ${esc(s.image.site ?? s.site)}</span></div>`;
  };
  const source = (s) =>
    `<p class="src"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.site ?? host(s.url))}</a>${s.published ? ` · ${esc(when(s.published))}` : ""}${s.outlets > 1 ? ` · +${s.outlets - 1}` : ""}</p>`;
  const why = (s) =>
    s.why?.trim()
      ? `<p class="why"><b>${esc(L.why)}.</b> ${esc(s.why)}</p>`
      : "";
  const link = (s, text) =>
    `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(text)}</a>`;

  const [lead, ...items] = joined;
  const leadHtml = `<article class="story lead">
${picture(lead)}
<div>
<p class="kicker">${esc(lead.kicker ?? lead.topic ?? "")}</p>
<h2>${link(lead, lead.headline)}</h2>
<p class="sum">${esc(lead.summary)}</p>
${why(lead)}
${source(lead)}
</div>
</article>`;

  // Stories keep the model's order; a topic's section opens where its first story stands
  const topics = [];
  for (const s of items) {
    const name = s.section ?? s.topic ?? "";
    let t = topics.find((x) => x.name === name);
    if (!t) topics.push((t = { name, items: [] }));
    t.items.push(s);
  }
  const topicHtml = topics
    .map(
      (t) => `<section class="topic">
${t.name ? `<h2>${esc(t.name)}</h2>` : ""}
<div class="list">
${t.items
  .map(
    (s) => `<article class="story item">
${picture(s)}
<div class="head"><h3>${link(s, s.headline)}</h3></div>
<div class="body">
<p class="sum">${esc(s.summary)}</p>
${why(s)}
${source(s)}
</div>
</article>`,
  )
  .join("\n")}
</div>
</section>`,
    )
    .join("\n");

  const num = (v, digits) =>
    new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(v);
  const chips = [];
  if (glance?.weather) {
    const w = glance.weather;
    chips.push(
      `<div class="chip sky">${skyIcon(w.sky)}<div><div class="k">${esc(w.place)}</div><div class="v">${w.now}${esc(w.unit)}</div><div class="k">${w.low}° / ${w.high}°${w.rain != null ? ` · ☂ ${w.rain}%` : ""}</div></div></div>`,
    );
  }
  for (const m of glance?.markets ?? []) {
    const dir = m.pct > 0.005 ? "up" : m.pct < -0.005 ? "down" : "";
    const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "–";
    chips.push(
      `<div class="chip"><div class="k">${esc(m.label)}</div><div class="v">${num(m.price, Math.abs(m.price) >= 1000 ? 0 : 2)}</div><div class="d ${dir}">${arrow} ${num(Math.abs(m.pct), 2)}%</div></div>`,
    );
  }

  const spoken = brief.spoken?.trim();
  const listen =
    spoken || audioFile
      ? `<div class="listen">${audioFile ? `<audio controls preload="none" src="${inline(audioFile)}"></audio>` : ""}${spoken ? `<details><summary>${esc(L.listen)}</summary><p>${esc(spoken)}</p></details>` : ""}</div>`
      : "";

  const publishers = new Set(joined.map((s) => s.site ?? host(s.url)));
  const madeAt = new Intl.DateTimeFormat(lang, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
  const heading = brief.title ?? L.title;
  const dayLine = new Intl.DateTimeFormat(lang, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(day);
  // Read back by news.mjs: what this brief told, so the next one does not tell it again
  const told = joined.map((s) => ({
    title: s.title,
    headline: s.headline,
    url: s.url,
  }));

  const html = `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)} · ${esc(dayLine)}</title>
<style>
${readFileSync(join(SKILL, "page", "brief.css"), "utf8").trim()}
</style>
</head>
<body>
<header class="mast">
<p class="day">${esc(dayLine)}</p>
<h1>${esc(heading)}</h1>
${brief.lede?.trim() ? `<p class="lede">${esc(brief.lede)}</p>` : ""}
</header>
${chips.length ? `<div class="glance">${chips.join("")}</div>` : ""}
${listen}
${leadHtml}
${topicHtml}
<footer class="foot">
<p>${esc(L.made.replace("{time}", madeAt).replace("{count}", String(publishers.size)))}</p>
</footer>
<script type="application/json" id="brief-data">${JSON.stringify({ date, told }).replace(/</g, "\\u003c")}</script>
</body>
</html>
`;

  const out = join(artifactsDir(), `brief-${date}.html`);
  mkdirSync(dirname(out), { recursive: true });
  const replaced = existsSync(out);
  writeFileSync(out, html);
  const noPicture = joined.filter((s) => !s.image?.file).map((s) => s.id);
  console.log(
    `${shown(out)}${replaced ? " (replaced)" : ""}: ${joined.length} stories, ${joined.length - noPicture.length} pictures${noPicture.length ? ` (none for ${noPicture.join(", ")})` : ""}${chips.length ? `, ${chips.length} at a glance` : ""}${audioFile ? ", audio" : ""}, ${Math.round(statSync(out).size / 1024)} KB.`,
  );
  if (items.length < 3 || items.length > 7)
    console.log(
      `Note: ${items.length} stories under the lead; a brief reads best with 3 to 7.`,
    );
  if (opts.look) look(out, resolve(String(opts.look)));
});

/**
 * The page at phone width as one PNG, through the artifact skill's camera, in a headless
 * browser of its own: never the job's, which may be a window on the user's screen.
 */
function look(page, dir) {
  const render = join(
    process.env.THURSDAY_SKILLS ?? "",
    "artifact",
    "runtime",
    "render.mjs",
  );
  if (!existsSync(render))
    throw new Stop(
      `No render script at ${render}: the artifact skill ships it under $THURSDAY_SKILLS.`,
    );
  const got = spawnSync(
    "node",
    [
      render,
      page,
      "--size",
      "430x2400",
      "--out",
      dir,
      "--name",
      "look",
      "--apart",
    ],
    { encoding: "utf8" },
  );
  if (got.status !== 0)
    throw new Stop(
      `The page is written, but rendering it failed:\n${got.stderr.trim()}`,
    );
  console.log(
    `Look at ${join(dir, "look-01.png")} once with look_at: the top of the page at phone width.`,
  );
}
