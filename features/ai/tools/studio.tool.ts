import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  generateImage,
  generateSpeech,
  experimental_generateVideo as generateVideo,
  transcribe,
} from "ai";
import { format } from "date-fns";
import z from "zod";
import { PATHS } from "@/config";
import {
  buildImageModel,
  buildSpeechModel,
  buildTranscriptionModel,
  buildVideoModel,
  resolveMediaRef,
} from "@/features/ai/model";
import { STUDIO_TOOLS } from "@/features/ai/tools/tool-name";
import { logger } from "@/lib/logger";
import type { Sandbox } from "@/lib/sandbox";
import { errorToString } from "@/lib/utils";

/**
 * Media tools (image, speech, transcription, video), exposed behind `tool_search`/`tool_call`
 * under one server name (config STUDIO_SERVER) like an MCP server's tools. They are code rather
 * than skills or shell commands because each needs a key, and keys never reach a bot's shell.
 * Bytes go to a file under `artifacts/`; only the path travels, since tool results are replayed on every resume.
 */

/** One studio tool as `tool_search` describes it and `tool_call` runs it. The zod schema becomes JSON Schema for the model (connected.ts). */
export type StudioTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  execute: (
    args: Record<string, unknown>,
    ctx: { sandbox: Sandbox; abortSignal?: AbortSignal },
  ) => Promise<string>;
};

/** Validates on the way in (the caller only has JSON); a bad argument comes back as one readable line for the model. */
function define<Shape extends z.ZodRawShape>(spec: {
  name: string;
  description: string;
  inputSchema: z.ZodObject<Shape>;
  execute: (
    args: z.infer<z.ZodObject<Shape>>,
    ctx: { sandbox: Sandbox; abortSignal?: AbortSignal },
  ) => Promise<string>;
}): StudioTool {
  return {
    ...spec,
    execute: (args, ctx) => {
      const parsed = spec.inputSchema.safeParse(args);
      if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
      return spec.execute(parsed.data, ctx);
    },
  };
}

/** Under artifacts: what is made here is finished work the user opens. */
const DIR = {
  images: `${PATHS.artifacts}/images`,
  audio: `${PATHS.artifacts}/audio`,
  transcripts: `${PATHS.artifacts}/transcripts`,
  videos: `${PATHS.artifacts}/videos`,
};

/** A filename someone can recognise a week later, out of what was asked for. */
function fileName(stem: string, ext: string): string {
  const slug = stem
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stamp = format(new Date(), "yyyyMMdd-HHmmss");
  return `${stamp}${slug ? `-${slug}` : ""}.${ext}`;
}

async function save(
  sandbox: Sandbox,
  dir: string,
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  const path = `${dir}/${name}`;
  await sandbox.exec(`mkdir -p ${dir}`);
  await sandbox.writeFile(path, Buffer.from(bytes));
  return path;
}

/** The path first, on its own line: whoever draws this row reads line one as the file to open. */
const saved = (path: string) =>
  `${path}\nSaved. Give the user this path — the file opens from the task row. Do not describe it back to them; they can open it.`;

/** `video/mp4` → `mp4`, with a fallback for a provider that says nothing. */
const extOf = (mediaType: string | undefined, fallback: string) =>
  mediaType?.split("/")[1]?.split(";")[0] || fallback;

/** Ratios as words, not pixel sizes: providers disagree on exact sizes, and the sdk translates a ratio per provider. */
const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;

const imageTool = async (): Promise<StudioTool | null> => {
  const found = await resolveMediaRef("image");
  if (!found) return null;
  const model = buildImageModel(found.ref, found.apiKey);

  return define({
    name: STUDIO_TOOLS.generate_image,
    description:
      "Draw an image and save it as a file in the workspace. What comes back is its path.",
    inputSchema: z.object({
      prompt: z
        .string()
        .describe(
          "What to draw, described: subject, style, mood, what is in frame. The image model does not see the job or the conversation, so nothing can be left implied.",
        ),
      aspectRatio: z
        .enum(RATIOS)
        .nullable()
        .describe("Aspect ratio. Null for square."),
    }),
    execute: async ({ prompt, aspectRatio }, { sandbox, abortSignal }) => {
      const { image } = await generateImage({
        model,
        prompt,
        aspectRatio: aspectRatio ?? "1:1",
        abortSignal,
      });
      const path = await save(
        sandbox,
        DIR.images,
        fileName(prompt, extOf(image.mediaType, "png")),
        image.uint8Array,
      );
      return saved(path);
    },
  });
};

/** Speech providers cap text per call (OpenAI: 4096 characters). Stated in the schema so the model splits long pieces itself. */
const SPEECH_MAX = 4000;

