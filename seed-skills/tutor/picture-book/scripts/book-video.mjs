// A picture book read aloud: every page screenshotted as one frame, held for as
// long as its voice runs, and joined into one mp4 beside the book.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RENDER = join(SKILLS, "browser", "scripts", "render.mjs");
// Silence after each page's voice before the next page turns
const PAUSE_S = 0.6;
const FPS = 30;

/** ffmpeg on the machine, or a portable build installed once into the workspace. */
function findFfmpeg(workspace, Stop) {
  if (spawnSync("ffmpeg", ["-version"]).status === 0) return "ffmpeg";
  const dir = join(workspace, "projects", ".ffmpeg");
  const bin = join(
    dir,
    "node_modules",
    "ffmpeg-static",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );
  if (existsSync(bin)) return bin;
  console.error(
    "No ffmpeg on this machine: installing a portable one into projects/.ffmpeg, once…",
  );
  mkdirSync(dir, { recursive: true });
  spawnSync(
    "npm",
    [
      "install",
      "--prefix",
      dir,
      "ffmpeg-static",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (!existsSync(bin))
    throw new Stop(
      "Installing a portable ffmpeg failed; npm's output above says why.",
    );
  return bin;
}

/** Seconds, read off the file itself: a scene's length is never guessed. */
function duration(ffmpeg, file, Stop) {
  const probe = spawnSync(ffmpeg, ["-hide_banner", "-i", file], {
    encoding: "utf8",
  });
  const hms = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.stderr ?? "");
  if (!hms) throw new Stop(`${file} is not audio ffmpeg can read.`);
  return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
}

/**
 * Renders `book` (an .html picture book) at `size` and joins its pages with
 * `voices`, one audio file per page in page order, into `<book>.mp4`.
 */
export function bookVideo({ book, voices, size, workspace, shown }, Stop) {
  if (!/^\d+x\d+$/.test(size))
    throw new Stop(`--size is width x height, like 1920x1080; not "${size}".`);
  const missing = voices.filter((file) => !existsSync(file));
  if (!voices.length || missing.length)
    throw new Stop(
      voices.length
        ? `No such audio: ${missing.map(shown).join(", ")}`
        : "Give one audio file per page, in page order, after the book's name.",
    );
  const ffmpeg = findFfmpeg(workspace, Stop);
  const lengths = voices.map((file) => duration(ffmpeg, file, Stop) + PAUSE_S);

  const out = book.replace(/\.html$/, ".mp4");
  const frames = mkdtempSync(
    join(dirname(book), `.${basename(book, ".html")}-frames-`),
  );
  try {
    const drawn = spawnSync(
      process.execPath,
      [RENDER, book, "--size", size, "--out", frames, "--name", "page"],
      { encoding: "utf8" },
    );
    const said = `${drawn.stdout}${drawn.stderr}`.trim();
    if (drawn.status !== 0) throw new Stop(said);
    const broken = /^Pictures that did not load.*$/m.exec(said);
    if (broken) throw new Stop(`${broken[0]} — fix them and run this again.`);
    const pngs = readdirSync(frames)
      .filter((file) => file.endsWith(".png"))
      .sort()
      .map((file) => join(frames, file));
    if (pngs.length !== voices.length)
      throw new Stop(
        `The book has ${pngs.length} page(s) and ${voices.length} audio file(s) came: give one per page, in page order.`,
      );

    const inputs = [];
    const chains = [];
    let joined = "";
    pngs.forEach((png, i) => {
      const s = lengths[i].toFixed(3);
      // A still read twice a second and repeated in the filter: decoding the png
      // at the full frame rate is most of the time otherwise
      const t = (lengths[i] + 1).toFixed(3);
      inputs.push("-loop", "1", "-framerate", "2", "-t", t, "-i", png);
      chains.push(
        `[${i}:v]fps=${FPS},trim=duration=${s},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[v${i}]`,
        `[${pngs.length + i}:a]aformat=sample_rates=48000:channel_layouts=stereo,apad=whole_dur=${s}[a${i}]`,
      );
      joined += `[v${i}][a${i}]`;
    });
    for (const voice of voices) inputs.push("-i", voice);
    const made = spawnSync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        ...inputs,
        "-filter_complex",
        `${chains.join(";")};${joined}concat=n=${pngs.length}:v=1:a=1[v][a]`,
        "-map",
        "[v]",
        "-map",
        "[a]",
        // h264 in yuv420p: what every phone and browser plays
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "stillimage",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-r",
        `${FPS}`,
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        out,
      ],
      { encoding: "utf8" },
    );
    if (made.status !== 0)
      throw new Stop(`ffmpeg could not join the pages:\n${made.stderr}`);
  } finally {
    rmSync(frames, { recursive: true, force: true });
  }
  const secs = Math.round(lengths.reduce((a, b) => a + b, 0));
  const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(
    `Made ${shown(out)}: ${voices.length} pages, ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} long, ${size}, ${mb} MB. Hand back this path.`,
  );
}
