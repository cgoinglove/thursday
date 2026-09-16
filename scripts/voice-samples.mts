#!/usr/bin/env node
// Records one spoken line per Live voice into public/voices, so the voice picker
// can play a sample of each. Live is the only place these voices exist: the
// speech endpoint carries fewer than half of them.
//
// Run with tsx, which resolves the `@/` alias:
//   pnpm voice:samples              every voice with no clip yet
//   pnpm voice:samples willow stone one or more voices
//   pnpm voice:samples --force      re-record, overwriting
//
// Each clip costs one short Live session (billed per second) on OPENAI_API_KEY,
// taken from the environment (.env included) or from the local database.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
// node:sqlite is built into Node 22.13+.
import { DatabaseSync } from "node:sqlite";
import { DB_FILE_NAME } from "@/config";
import { LIVE_VOICES } from "@/features/ai/live.schema";
import { LIVE_MODEL } from "@/lib/live/live.schema";

type Voice = (typeof LIVE_VOICES)[number];

/**
 * What each voice says, and how. Short on purpose: a picker is A/B listening,
 * and two seconds of the real manner beats a paragraph read flat. The words
 * never imitate a region — the accent already carries that — so what varies is
 * the kind of line it is: an offer, a question, a dry aside, a reassurance.
 */
const SAMPLES: Record<Voice, { line: string; manner: string }> = {
  marin: {
    line: "Thursday here. Tell me what we're doing.",
    manner: "warm and easy, like picking up a call from a friend",
  },
  cedar: {
    line: "Go on — I'm listening. Take your time.",
    manner: "low and unhurried, settling in",
  },
  gleam: {
    line: "Oh, nice. Let's get this moving!",
    manner: "bright and quick, already halfway in",
  },
  meridian: {
    line: "Right. Let's take it from the top.",
    manner: "level and matter-of-fact, no flourish",
  },
  quartz: {
    line: "So — where do we start?",
    manner: "light and curious, a lift at the end",
  },
  ripple: {
    line: "No rush at all. I've got this.",
    manner: "relaxed and reassuring, slightly drawn out",
  },
  vesper: {
    line: "Say the word. Consider it done.",
    manner: "dry and precise, faintly amused",
  },
  willow: {
    line: "Ah, take your time. I'm right here.",
    manner: "gentle and close, unhurried",
  },
  stone: {
    line: "Say it plain. I'll sort the rest.",
    manner: "steady and plain-spoken, no fuss",
  },
  bossa: {
    line: "Tell me everything — I'm all ears.",
    manner: "warm and playful, leaning in",
  },
  tempo: {
    line: "Point me at it. I'll keep it moving.",
    manner: "brisk and upbeat, forward-leaning",
  },
  beacon: {
    line: "Okay! So what's the goal here?",
    manner: "friendly and eager, opening up",
  },
  delta: {
    line: "Alright. Let's have a look at this.",
    manner: "unhurried and kind, taking a seat",
  },
  cinder: {
    line: "Sure thing. I'll get it rolling.",
    manner: "easygoing and confident, half a smile",
  },
  alloy: {
    line: "Ready when you are.",
    manner: "neutral and calm, one short beat",
  },
  ash: {
    line: "Tell me what happened. Start anywhere.",
    manner: "grounded and attentive, slightly serious",
  },
  ballad: {
    line: "I'm here. Whenever you're ready.",
    manner: "soft and patient, trailing gently",
  },
  coral: {
    line: "Ooh, yes — let's do it!",
    manner: "delighted and fast, real enthusiasm",
  },
  echo: {
    line: "Noted. What else should I know?",
    manner: "clipped and efficient, already writing it down",
  },
  sage: {
    line: "Mm. Keep going, I'm with you.",
    manner: "quiet and thoughtful, in no hurry",
  },
  shimmer: {
    line: "Of course! I'd be glad to.",
    manner: "sunny and open, a smile in it",
  },
  verse: {
    line: "Alright — let's take this apart.",
    manner: "curious and a little theatrical",
  },
};

/** What the model is recording. Kept short: the line itself carries the sample. */
const RECORDING_INSTRUCTIONS =
  "You are recording a one-line voice sample. Speak the line you are given exactly as written, once, in the manner you are given, then stop. Say nothing else, and do not add a greeting or a question of your own.";

const ROOT = join(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "public", "voices");
const KEY_NAME = "OPENAI_API_KEY";
const LIVE_URL = "wss://api.openai.com/v1/live/sessions";

const SAMPLE_RATE = 24_000;
/** Live advances its session clock from incoming frames, so silence has to flow. */
const INPUT_CHUNK_MS = 100;
/** Silence under this fraction of the clip's own peak is not speech. */
const SILENCE_FLOOR = 0.03;
const FRAME = SAMPLE_RATE / 100; // 10ms
/** Room tone kept around the speech: a clip that starts on the first syllable reads as clipped. */
const LEAD_FRAMES = 8;
const TAIL_FRAMES = 12;
const FADE_SAMPLES = (SAMPLE_RATE / 1000) * 15;

