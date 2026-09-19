import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  INTRO_SPOKEN,
  INTRO_VOICE,
  type IntroLine,
  introClipName,
} from "../features/intro/intro-voice.ts";

/**
 * Records her first-run lines (features/intro/intro-voice) as clips under `public/`.
 * A clip is named by a hash of its words, so only lines whose words changed are recorded,
 * and clips nothing names any more are removed. Needs an OpenAI key and spends a few
 * cents of it:
 *
 *   node --env-file=.env --import tsx scripts/intro-voice.mts
 */

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY is not set.");
  process.exit(1);
}

const dir = join(import.meta.dirname, "..", "public", INTRO_VOICE.dir);
await mkdir(dir, { recursive: true });
const lines = Object.keys(INTRO_SPOKEN) as IntroLine[];
const wanted = new Set(lines.map(introClipName));
const have = new Set(await readdir(dir));

for (const stale of have) {
  if (wanted.has(stale)) continue;
  await rm(join(dir, stale));
  console.log(`removed  ${stale}`);
}

for (const line of lines) {
  const name = introClipName(line);
  if (have.has(name)) {
    console.log(`kept     ${name}`);
    continue;
  }
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: INTRO_VOICE.model,
      voice: INTRO_VOICE.voice,
      instructions: INTRO_VOICE.instructions,
      input: INTRO_SPOKEN[line],
      // Ogg Opus, what the other clips under public/voices are
      response_format: "opus",
    }),
  });
  if (!response.ok) {
    console.error(`${line}: ${response.status} ${await response.text()}`);
    process.exit(1);
  }
  const clip = Buffer.from(await response.arrayBuffer());
  await writeFile(join(dir, name), clip);
  console.log(`recorded ${name}  ${Math.round(clip.length / 1024)} KB`);
}
