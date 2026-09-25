#!/usr/bin/env node
// Audio with no transcript — a video without captions, a podcast episode, a recording —
// cut into pieces a transcription model takes, and the pieces' transcripts put back
// together with timestamps.
//
//   node audio.mjs cut <url|file> --out <dir> [--minutes 10]
//       Downloads the audio (any page yt-dlp knows, or a direct media url) or takes a
//       file, and writes <dir>/<name>-000.mp3, -001.mp3… (mono, small) and
//       <dir>/<name>.pieces.json. --minutes is how long a piece may be.
//   node audio.mjs join <dir>/<name>.pieces.json <transcript.md>...
//       The transcribe tool's files, one per piece and in the same order, into
//       <dir>/<name>.txt: `[m:ss] text` lines under `## Part N` headers, like yt.mjs writes.
//       Times inside a piece are estimated from where the words fall in it, and marked `~`.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  clock,
  download,
  ffmpeg,
  here,
  parseArgs,
  readingLine,
  run,
  Stop,
  shown,
  usage,
  withParts,
  ytDlp,
} from "./lib.mjs";

const MEDIA = /\.(mp3|m4a|aac|wav|ogg|opus|webm|mp4|mov|flac)(\?|$)/i;

/** Seconds of audio, from what ffmpeg says about it. */
function duration(bin, file) {
  const probe = spawnSync(bin, ["-hide_banner", "-i", file], {
    encoding: "utf8",
  });
  const hms = probe.stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!hms) throw new Stop(`${file} is not audio ffmpeg can read.`);
  return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
}

async function fetchAudio(input, dir) {
  if (existsSync(input)) return resolve(input);
  if (!/^https?:\/\//.test(input))
    throw new Stop(`No such file or url: ${input}`);
  if (MEDIA.test(new URL(input).pathname)) {
    const file = join(dir, basename(new URL(input).pathname));
    await download(input, file);
    return file;
  }
  const bin = await ytDlp();
  const got = spawnSync(
    bin,
    [
      "-f",
      "ba[abr<=96]/ba/b",
      "--no-playlist",
      "-N",
      "4",
      "-o",
      join(dir, "%(id)s.%(ext)s"),
      "--print",
      "after_move:filepath",
      input,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const file = got.stdout.trim().split("\n").at(-1);
  if (got.status !== 0 || !file || !existsSync(file))
    throw new Stop(
      `yt-dlp could not get the audio:\n${got.stderr.trim().split("\n").slice(-4).join("\n")}`,
    );
  return file;
}

async function cut(input, flags) {
  if (!input || !flags.out) throw new Stop(usage(import.meta.url));
  const dir = resolve(flags.out);
  mkdirSync(dir, { recursive: true });
  const minutes = Number(flags.minutes ?? 10);
  const source = await fetchAudio(input, dir);
  const bin = ffmpeg();
  const total = duration(bin, source);
  const name = basename(source, extname(source)).replace(/[^\w-]+/g, "_");
  const made = spawnSync(
    bin,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      source,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "48k",
      "-f",
      "segment",
      "-segment_time",
      String(minutes * 60),
      "-reset_timestamps",
      "1",
      join(dir, `${name}-%03d.mp3`),
    ],
    { encoding: "utf8" },
  );
  if (made.status !== 0)
    throw new Stop(`ffmpeg could not cut it:\n${made.stderr}`);
  if (source.startsWith(dir) && !existsSync(input)) rmSync(source);
  const pieces = [];
  let at = 0;
  for (
    let i = 0;
    existsSync(join(dir, `${name}-${String(i).padStart(3, "0")}.mp3`));
    i++
  ) {
    const file = join(dir, `${name}-${String(i).padStart(3, "0")}.mp3`);
    const length = duration(bin, file);
    pieces.push({
      file: shown(file),
      start: Math.round(at),
      seconds: Math.round(length),
    });
    at += length;
  }
  const manifest = join(dir, `${name}.pieces.json`);
  writeFileSync(
    manifest,
    `${JSON.stringify({ source: input, name, seconds: Math.round(total), pieces }, null, 2)}\n`,
  );
  const long = total >= 3600;
  return [
    `${clock(total, long)} of audio in ${pieces.length} pieces of ≤${minutes} min (${shown(manifest)}):`,
    ...pieces.map((p) => `${p.file}  from ${clock(p.start, long)}`),
    `Transcribe each piece, then: node ${shown(join(here(import.meta.url), "audio.mjs"))} join ${shown(manifest)} <the transcript files, in this order>`,
  ].join("\n");
}

/**
 * A transcribe tool file (studio.tool transcriptFile): `# name`, the text, and a `## Timeline`
 * of `- m:ss text` lines when the model gave segments. Returns lines of `{ at, text, exact }`,
 * times within the piece. A timeline in another shape stops rather than being read as none:
 * its times would quietly become guesses.
 */
function readPiece(file, seconds) {
  const body = readFileSync(file, "utf8");
  const [whole, timeline] = body.split(/^## Timeline\s*$/m);
  if (timeline) {
    const lines = [];
    for (const row of timeline.split("\n")) {
      const m = row.match(/^- (\d+):(\d{2}) (.*)$/);
      if (m)
        lines.push({
          at: Number(m[1]) * 60 + Number(m[2]),
          text: m[3],
          exact: true,
        });
    }
    if (lines.length) return lines;
    throw new Stop(
      `${shown(file)} has a timeline in a shape this script does not read (lines of "- m:ss text"), so its times would be guesses. Read the transcript files themselves instead.`,
    );
  }
  const text = whole
    .replace(/^# .*$/m, "")
    .replace(/\s+/g, " ")
    .trim();
  // No segments: sentences grouped into about half a minute each, timed by where they fall
  const sentences = text.match(/[^.?!。？！]+[.?!。？！]*\s*/g) ?? [text];
  const share = Math.max(
    Math.round((text.length * 30) / Math.max(seconds, 1)),
    200,
  );
  const lines = [];
  let at = 0;
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > share) {
      lines.push({
        at: (at / text.length) * seconds,
        text: current.trim(),
        exact: false,
      });
      at += current.length;
      current = "";
    }
    current += sentence;
  }
  if (current.trim())
    lines.push({
      at: (at / text.length) * seconds,
      text: current.trim(),
      exact: false,
    });
  return lines;
}

function join_(manifestFile, files) {
  if (!manifestFile || !files.length) throw new Stop(usage(import.meta.url));
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  if (files.length !== manifest.pieces.length)
    throw new Stop(
      `${manifest.pieces.length} pieces, ${files.length} transcripts: give one transcript file per piece, in order.`,
    );
  const long = manifest.seconds >= 3600;
  const lines = manifest.pieces.flatMap((piece, i) =>
    readPiece(files[i], piece.seconds).map((line) => {
      const label = clock(piece.start + line.at, long);
      return {
        label,
        text: `[${line.exact || line.at === 0 ? "" : "~"}${label}] ${line.text}`,
      };
    }),
  );
  const parts = withParts(lines);
  const out = join(dirname(resolve(manifestFile)), `${manifest.name}.txt`);
  writeFileSync(out, `# ${manifest.source}\n\n${parts.text}`);
  return `Transcript: ${readingLine(out, parts.index)}`;
}

await run(async () => {
  const { positional, flags } = parseArgs();
  const [command, ...rest] = positional;
  if (command === "cut") console.log(await cut(rest[0], flags));
  else if (command === "join") console.log(join_(rest[0], rest.slice(1)));
  else throw new Stop(usage(import.meta.url));
});
