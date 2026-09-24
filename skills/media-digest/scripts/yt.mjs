#!/usr/bin/env node
// YouTube through yt-dlp: a video's transcript with timestamps and what it is, and search.
//
//   node yt.mjs transcript <url|id>... --out <dir> [--lang de]
//       Per video, <dir>/<id>.txt (the transcript: `[m:ss] text` lines under `## Part N`
//       headers, each part one read) and <dir>/<id>.json (title, channel, date, length,
//       views, chapters, captions, thumbnail, parts). Prints a few lines each.
//       --lang prefers captions in that language; otherwise the language spoken.
//   node yt.mjs search "<query>" [--within hour|day|week|month|year]
//       [--length short|medium|long] [--sort relevance|views|date] [--max 20] [--out rows.json]
//       Video rows, most relevant first: id, length, views, age, channel, title. YouTube is
//       searched by relevance alone; --within, --length and --sort work on the rows that
//       search finds, so a narrowed one reads four times --max and keeps the ones that
//       pass — the newest or most viewed of those, not of all YouTube. Shorts, channels and
//       playlists are left out. short < 4 min, long > 20 min.
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  clock,
  compact,
  oneLine,
  parseArgs,
  readingLine,
  run,
  Stop,
  shown,
  usage,
  withParts,
  ytDlp,
} from "./lib.mjs";

const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

