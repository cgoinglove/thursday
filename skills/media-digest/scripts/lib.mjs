import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class Stop extends Error {}

/**
 * The folder a script sits in, as a path and not a url: a printed command has to be one a
 * shell can run, and a url percent-escapes a space or any non-ASCII name in the path.
 */
export const here = (url) => dirname(fileURLToPath(url));

/** Runs `main`, printing a Stop as one line and anything else as the error it is. */
export async function run(main) {
  try {
    await main();
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

/** The comment at the top of a script, which is its manual. */
export function usage(url) {
  const lines = readFileSync(new URL(url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((line) => !line.startsWith("//"));
  return lines
    .slice(0, end)
    .map((line) => line.replace(/^\/\/ ?/, ""))
    .join("\n");
}

/** `--name value` and `--flag`; the rest as positionals. */
export function parseArgs(argv = process.argv.slice(2)) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return { positional, flags };
}

/** The app's workspace: the nearest folder above holding its fence and a `projects` folder. */
export function findWorkspace() {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (
      existsSync(join(dir, "pnpm-workspace.yaml")) &&
      existsSync(join(dir, "projects"))
    )
      return dir;
    if (dir === dirname(dir)) return process.cwd();
  }
}

export const WORKSPACE = findWorkspace();
export const shown = (path) => relative(WORKSPACE, path) || ".";
export const artifactsDir = () =>
  resolve(WORKSPACE, process.env.THURSDAY_ARTIFACTS || "artifacts");

/** 75 → "1:15", 3725 → "1:02:05". `long` pads minutes for a video past an hour. */
export function clock(seconds, long = seconds >= 3600) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return long ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * "1:02:05", "12:30", "95", 95 → seconds; null when it is none of these. A leading `~`
 * (an estimated time, `audio.mjs`) is dropped, so an estimate still lands somewhere.
 */
export function seconds(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "")
    .trim()
    .replace(/^~/, "");
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  const m = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export const compact = (n) =>
  n == null || Number.isNaN(Number(n))
    ? "?"
    : new Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(Number(n));

export const oneLine = (text, max) => {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * How long a part may be: under what one `bash` call shows before it cuts the rest to a file
 * (THURSDAY_TOOL_OUTPUT, from the app's config), with room for a line of notes in the same
 * call. Outside a bot's shell nothing cuts what a command prints, so a file is one part.
 */
export const PART_CHARS =
  (Number(process.env.THURSDAY_TOOL_OUTPUT) || Number.POSITIVE_INFINITY) -
  1_000;

/**
 * Lines of `[time] text` (or `[p. N] text`) into parts that each fit one read, a part
 * starting early at a chapter when it is already half full. Returns the file's text,
 * with `## Part N · from–to` above each part, and the parts' index.
 */
export function withParts(lines, breaks = new Set()) {
  const parts = [];
  let current = null;
  lines.forEach((line, i) => {
    const size = line.text.length + 1;
    const full = current && current.chars + size > PART_CHARS;
    const chapter = current && breaks.has(i) && current.chars > PART_CHARS / 2;
    if (!current || full || chapter) {
      current = { lines: [], chars: 0, from: line.label, to: line.label };
      parts.push(current);
    }
    current.lines.push(line.text);
    current.chars += size;
    current.to = line.label;
  });
  const text = parts
    .map(
      (part, i) =>
        `## Part ${i + 1} · ${part.from}–${part.to}\n${part.lines.join("\n")}`,
    )
    .join("\n\n");
  const index = parts.map((part, i) => ({
    part: i + 1,
    from: part.from,
    to: part.to,
    chars: part.chars,
  }));
  return { text: `${text}\n`, index };
}

/** One line naming how to read a file in parts, or that one read takes it all. */
export function readingLine(file, index) {
  const chars = index
    .reduce((sum, part) => sum + part.chars, 0)
    .toLocaleString("en");
  if (index.length <= 1) return `${chars} chars, one part: cat ${shown(file)}`;
  return `${chars} chars in ${index.length} parts of ≤${PART_CHARS.toLocaleString("en")} chars: node ${shown(join(here(import.meta.url), "part.mjs"))} ${shown(file)} <1-${index.length}>`;
}

// Says what it is: a site that turns a script away has said no, and the job says so
const AGENT = "thursday-agent media-digest";

export async function download(url, file) {
  const res = await fetch(url, { headers: { "user-agent": AGENT } });
  if (!res.ok) throw new Stop(`${url} answered ${res.status}.`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return res.headers.get("content-type") ?? "";
}

const onPath = (name, args = ["--version"]) =>
  spawnSync(name, args, { stdio: "ignore" }).status === 0;

/**
 * yt-dlp on the machine, or the release build unpacked once into the workspace. The
 * folder build rather than the single file: that one unpacks itself on every run, which
 * on a Mac costs twelve seconds a call.
 */
export async function ytDlp() {
  if (onPath("yt-dlp")) return "yt-dlp";
  const dir = join(WORKSPACE, "projects", ".yt-dlp");
  const asset = {
    darwin: "yt-dlp_macos",
    linux: process.arch === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux",
    win32: process.arch === "arm64" ? "yt-dlp_win_arm64" : "yt-dlp_win",
  }[process.platform];
  if (!asset) throw new Stop(`No yt-dlp build for ${process.platform}.`);
  const exe = () =>
    readdirSync(dir, { recursive: true })
      .map((name) => join(dir, String(name)))
      .find(
        (path) =>
          /(^|[\\/])yt-dlp[^\\/]*?(\.exe)?$/.test(path) &&
          !path.includes("_internal") &&
          !path.endsWith(".zip"),
      );
  const found = existsSync(dir) && exe();
  if (found) return found;

  process.stderr.write(
    "No yt-dlp on this machine: unpacking the release build into projects/.yt-dlp, once (~50 MB)…\n",
  );
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, `${asset}.zip`);
  await download(
    `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}.zip`,
    zip,
  );
  const unpacked =
    (onPath("unzip", ["-v"]) &&
      spawnSync("unzip", ["-q", "-o", zip, "-d", dir]).status === 0) ||
    spawnSync("tar", ["-xf", zip, "-C", dir]).status === 0 ||
    spawnSync("python3", ["-m", "zipfile", "-e", zip, dir]).status === 0;
  rmSync(zip, { force: true });
  const made = unpacked && exe();
  if (!made)
    throw new Stop(
      "Unpacking yt-dlp failed: no unzip, tar or python3 could open it.",
    );
  if (process.platform !== "win32") chmodSync(made, 0o755);
  return made;
}

/** ffmpeg on the machine, or a portable build installed once into the workspace. */
export function ffmpeg() {
  if (onPath("ffmpeg", ["-version"])) return "ffmpeg";
  const dir = join(WORKSPACE, "projects", ".ffmpeg");
  const bin = join(
    dir,
    "node_modules",
    "ffmpeg-static",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );
  if (existsSync(bin)) return bin;
  process.stderr.write(
    "No ffmpeg on this machine: installing a portable one into projects/.ffmpeg, once…\n",
  );
  mkdirSync(dir, { recursive: true });
  const made = spawnSync(
    "npm",
    [
      "install",
      "--prefix",
      dir,
      "--no-save",
      "--no-audit",
      "--no-fund",
      "ffmpeg-static",
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (made.status !== 0 || !existsSync(bin))
    throw new Stop(
      "Installing a portable ffmpeg failed; npm's output above says why.",
    );
  return bin;
}
