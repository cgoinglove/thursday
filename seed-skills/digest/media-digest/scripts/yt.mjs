#!/usr/bin/env node
// YouTube without a key: a video's transcript with timestamps and what it is, and search.
//
//   node yt.mjs transcript <url|id>... --out <dir> [--lang ko]
//       Per video, <dir>/<id>.txt (the transcript: `[m:ss] text` lines under `## Part N`
//       headers, each part one read) and <dir>/<id>.json (title, channel, date, length,
//       views, chapters, captions, thumbnail, parts). Prints a few lines each.
//       --lang prefers captions in that language; otherwise the spoken language.
//   node yt.mjs search "<query>" [--within hour|day|week|month|year]
//       [--length short|medium|long] [--sort relevance|views|date] [--max 20] [--out rows.json]
//       Video rows, most relevant first: id, length, views, age, channel, title.
//       Shorts, channels and playlists are left out. short < 4 min, long > 20 min.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  clock,
  compact,
  get,
  oneLine,
  parseArgs,
  post,
  readingLine,
  run,
  Stop,
  seconds,
  shown,
  usage,
  withParts,
  ytDlp,
} from "./lib.mjs";

const PLAYER = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
/**
 * The app clients answer caption urls that need no proof-of-origin token, which the web
 * client's now do; the same route youtube-transcript-api takes. A version YouTube stops
 * accepting answers without captions, and the next client is tried.
 */
const CLIENTS = [
  { clientName: "ANDROID", clientVersion: "20.10.38" },
  { clientName: "IOS", clientVersion: "20.10.4" },
];

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