/** One chunk of silence, ready to send. */
const SILENCE = Buffer.alloc(
  (SAMPLE_RATE / 1000) * INPUT_CHUNK_MS * 2,
).toString("base64");

const START_TIMEOUT_MS = 20_000;
const SPEECH_TIMEOUT_MS = 40_000;
/**
 * Output audio streams without pause, so the transcript is what says the line
 * ended. Audio lags it, so the wait is long enough to keep the last word.
 */
const QUIET_MS = 2_000;
const CLOSE_TIMEOUT_MS = 8_000;

/** Env wins over the row the settings screen wrote, the same order the app uses. */
function readKey(): string {
  const fromEnv = process.env[KEY_NAME]?.trim();
  if (fromEnv) return fromEnv;
  const path = DB_FILE_NAME.replace(/^file:/, "");
  if (!existsSync(path)) {
    throw new Error(
      `No ${KEY_NAME} in the environment, and no database at ${path}.`,
    );
  }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db
      .prepare("select value from config where key = ?")
      .get(KEY_NAME) as { value?: string } | undefined;
    const value = row?.value?.trim();
    if (!value)
      throw new Error(`No ${KEY_NAME} in the environment or the database.`);
    return value;
  } finally {
    db.close();
  }
}

type Recording = { pcm: Buffer; transcript: string; seconds: number };

/** One Live session that speaks one line. No delegation, so no backend tokens. */
function record(
  voice: Voice,
  sample: { line: string; manner: string },
  apiKey: string,
): Promise<Recording> {
  return new Promise<Recording>((resolve, reject) => {
    // Node's WebSocket takes request options the DOM type does not describe.
    const socket = new WebSocket(LIVE_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    } as unknown as string[]);

    const chunks: Buffer[] = [];
    let transcript = "";
    let seconds = 0;
    let started = false;
    let closing = false;
    let settled = false;
    let quiet: NodeJS.Timeout | undefined;
    let feed: NodeJS.Timeout | undefined;

    const timers = [
      setTimeout(
        () => fail("Live never started the session."),
        START_TIMEOUT_MS,
      ),
      setTimeout(() => finish(), SPEECH_TIMEOUT_MS),
    ];
    const clearAll = () => {
      for (const timer of timers) clearTimeout(timer);
      clearTimeout(quiet);
      clearInterval(feed);
    };
    const send = (event: Record<string, unknown>) =>
      socket.send(JSON.stringify(event));

    function fail(message: string) {
      if (settled) return;
      settled = true;
      clearAll();
      socket.close();
      reject(new Error(message));
    }
    function done() {
      if (settled) return;
      settled = true;
      clearAll();
      socket.close();
      if (!chunks.length) {
        reject(new Error("The session closed without any audio."));
        return;
      }
      resolve({
        pcm: Buffer.concat(chunks),
        transcript: transcript.trim(),
        seconds,
      });
    }
    /** Ask for a clean close so the final usage arrives; give up after a wait. */
    function finish() {
      if (closing || settled) return;
      closing = true;
      clearAll();
      timers.push(setTimeout(done, CLOSE_TIMEOUT_MS));
      send({ type: "session.close" });
    }

    socket.onopen = () => {
      send({
        type: "session.start",
        event_id: `start-${voice}`,
        session: {
          model: LIVE_MODEL,
          instructions: RECORDING_INSTRUCTIONS,
          audio: {
            format: { type: "audio/pcm", rate: SAMPLE_RATE },
            output: { voice },
          },
          store: false,
        },
      });
    };

    socket.onmessage = (message) => {
      let event: { type?: string; [key: string]: unknown };
      try {
        event = JSON.parse(String(message.data));
      } catch {
        return;
      }
      const type = event.type ?? "";

      if (type === "session.started") {
        started = true;
        // Without input frames the session clock never moves: appends go
        // unacknowledged and nothing is spoken. Silence is enough.
        feed = setInterval(
          () => send({ type: "session.input_audio.append", audio: SILENCE }),
          INPUT_CHUNK_MS,
        );
        // The documented way to make Live speak first: the exact wording as a
        // trusted instruction, then a short commentary to start it.
        send({
          type: "session.instructions.append",
          event_id: `line-${voice}`,
          delegation_id: null,
          content: `Say exactly this line now, ${sample.manner}, then stop: "${sample.line}"`,
        });
        send({
          type: "session.commentary.append",
          event_id: `begin-${voice}`,
          delegation_id: null,
          content:
            "Begin the conversation now, following the instructions provided.",
        });
        return;
      }
      if (type === "session.output_audio.delta") {
        chunks.push(Buffer.from(String(event.delta), "base64"));
        return;
      }
      if (type === "session.output_transcript.delta") {
        transcript += String(event.delta ?? "");
        clearTimeout(quiet);
        quiet = setTimeout(finish, QUIET_MS);
        return;
      }
      if (type === "session.closed") {
        const usage = event.usage as { seconds?: number } | undefined;
        seconds = usage?.seconds ?? 0;
        done();
        return;
      }
      if (type.includes("error") || type.includes("failed")) {
        fail(`${type}: ${JSON.stringify(event).slice(0, 400)}`);
      }
    };

    socket.onerror = () =>
      fail(
        started
          ? "The Live connection dropped."
          : "Could not open a Live session.",
      );
    socket.onclose = (close) => {
      if (settled) return;
      if (chunks.length) {
        done();
        return;
      }
      const reason =
        close.reason || (started ? "no audio" : "check the API key");
      fail(`Live closed the session (${close.code}: ${reason}).`);
    };
  });
}