/** yt-dlp, with the machine's own config left out so nothing set there rewrites the output. */
function ytRun(bin, args) {
  const done = spawnSync(bin, ["--ignore-config", ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (done.error) throw new Stop(`yt-dlp could not run: ${done.error.message}`);
  return done;
}

/** The last lines yt-dlp said, which is where its reason is. */
const tail = (said, n = 4) =>
  String(said ?? "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-n)
    .join("\n") || "yt-dlp said nothing about why.";

/** A video id out of any YouTube address, or the id itself. */
function videoId(input) {
  const text = String(input).trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  const m = text.match(
    /(?:v=|\/shorts\/|\/live\/|\/embed\/|youtu\.be\/|\/v\/)([\w-]{11})/,
  );
  if (!m) throw new Stop(`Not a YouTube video: ${text}`);
  return m[1];
}

/** Everything yt-dlp knows about one video. */
function details(bin, id) {
  const done = ytRun(bin, ["--no-playlist", "--dump-json", watchUrl(id)]);
  const out = done.stdout.trim().split("\n")[0];
  if (done.status !== 0 || !out)
    throw new Stop(
      `${id}: yt-dlp could not read this video.\n${tail(done.stderr)}`,
    );
  try {
    return JSON.parse(out);
  } catch {
    throw new Stop(
      `${id}: yt-dlp answered with something other than JSON.\n${oneLine(out, 300)}`,
    );
  }
}

const base = (code) => String(code).split("-")[0].toLowerCase();

/**
 * The caption tracks worth naming: every written one, and the automatic track in the
 * language actually spoken, which yt-dlp keys `<code>-orig`. Every other automatic key is
 * a machine translation of that one.
 */
function tracksOf(info) {
  return [
    ...Object.keys(info.subtitles ?? {}).map((code) => ({ code, auto: false })),
    ...Object.keys(info.automatic_captions ?? {})
      .filter((code) => code.endsWith("-orig"))
      .map((code) => ({ code, auto: true })),
  ];
}

/** The track to read: the one asked for, else the language spoken, a person's over the machine's. */
function pickTrack(info, lang) {
  const human = Object.keys(info.subtitles ?? {});
  const auto = Object.keys(info.automatic_captions ?? {});
  const orig = auto.find((code) => code.endsWith("-orig"));
  const inLanguage = (code) => {
    const person = human.find((one) => base(one) === base(code));
    if (person) return { code: person, auto: false };
    const machine =
      auto.find((one) => one === `${base(code)}-orig`) ??
      auto.find((one) => base(one) === base(code));
    return machine ? { code: machine, auto: true } : null;
  };
  return (
    (lang && inLanguage(lang)) ??
    (orig && inLanguage(orig)) ??
    (human.length ? { code: human[0], auto: false } : null) ??
    (auto.length ? { code: auto[0], auto: true } : null)
  );
}

/** The chosen track as json3, which is the only caption format carrying a time per line. */
function captionJson(bin, id, track, dir) {
  const tmp = join(dir, `.${id}-subs`);
  mkdirSync(tmp, { recursive: true });
  try {
    const done = ytRun(bin, [
      "--no-playlist",
      "--skip-download",
      track.auto ? "--write-auto-subs" : "--write-subs",
      "--sub-format",
      "json3",
      "--sub-langs",
      track.code,
      "-o",
      join(tmp, "%(id)s.%(ext)s"),
      watchUrl(id),
    ]);
    const written = readdirSync(tmp).filter((name) => name.endsWith(".json3"));
    const name =
      written.find((one) => one === `${id}.${track.code}.json3`) ?? written[0];
    if (!name)
      throw new Stop(
        `${id}: yt-dlp lists ${track.code} captions but wrote none.\n${tail(done.stderr)}`,
      );
    return JSON.parse(readFileSync(join(tmp, name), "utf8"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** json3 caption events → cues of `{ start, text }` in seconds. */
function cuesOf(json) {
  const cues = [];
  for (const event of json.events ?? []) {
    if (!event.segs) continue;
    const said = event.segs
      .map((seg) => seg.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!said) continue;
    cues.push({ start: event.tStartMs / 1000, text: said });
  }
  return cues;
}

/**
 * Cues into lines of about half a minute, ending on a sentence when the captions have
 * any, and always at a chapter. `[Music]` and the like are dropped.
 */
function linesOf(cues, chapters, long) {
  const starts = chapters.map((c) => c.at).filter((at) => at > 0);
  const lines = [];
  const breaks = new Set();
  let line = null;
  let next = 0;
  for (const cue of cues) {
    const said = cue.text.replace(/\[[^\]]{1,20}\]/g, "").trim();
    if (!said) continue;
    let chapter = false;
    while (next < starts.length && cue.start >= starts[next]) {
      chapter = true;
      next++;
    }
    const age = line ? cue.start - line.start : 0;
    const sentence = line && /[.?!。？！]["')\]]?$/.test(line.words.at(-1));
    if (!line || chapter || age >= 45 || (age >= 20 && sentence)) {
      if (chapter) breaks.add(lines.length + (line ? 1 : 0));
      if (line) lines.push(line);
      line = { start: cue.start, words: [] };
    }
    line.words.push(said);
  }
  if (line) lines.push(line);
  return {
    lines: lines.map((l) => ({
      label: clock(l.start, long),
      text: `[${clock(l.start, long)}] ${l.words.join(" ")}`,
    })),
    breaks,
  };
}

function transcript(bin, id, { dir, lang }) {
  const info = details(bin, id);
  const length = Number(info.duration ?? 0);
  const long = length >= 3600;
  const date = String(info.upload_date ?? "");
  const track = pickTrack(info, lang);

  const meta = {
    id,
    url: info.webpage_url ?? watchUrl(id),
    title: info.title,
    channel: info.channel ?? info.uploader ?? null,
    channelUrl: info.channel_url ?? info.uploader_url ?? null,
    date: /^\d{8}$/.test(date)
      ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
      : null,
    seconds: length,
    length: clock(length, long),
    views: Number(info.view_count ?? 0),
    live: Boolean(info.is_live || info.was_live),
    category: info.categories?.[0] ?? null,
    thumbnail: info.thumbnail ?? null,
    description: String(info.description ?? "").slice(0, 2000),
    chapters: (info.chapters ?? [])
      .filter((c) => c?.title)
      .map((c) => ({
        at: Math.round(c.start_time ?? 0),
        title: String(c.title),
        time: clock(Math.round(c.start_time ?? 0), long),
      })),
    captions: null,
    transcript: null,
    parts: [],
  };

  const head = [
    `${meta.title} — ${meta.channel}, ${meta.date ?? "date unknown"}, ${meta.length}, ${compact(meta.views)} views`,
  ];
  const metaFile = join(dir, `${id}.json`);
  if (!track) {
    writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    head.push(
      `No captions on this video. Meta: ${shown(metaFile)}. For its words, transcribe the audio (references/no-captions.md).`,
    );
    return head.join("\n");
  }

  const { lines, breaks } = linesOf(
    cuesOf(captionJson(bin, id, track, dir)),
    meta.chapters,
    long,
  );
  const parts = withParts(lines, breaks);
  const file = join(dir, `${id}.txt`);
  meta.captions = {
    lang: track.code,
    kind: track.auto ? "auto" : "by a person",
    others: tracksOf(info)
      .filter((one) => one.code !== track.code)
      .map((one) => `${one.code}${one.auto ? " (auto)" : ""}`),
  };
  meta.transcript = shown(file);
  meta.parts = parts.index;
  writeFileSync(
    file,
    `# ${meta.title}\n# ${meta.channel} · ${meta.url}\n\n${parts.text}`,
  );
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);

  head.push(
    `Captions: ${meta.captions.lang}, ${meta.captions.kind}${meta.captions.others.length ? ` (also ${oneLine(meta.captions.others.join(", "), 120)})` : ""}`,
    `Transcript: ${readingLine(file, parts.index)}`,
    `Meta: ${shown(metaFile)}`,
  );
  if (meta.chapters.length)
    head.push(
      `Chapters (${meta.chapters.length}): ${oneLine(meta.chapters.map((c) => `${c.time} ${c.title}`).join(" | "), 900)}`,
    );
  else if (meta.description)
    head.push(`Description: ${oneLine(meta.description, 300)}`);
  return head.join("\n");
}

// What a search can be narrowed by. yt-dlp's search is YouTube's by relevance; the rest is
// read off the rows it returns, so a narrowed search asks for more rows than it keeps
const WITHIN_DAYS = { hour: 1 / 24, day: 1, week: 7, month: 31, year: 366 };
const LENGTHS = {
  short: [0, 240],
  medium: [240, 1200],
  long: [1200, Infinity],
};
const SORTS = ["relevance", "date", "views"];
const WIDER = 4;

/** Each flag checked against what it can be, before anything is fetched. */
function checkFilters({ within, length, sort }) {
  for (const [name, value, allowed] of [
    ["within", within, Object.keys(WITHIN_DAYS)],
    ["length", length, Object.keys(LENGTHS)],
    ["sort", sort, SORTS],
  ])
    if (value && !allowed.includes(value))
      throw new Stop(`--${name} is one of ${allowed.join(", ")}.`);
}

/** The largest picture yt-dlp lists for a row, or its one thumbnail. */
const biggest = (e) =>
  [...(e.thumbnails ?? [])]
    .filter((t) => t?.url)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ??
  e.thumbnail ??
  null;

/** Days since a row was posted → "2 weeks ago", the way the results page says it. */
function ago(days) {
  for (const [size, name] of [
    [365, "year"],
    [30, "month"],
    [7, "week"],
    [1, "day"],
  ]) {
    const n = Math.floor(days / size);
    if (n >= 1) return `${n} ${name}${n > 1 ? "s" : ""} ago`;
  }
  return "today";
}

async function search(query, flags) {
  if (!query) throw new Stop(usage(import.meta.url));
  const max = Number(flags.max ?? 20);
  if (!Number.isInteger(max) || max < 1)
    throw new Stop("--max is how many rows to keep, a whole number.");
  checkFilters(flags);
  const narrowed = Boolean(
    flags.within || flags.length || (flags.sort && flags.sort !== "relevance"),
  );
  const ask = narrowed ? Math.min(max * WIDER, 100) : max;
  const bin = await ytDlp();
  const done = ytRun(bin, [
    "--flat-playlist",
    "--dump-single-json",
    // A search row carries "2 weeks ago", not a date; this turns it into one, which is what views a day needs
    "--extractor-args",
    "youtubetab:approximate_date",
    `ytsearch${ask}:${query}`,
  ]);
  if (done.status !== 0 || !done.stdout.trim())
    throw new Stop(`yt-dlp could not search YouTube:\n${tail(done.stderr)}`);
  let data;
  try {
    data = JSON.parse(done.stdout);
  } catch {
    throw new Stop(
      `yt-dlp answered the search with something other than JSON:\n${oneLine(done.stdout, 300)}`,
    );
  }
  const now = Date.now() / 1000;
  const [shortest, longest] = LENGTHS[flags.length] ?? [0, Infinity];
  const since = flags.within ? now - WITHIN_DAYS[flags.within] * 86400 : null;
  const rows = (data.entries ?? []).filter(
    (e) =>
      e?.id &&
      e.duration != null &&
      !String(e.url ?? "").includes("/shorts/") &&
      e.duration >= shortest &&
      e.duration < longest &&
      (since == null ||
        (typeof e.timestamp === "number" && e.timestamp >= since)),
  );
  if (flags.sort === "views")
    rows.sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0));
  if (flags.sort === "date")
    rows.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const kept = rows.slice(0, max).map((e) => {
    const at = typeof e.timestamp === "number" ? e.timestamp : null;
    const days = at ? Math.max((now - at) / 86400, 1) : null;
    const views = Number(e.view_count ?? 0);
    return {
      id: e.id,
      url: `https://www.youtube.com/watch?v=${e.id}`,
      title: e.title ?? "",
      channel: e.channel ?? e.uploader ?? "",
      length: clock(Number(e.duration)),
      views,
      date: at ? new Date(at * 1000).toISOString().slice(0, 10) : null,
      age: days ? ago(days) : "date unknown",
      perDay: days ? Math.round(views / days) : null,
      thumbnail: biggest(e),
      snippet: oneLine(e.description ?? "", 160),
    };
  });
  if (!kept.length)
    throw new Stop(
      `No video rows for "${query}"${flags.within ? `, past ${flags.within}` : ""}${flags.length ? `, ${flags.length}` : ""} among the ${ask} results yt-dlp read: nothing matches, or fewer filters would, or words that name what is new would.`,
    );
  if (flags.out) {
    const out = resolve(flags.out);
    mkdirSync(resolve(out, ".."), { recursive: true });
    writeFileSync(out, `${JSON.stringify(kept, null, 2)}\n`);
  }
  return [
    `${kept.length} videos for "${query}"${flags.within ? `, past ${flags.within}` : ""} (id | length | views | ~views a day | age | channel | title):`,
    ...kept.map(
      (r, i) =>
        `${i + 1}. ${r.id} | ${r.length} | ${compact(r.views)} | ${r.perDay == null ? "?" : compact(r.perDay)}/d | ${r.age} | ${oneLine(r.channel, 30)} | ${oneLine(r.title, 90)}`,
    ),
    ...(flags.out
      ? [`Rows with thumbnails and snippets: ${shown(resolve(flags.out))}`]
      : []),
  ].join("\n");
}

await run(async () => {
  const { positional, flags } = parseArgs();
  const [command, ...rest] = positional;
  if (command === "search") {
    console.log(await search(rest.join(" "), flags));
    return;
  }
  if (command !== "transcript" || !rest.length || !flags.out)
    throw new Stop(usage(import.meta.url));
  const dir = resolve(flags.out);
  mkdirSync(dir, { recursive: true });
  const lang = typeof flags.lang === "string" ? flags.lang : null;
  const bin = await ytDlp();
  const said = [];
  for (const input of rest) {
    try {
      said.push(transcript(bin, videoId(input), { dir, lang }));
    } catch (error) {
      if (!(error instanceof Stop) || rest.length === 1) throw error;
      said.push(error.message);
    }
  }
  console.log(said.join("\n\n"));
});