/** `var name = {…};` out of a watch or results page, by matching its braces. */
function pageJson(html, name) {
  const at = html.indexOf(`var ${name} = {`);
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  let depth = 0;
  let quoted = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (c === "\\") i++;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Every object under `key` anywhere in `tree`. */
function* walk(tree, key) {
  if (Array.isArray(tree)) for (const one of tree) yield* walk(one, key);
  else if (tree && typeof tree === "object")
    for (const [k, v] of Object.entries(tree)) {
      if (k === key) yield v;
      yield* walk(v, key);
    }
}

const text = (node) =>
  node?.simpleText ?? node?.runs?.map((run) => run.text).join("") ?? "";

/** Chapters from the player bar, else the `0:00 Title` lines of the description. */
function chaptersOf(data, description) {
  const bar = [...walk(data, "chapterRenderer")].map((c) => ({
    at: Math.round(c.timeRangeStartMillis / 1000),
    title: text(c.title),
  }));
  if (bar.length) return dedupe(bar);
  const lines = [];
  for (const line of String(description ?? "").split("\n")) {
    const m = line.match(
      /^\s*[([]?((?:\d+:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|]?\s*(.+)$/,
    );
    if (!m) continue;
    lines.push({ at: seconds(m[1]), title: m[2].trim() });
  }
  return lines.length >= 2 && lines[0].at === 0 ? dedupe(lines) : [];
}

const dedupe = (list) =>
  list.filter((c, i) => i === 0 || c.at !== list[i - 1].at);

/** The caption track to read: the one asked for, else the spoken language's, a person's over the machine's. */
function pickTrack(tracks, lang) {
  const base = (code) => String(code).split("-")[0].toLowerCase();
  const spoken = tracks.find((t) => t.kind === "asr")?.languageCode;
  const human = (code) =>
    tracks.find((t) => t.kind !== "asr" && base(t.languageCode) === base(code));
  const machine = (code) =>
    tracks.find((t) => t.kind === "asr" && base(t.languageCode) === base(code));
  return (
    (lang && (human(lang) ?? machine(lang))) ??
    (spoken && (human(spoken) ?? machine(spoken))) ??
    tracks.find((t) => t.kind !== "asr") ??
    tracks[0]
  );
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

async function captionsViaYtDlp(id, lang, dir) {
  const bin = await ytDlp();
  const { spawnSync } = await import("node:child_process");
  const { readdirSync, readFileSync, rmSync } = await import("node:fs");
  const tmp = join(dir, `.${id}-subs`);
  const done = spawnSync(
    bin,
    [
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-format",
      "json3",
      "--sub-langs",
      lang ? `${lang}.*,${lang}` : ".*-orig,en.*",
      "-o",
      join(tmp, "%(id)s.%(ext)s"),
      `https://www.youtube.com/watch?v=${id}`,
    ],
    { encoding: "utf8" },
  );
  const file = readdirSync(tmp, { withFileTypes: true }).find((f) =>
    f.name.endsWith(".json3"),
  );
  if (!file) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Stop(
      `yt-dlp found no captions either:\n${oneLine(done.stderr, 400)}`,
    );
  }
  const json = JSON.parse(readFileSync(join(tmp, file.name), "utf8"));
  rmSync(tmp, { recursive: true, force: true });
  const code = file.name
    .split(".")
    .at(-2)
    .replace(/-orig$/, "");
  return { json, track: { languageCode: code, kind: "yt-dlp" } };
}

async function transcript(id, { dir, lang }) {
  const [html, ...answers] = await Promise.all([
    get(`https://www.youtube.com/watch?v=${id}&hl=en`).catch(() => ""),
    ...CLIENTS.map((client) =>
      post(PLAYER, {
        context: { client: { ...client, hl: "en" } },
        videoId: id,
      }).catch(() => null),
    ),
  ]);
  const page = pageJson(html, "ytInitialPlayerResponse") ?? {};
  const data = pageJson(html, "ytInitialData") ?? {};
  const player = answers.find((a) => a?.videoDetails) ?? {};
  const details = page.videoDetails ?? player.videoDetails;
  const status = page.playabilityStatus ?? player.playabilityStatus ?? {};
  if (!details)
    throw new Stop(
      `${id}: ${status.reason ?? "YouTube did not answer with this video"} (${status.status ?? "no status"}).`,
    );
  const micro = page.microformat?.playerMicroformatRenderer ?? {};
  const length = Number(details.lengthSeconds ?? 0);
  const long = length >= 3600;
  const chapters = chaptersOf(data, details.shortDescription);

  const listed =
    page.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  let caption = null;
  for (const answer of answers) {
    const tracks =
      answer?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    if (!tracks.length) continue;
    const track = pickTrack(tracks, lang);
    const url = `${track.baseUrl.replace(/&fmt=[^&]*/, "")}&fmt=json3`;
    const json = await get(url, { json: true }).catch(() => null);
    if (json?.events?.length) {
      caption = { json, track, tracks };
      break;
    }
  }
  // Captions the page lists but the app clients could not fetch: yt-dlp keeps up with YouTube
  if (!caption && (listed.length || answers.every((a) => !a)))
    caption = await captionsViaYtDlp(id, lang, dir).catch((error) =>
      listed.length ? Promise.reject(error) : null,
    );

  const meta = {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title: details.title,
    channel: details.author,
    channelUrl: micro.ownerProfileUrl ?? null,
    date: (micro.publishDate ?? micro.uploadDate ?? "").slice(0, 10) || null,
    seconds: length,
    length: clock(length, long),
    views: Number(details.viewCount ?? 0),
    live: Boolean(details.isLiveContent),
    category: micro.category ?? null,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    description: String(details.shortDescription ?? "").slice(0, 2000),
    chapters: chapters.map((c) => ({ ...c, time: clock(c.at, long) })),
    captions: null,
    transcript: null,
    parts: [],
  };

  const head = [
    `${meta.title} — ${meta.channel}, ${meta.date ?? "date unknown"}, ${meta.length}, ${compact(meta.views)} views`,
  ];
  const metaFile = join(dir, `${id}.json`);
  if (!caption) {
    writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
    head.push(
      `No captions on this video. Meta: ${shown(metaFile)}. For its words, transcribe the audio (references/no-captions.md).`,
    );
    return head.join("\n");
  }

  const { lines, breaks } = linesOf(cuesOf(caption.json), chapters, long);
  const parts = withParts(lines, breaks);
  const file = join(dir, `${id}.txt`);
  const kind = (t) =>
    t.kind === "asr"
      ? "auto"
      : t.kind === "yt-dlp"
        ? "via yt-dlp"
        : "by a person";
  meta.captions = {
    lang: caption.track.languageCode,
    kind: kind(caption.track),
    others: (caption.tracks ?? [])
      .filter((t) => t !== caption.track)
      .map((t) => `${t.languageCode}${t.kind === "asr" ? " (auto)" : ""}`),
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

/** YouTube's search filter, `sp`: a small protobuf of sort order and filters, base64. */
function filterParam({ within, length, sort }) {
  const WITHIN = { hour: 1, day: 2, week: 3, month: 4, year: 5 };
  const LENGTH = { short: 1, long: 2, medium: 3 };
  const SORT = { relevance: 0, date: 2, views: 3 };
  for (const [name, value, table] of [
    ["within", within, WITHIN],
    ["length", length, LENGTH],
    ["sort", sort, SORT],
  ])
    if (value && !(value in table))
      throw new Stop(`--${name} is one of ${Object.keys(table).join(", ")}.`);
  const filters = [0x10, 1]; // type: video
  if (within) filters.push(0x08, WITHIN[within]);
  if (length) filters.push(0x18, LENGTH[length]);
  const bytes = [
    ...(sort && SORT[sort] ? [0x08, SORT[sort]] : []),
    0x12,
    filters.length,
    ...filters,
  ];
  return encodeURIComponent(Buffer.from(bytes).toString("base64"));
}

/** "3 weeks ago" or "3w ago" → days, roughly; what views a day is worked out from. */
function ageDays(age) {
  const m = String(age).match(
    /(\d+)\s*(second|minute|min|hour|day|week|month|mo|year|s|m|h|d|w|y)/,
  );
  if (!m) return null;
  const DAYS = {
    s: 1 / 86400,
    m: 1 / 1440,
    h: 1 / 24,
    d: 1,
    w: 7,
    mo: 30,
    y: 365,
  };
  const unit =
    {
      second: "s",
      minute: "m",
      min: "m",
      hour: "h",
      day: "d",
      week: "w",
      month: "mo",
      year: "y",
    }[m[2]] ?? m[2];
  return Math.max(Number(m[1]) * DAYS[unit], 1);
}

async function search(query, flags) {
  if (!query) throw new Stop(usage(import.meta.url));
  const max = Number(flags.max ?? 20);
  const html = await get(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${filterParam(flags)}&hl=en`,
  );
  const data = pageJson(html, "ytInitialData");
  if (!data)
    throw new Stop(
      "YouTube's results page changed shape: no ytInitialData in it. Search in the browser instead.",
    );
  const seen = new Set();
  const rows = [];
  const add = (found) => {
    for (const v of found) {
      if (seen.has(v.videoId) || !v.lengthText) continue;
      seen.add(v.videoId);
      const views = Number(text(v.viewCountText).replace(/[^\d]/g, "")) || 0;
      const age = text(v.publishedTimeText);
      const days = ageDays(age);
      rows.push({
        id: v.videoId,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        title: text(v.title),
        channel: text(v.ownerText),
        length: text(v.lengthText),
        views,
        age,
        perDay: days ? Math.round(views / days) : null,
        thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        snippet: oneLine(
          (v.detailedMetadataSnippets ?? [])
            .map((s) => text(s.snippetText))
            .join(" "),
          160,
        ),
      });
    }
  };
  add(walk(data, "videoRenderer"));
  // A second page when the first falls short; the results page holds about twenty
  const token = [...walk(data, "continuationCommand")][0]?.token;
  const version = html.match(
    /"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/,
  )?.[1];
  if (rows.length < max && token && version) {
    const more = await post(
      "https://www.youtube.com/youtubei/v1/search?prettyPrint=false",
      {
        context: {
          client: { clientName: "WEB", clientVersion: version, hl: "en" },
        },
        continuation: token,
      },
    ).catch(() => null);
    if (more) add(walk(more, "videoRenderer"));
  }
  const kept = rows.slice(0, max);
  if (!kept.length) return `No videos for "${query}" with these filters.`;
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
  const said = [];
  for (const input of rest) {
    try {
      said.push(await transcript(videoId(input), { dir, lang }));
    } catch (error) {
      if (!(error instanceof Stop) || rest.length === 1) throw error;
      said.push(error.message);
    }
  }
  console.log(said.join("\n\n"));
});