/** Cuts the silence Live leaves around the words, then fades the two edges. */
function trim(pcm: Buffer): Buffer {
  const samples = new Int16Array(
    pcm.buffer,
    pcm.byteOffset,
    Math.floor(pcm.length / 2),
  );
  const frames = Math.floor(samples.length / FRAME);
  const peaks: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    let peak = 0;
    for (let i = frame * FRAME; i < (frame + 1) * FRAME; i++) {
      peak = Math.max(peak, Math.abs(samples[i]));
    }
    peaks.push(peak);
  }
  const loudest = Math.max(...peaks, 1);
  const floor = Math.max(loudest * SILENCE_FLOOR, 200);
  const first = peaks.findIndex((peak) => peak >= floor);
  if (first < 0) return Buffer.from(pcm);
  let last = peaks.length - 1;
  while (last > first && peaks[last] < floor) last--;

  const start = Math.max(0, (first - LEAD_FRAMES) * FRAME);
  const end = Math.min(samples.length, (last + 1 + TAIL_FRAMES) * FRAME);
  const cut = samples.slice(start, end);
  const fade = Math.min(FADE_SAMPLES, Math.floor(cut.length / 2));
  for (let i = 0; i < fade; i++) {
    const gain = i / fade;
    cut[i] = Math.round(cut[i] * gain);
    cut[cut.length - 1 - i] = Math.round(cut[cut.length - 1 - i] * gain);
  }
  return Buffer.from(cut.buffer, cut.byteOffset, cut.byteLength);
}

function peakDbfs(pcm: Buffer): number {
  const samples = new Int16Array(
    pcm.buffer,
    pcm.byteOffset,
    Math.floor(pcm.length / 2),
  );
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak ? 20 * Math.log10(peak / 32768) : -Infinity;
}

/** Opus in ogg, the format the app's other sounds already use. */
function encode(pcm: Buffer, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "s16le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-af",
      "loudnorm=I=-18:TP=-1.5:LRA=11",
      "-c:a",
      "libopus",
      "-b:a",
      "28k",
      "-application",
      "audio",
      file,
    ]);
    let stderr = "";
    ffmpeg.stderr.on("data", (part) => (stderr += String(part)));
    ffmpeg.on("error", () => reject(new Error("ffmpeg is not installed.")));
    ffmpeg.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg failed: ${stderr.trim()}`)),
    );
    ffmpeg.stdin.end(pcm);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const named = args.filter((arg) => !arg.startsWith("--"));
  const unknown = named.filter((name) => !LIVE_VOICES.includes(name as Voice));
  if (unknown.length) {
    throw new Error(`Not a Live voice: ${unknown.join(", ")}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const wanted = (named.length ? named : LIVE_VOICES) as readonly Voice[];
  const todo = wanted.filter(
    (voice) => force || !existsSync(join(OUT_DIR, `${voice}.ogg`)),
  );
  if (!todo.length) {
    console.log("Every clip is already recorded. Pass --force to redo them.");
    return;
  }

  const apiKey = readKey();
  console.log(`Recording ${todo.length} of ${wanted.length} voices.\n`);
  let billed = 0;
  const failures: string[] = [];

  for (const voice of todo) {
    const sample = SAMPLES[voice];
    process.stdout.write(`${voice.padEnd(9)} `);
    try {
      const { pcm, transcript, seconds } = await record(voice, sample, apiKey);
      billed += seconds;
      const clip = trim(pcm);
      const file = join(OUT_DIR, `${voice}.ogg`);
      await encode(clip, file);
      const length = clip.length / 2 / SAMPLE_RATE;
      console.log(
        `${length.toFixed(2)}s (from ${(pcm.length / 2 / SAMPLE_RATE).toFixed(2)}s), ` +
          `peak ${peakDbfs(clip).toFixed(1)} dBFS, billed ${seconds.toFixed(1)}s`,
      );
      console.log(`          asked : ${sample.line}`);
      console.log(`          said  : ${transcript || "(no transcript)"}`);
    } catch (cause) {
      failures.push(voice);
      console.log(`failed — ${cause instanceof Error ? cause.message : cause}`);
    }
  }

  console.log(
    `\nBilled ${billed.toFixed(1)}s of Live voice (about $${((billed / 60) * 0.05).toFixed(3)}).`,
  );
  if (failures.length) {
    console.log(`Not recorded: ${failures.join(", ")}. Run again to retry.`);
    process.exitCode = 1;
  }
}

await main();