const speechTool = async (): Promise<StudioTool | null> => {
  const found = await resolveMediaRef("speech");
  if (!found) return null;
  const model = buildSpeechModel(found.ref, found.apiKey);

  return define({
    name: STUDIO_TOOLS.generate_speech,
    description:
      "Read text aloud into an audio file in the workspace — something the user listens to or sends, not Thursday's voice. What comes back is its path.",
    inputSchema: z.object({
      text: z
        .string()
        .min(1)
        .max(SPEECH_MAX)
        .describe(
          `The words to read, up to ${SPEECH_MAX} characters. Longer pieces are read in parts, one call each.`,
        ),
      voice: z
        .string()
        .nullable()
        .describe("A voice name the provider knows. Null for its default."),
      instructions: z
        .string()
        .nullable()
        .describe(
          'How to read it — "slowly", "warm", "like a news anchor". Null for plain.',
        ),
    }),
    execute: async (
      { text, voice, instructions },
      { sandbox, abortSignal },
    ) => {
      const { audio } = await generateSpeech({
        model,
        text,
        voice: voice ?? undefined,
        instructions: instructions ?? undefined,
        outputFormat: "mp3",
        abortSignal,
      });
      const path = await save(
        sandbox,
        DIR.audio,
        fileName(text.slice(0, 60), audio.format || "mp3"),
        audio.uint8Array,
      );
      return saved(path);
    },
  });
};

const mmss = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const transcribeTool = async (): Promise<StudioTool | null> => {
  const found = await resolveMediaRef("transcription");
  if (!found) return null;
  const model = buildTranscriptionModel(found.ref, found.apiKey);

  return define({
    name: STUDIO_TOOLS.transcribe,
    description:
      "Turn an audio file — a recording, a voice memo, a meeting — into text. The transcript is saved as a file in the workspace; what comes back is its path and the text.",
    inputSchema: z.object({
      path: z
        .string()
        .min(1)
        .describe(
          "The audio file: a path relative to the workspace, or an absolute one anywhere on this machine.",
        ),
    }),
    execute: async ({ path }, { sandbox, abortSignal }) => {
      const audio = await readFile(sandbox.resolve(path));
      const result = await transcribe({ model, audio, abortSignal });

      const timeline = result.segments.length
        ? `\n\n## Timeline\n\n${result.segments
            .map(
              (segment) =>
                `- ${mmss(segment.startSecond)} ${segment.text.trim()}`,
            )
            .join("\n")}`
        : "";
      const stem = basename(path, extname(path));
      const out = await save(
        sandbox,
        DIR.transcripts,
        fileName(stem, "md"),
        Buffer.from(`# ${stem}\n\n${result.text.trim()}${timeline}\n`),
      );
      // The text too, folded: a transcript is usually the thing the job is
      // about, and a bot that has to `cat` it back spends a step for nothing
      return `${out}\n\n${await sandbox.fold(result.text, "transcript")}`;
    },
  });
};

const videoTool = async (): Promise<StudioTool | null> => {
  const found = await resolveMediaRef("video");
  if (!found) return null;
  const model = buildVideoModel(found.ref, found.apiKey);

  return define({
    name: STUDIO_TOOLS.generate_video,
    description:
      "Make a short video and save it as a file in the workspace. Takes minutes. What comes back is its path.",
    inputSchema: z.object({
      prompt: z
        .string()
        .describe(
          "What happens: the scene, the motion, the camera, the mood. The video model does not see the job or the conversation, so nothing can be left implied.",
        ),
      aspectRatio: z
        .enum(["16:9", "9:16"])
        .nullable()
        .describe("Aspect ratio. Null for 16:9."),
      seconds: z
        .number()
        .int()
        .min(2)
        .max(10)
        .nullable()
        .describe(
          "Length in seconds, 2 to 10. Null for the provider's default.",
        ),
    }),
    execute: async (
      { prompt, aspectRatio, seconds },
      { sandbox, abortSignal },
    ) => {
      const { video } = await generateVideo({
        model,
        prompt,
        aspectRatio: aspectRatio ?? "16:9",
        duration: seconds ?? undefined,
        abortSignal,
      });
      const path = await save(
        sandbox,
        DIR.videos,
        fileName(prompt, extOf(video.mediaType, "mp4")),
        video.uint8Array,
      );
      return saved(path);
    },
  });
};

/** Only the tools with a model behind them. Read on every listing and call, not cached, so a key pasted a minute ago counts. */
export async function loadStudio(): Promise<StudioTool[]> {
  const tools = await Promise.all([
    built(imageTool),
    built(speechTool),
    built(transcribeTool),
    built(videoTool),
  ]);
  return tools.filter((tool): tool is StudioTool => tool !== null);
}

/**
 * One tool failing to build drops that tool only. This list is on the prompt's path
 * (connected listConnectedToolNames), so a throw here would block the call and every job.
 */
async function built(
  make: () => Promise<StudioTool | null>,
): Promise<StudioTool | null> {
  try {
    return await make();
  } catch (cause) {
    logger.warn(`studio: a tool could not be built — ${errorToString(cause)}`);
    return null;
  }
}
