import { readFile } from "node:fs/promises";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  type FilePart,
  generateText,
  type ModelMessage,
  type StepResult,
  stepCountIs,
  streamText,
  type TextStreamPart,
  type ToolSet,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
  type UserContent,
  validateUIMessages,
} from "ai";
import * as z from "zod";
import { queryKey } from "@/app/api/query-key";
import { LOOK, TEXT_CALL } from "@/config";
import { LIVE_PROVIDER, type LiveSettings } from "@/features/ai/live.schema";
import { loadTools } from "@/features/ai/load-tools";
import {
  getTextModel,
  isKeyRefused,
  isPlanSpent,
  modelErrorToString,
  seesToolImages,
} from "@/features/ai/model";
import {
  TEXT_MODEL_PROVIDERS,
  type TextModelProviderId,
  type TextModelRef,
  textModelRefSchema,
} from "@/features/ai/model.schema";
import { loadCallStanding } from "@/features/ai/prompts/call-standing";
import { loadThursdayPrompt } from "@/features/ai/prompts/thursday.prompt";
import { checkPicture, tooBigToSee } from "@/features/ai/tools/look.tool";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { EXA_API_KEY } from "@/features/config/config.const";
import { readConfig } from "@/features/config/config.query";
import { mimeOf, workspaceRelative } from "@/features/workspace/file-kind";
import { acceptedReasoning, wantedReasoning } from "@/lib/live/live.server";
import { logger } from "@/lib/logger";
import { startError } from "@/lib/protocol/to-result";
import { PublicError, publicError } from "@/lib/public-error";
import { formatBytes } from "@/lib/utils";
import {
  insertCall,
  nextTurnSeq,
  readLiveSettings,
  saveThought,
  saveTurns,
} from "./thursday.query";
import {
  noteOf,
  notesIn,
  picturePart,
  TEXT_CALL_MOVED,
  TEXT_CALL_NOTE,
  TEXT_CALL_PROVIDERS,
  TEXT_CALL_REFUSED,
  type TextCallHandshake,
  type TextCallMoved,
  type TextCallNote,
  TextCallNoteSchema,
  type TextCallProvider,
  type TextCallRefused,
  textCallRunsOn,
  type Where,
  WhereSchema,
} from "./thursday.schema";
import { toolLine } from "./tool-line";

/**
 * A call in writing: the call's backend alone, with no Live session around it. Same
 * prompt but for its last chapter, same memory, same tools, and the same rows — it is kept
 * as a call, so the next call reads it back under Earlier calls like any other. Whoever
 * writes holds the conversation and hands it over whole with every turn (what a tool
 * answered is not kept in the rows, so they cannot rebuild it): the page, which is
 * answered as a stream, or the server itself for someone writing from a phone (reach),
 * which is answered whole. Either way each turn is saved as it happens, and what arrives
 * while she works — their words, a fact for a bot's update — joins the turn before her
 * next step, as it does for a bot (bot.run).
 */

/** Which sign-in a call in writing runs on, from what is set. Null when neither is. */
export async function readTextCallProvider(): Promise<TextCallProvider | null> {
  const set = await Promise.all(
    TEXT_CALL_PROVIDERS.map(async (provider) =>
      (await readConfig(provider.apiKeyName)) ? provider.apiKeyName : null,
    ),
  );
  return textCallRunsOn((key) => set.includes(key));
}

/**
 * What a call in writing runs on: the model picked for it where it is written (the write
 * line; any provider with a key), else the rule — the GPT subscription when one is signed
 * in, else the OpenAI key, on the call's own backend model.
 */
async function runsOnOf(
  settings: LiveSettings,
  picked: TextModelRef | null | undefined,
): Promise<TextModelRef> {
  if (picked) return picked;
  const provider = await readTextCallProvider();
  if (!provider) publicError(NOTHING_TO_RUN_ON);
  return { provider, model: settings.backendModel };
}

/**
 * Where a turn goes when the GPT subscription refuses it for a spent plan before anything
 * of it ran: the OpenAI key, on the call's backend model, and the line that tells the user
 * so. Null for any other failure, or with no key set. Every turn asks the plan first, so
 * the plan takes the call back once its window resets.
 */
async function spareOf(
  ref: TextModelRef,
  cause: unknown,
): Promise<{ ref: TextModelRef; why: string; line: string } | null> {
  if (ref.provider !== "chatgpt" || !isPlanSpent(cause)) return null;
  if (!(await readConfig(LIVE_PROVIDER.apiKeyName))) return null;
  const model = (await readLiveSettings()).backendModel;
  const label =
    TEXT_MODEL_PROVIDERS.openai.suggestModels.find((one) => one.id === model)
      ?.label ?? model;
  // The plan's own words: which plan, and when it resets (ai/chatgpt usageLimitOf)
  const why = cause instanceof Error ? cause.message : String(cause);
  return {
    ref: { provider: "openai", model },
    why,
    line: `${why} Answering on your OpenAI key (${label}) until it resets.`,
  };
}

/** A spent plan with no key to go on to: what the user can do, after the plan's own words. */
async function planSpentError(cause: unknown): Promise<unknown> {
  if (!isPlanSpent(cause)) return cause;
  const why = cause instanceof Error ? cause.message : String(cause);
  // Set, it was refused partway through a turn: the next turn starts on the key
  return new PublicError(
    (await readConfig(LIVE_PROVIDER.apiKeyName))
      ? `${why} Write again and she answers on your OpenAI key.`
      : `${why} With an OpenAI key in Settings › API keys, she answers on it until then.`,
  );
}

/** The row a call in writing is kept under, and what stood open as it began. */
export async function openTextCall(
  picked?: TextModelRef | null,
): Promise<TextCallHandshake> {
  const ref = await runsOnOf(await readLiveSettings(), picked);
  const [callId, standing] = await Promise.all([
    insertCall({
      provider: ref.provider,
      model: TEXT_CALL.model,
      backendModel: ref.model,
    }),
    loadCallStanding(),
  ]);
  return { callId, standing };
}

const BodySchema = z.object({
  callId: z.string().min(1),
  /** What stood open as the call opened (ai/prompts/call-standing), as the page was handed it. */
  standing: z.string().nullish(),
  /** The model picked on the write line; absent, the rule decides (runsOnOf). */
  runsOn: textModelRefSchema.nullish(),
  /** This answer's own name, new with every request: what the page tells it goes here. */
  turn: z.string().min(1),
  messages: z.array(z.unknown()).min(1),
  /** Where the page found the user and the weather there (where.ts), read by readWhere. */
  where: z.unknown().optional(),
});

/**
 * What a page sent of where the user is, or null. It is extra to the call: what does not fit
 * the schema — a service that sent a null — is dropped with a warning, never a failed call.
 */
export function readWhere(value: unknown): Where | null {
  if (value == null) return null;
  const read = WhereSchema.safeParse(value);
  if (read.success) return read.data;
  logger.warn(
    `The call goes on without where the user is: ${read.error.issues[0]?.message}`,
  );
  return null;
}

type Pinned = {
  __textCallTurns?: Map<string, { callId: string; notes: TextCallNote[] }>;
};
/**
 * The answers pages are streaming now, by their turn: what a page tells one waits here for
 * her next step. Pinned to globalThis: the route that streams and the action that tells are
 * loaded apart.
 */
const answering = ((globalThis as Pinned).__textCallTurns ??= new Map());

/**
 * Puts words or a fact into the answer a page is streaming, read before her next step. What
 * a step read comes back to the page ahead of that step; anything that does not — too late for
 * her last step, or refused here (false) once that answer is over or it is not this call's —
 * the page carries into the next turn.
 */
export function tellTextCall(
  callId: string,
  turn: string,
  note: TextCallNote,
): boolean {
  const open = answering.get(turn);
  if (!open || open.callId !== callId) return false;
  open.notes.push(note);
  return true;
}

export async function streamTextCall(
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  let run: Awaited<ReturnType<typeof prepare>>;
  let turn: string | null = null;
  const inbox: TextCallNote[] = [];
  const close = () => {
    if (turn) answering.delete(turn);
  };
  try {
    const request = BodySchema.parse(body);
    turn = request.turn;
    // Open before anything awaits: what is told while it gets ready joins its first step.
    // Closed however it ends, getting ready included: a page gone then never reads the body
    answering.set(turn, { callId: request.callId, notes: inbox });
    signal.addEventListener("abort", close, { once: true });
    if (signal.aborted) close();
    run = await prepare(request);
  } catch (cause) {
    close();
    // Nothing has streamed yet, so this text is what the page shows as the error
    const { status, message } = startError(cause, "Could not reach her");
    return new Response(message, { status });
  }

  const rows = turnRows(run.callId, run.seq);
  /** What each step read before it ran, by step: told back to the page ahead of that step. */
  const took = new Map<number, TextCallNote[]>();
  const ask = async (on: Run) =>
    streamText({
      model: on.model,
      instructions: on.system,
      messages: await seePictures(run.messages, on.ref),
      allowSystemInMessages: true,
      tools: on.tools,
      providerOptions: on.providerOptions,
      stopWhen: stepCountIs(TEXT_CALL.maxSteps),
      abortSignal: signal,
      // Read at each turn: a stream that went quiet partway held the turn open with nothing said
      timeout: { chunkMs: TEXT_CALL.chunkMs },
      prepareStep: async ({ stepNumber, messages: soFar }) => {
        const notes = inbox.splice(0);
        if (!notes.length) return undefined;
        for (const note of notes)
          if (note.said) await rows.said(note.text, note.id);
        took.set(stepNumber, notes);
        // Carried forward by the sdk: from here the steps stack on these
        return {
          messages: await seePictures(
            [
              ...soFar,
              ...notes.map((note) => ({
                role: "user" as const,
                content: withPictures(note.text, note.pictures),
              })),
            ],
            on.ref,
          ),
        };
      },
      onStepEnd: rows.step,
    });

  /** Where the turn went instead of the plan, once it has: said to the page as it starts. */
  let moved: TextCallMoved | null = null;
  /** The provider the turn is on now, and the one that refused its key, once one has. */
  let on: TextModelProviderId = run.ref.provider;
  let refused: TextCallRefused | null = null;
  // A stream that went quiet past TEXT_CALL.chunkMs ends in an abort the sdk raises itself.
  // The page reads an abort as its own stop and shows nothing, so one the page did not ask
  // for goes to it as the failure it is
  const quiet = (part: TextStreamPart<ToolSet>): TextStreamPart<ToolSet> =>
    part.type === "abort" && !signal.aborted
      ? {
          type: "error",
          error: new Error(
            `No answer came for ${Math.round(TEXT_CALL.chunkMs / 1000)} seconds, so this one was stopped.`,
          ),
        }
      : part;
  const parts = streamParts(async function* () {
    // What opens the stream is held until her first step has something to show: a spent
    // plan refuses before that, and the turn then starts again on the key as if it were new
    const held: TextStreamPart<ToolSet>[] = [];
    let shown = false;
    let spare: Awaited<ReturnType<typeof spareOf>> = null;
    for await (const raw of (await ask(run)).stream) {
      const part = quiet(raw);
      if (!shown && part.type === "error") {
        spare = await spareOf(run.ref, part.error);
        if (spare) break;
      }
      if (!shown && (part.type === "start" || part.type === "start-step")) {
        held.push(part);
        continue;
      }
      shown = true;
      yield* held.splice(0);
      yield part;
    }
    // Moved, what the refused attempt opened is dropped: the answer on the key opens its own
    if (!spare) return yield* held;
    logger.info(`text call ${run.callId}: ${spare.line}`);
    moved = { why: spare.why, line: spare.line };
    on = spare.ref.provider;
    // What the refused step had read goes to the step that runs in its place
    inbox.unshift(...(took.get(0) ?? []));
    took.delete(0);
    try {
      for await (const part of (await ask(await loadRun(run.callId, spare.ref)))
        .stream)
        yield quiet(part);
    } catch (cause) {
      yield { type: "error", error: cause };
    }
  });

  // A note goes back ahead of the step that read it, never inside one, so it can never
  // come between a tool call and what the tool answered when the page sends it all again
  let step = -1;
  const told = new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (chunk.type === "start-step") {
        step += 1;
        for (const note of took.get(step) ?? [])
          controller.enqueue({
            type: `data-${TEXT_CALL_NOTE}`,
            id: note.id,
            data: note,
          });
      }
      // Just ahead of the error it explains: the page offers Settings, not only the turn again
      if (chunk.type === "error" && refused)
        controller.enqueue({
          type: `data-${TEXT_CALL_REFUSED}`,
          data: refused,
          transient: true,
        });
      controller.enqueue(chunk);
      // Once, as the answer on the key begins: said, not kept in the conversation
      if (chunk.type === "start" && moved)
        controller.enqueue({
          type: `data-${TEXT_CALL_MOVED}`,
          data: moved,
          transient: true,
        });
    },
    // Over before the page hears the end: what comes after her last step goes with the next turn
    flush: close,
  });
  // A provider's refusal is the user's to act on, so it is never masked
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: parts,
      tools: run.tools,
      onError: (cause) => {
        if (isKeyRefused(cause)) refused = { provider: on };
        return modelErrorToString(cause);
      },
    }).pipeThrough(told),
  });
}

/** A generator of stream parts as the stream the sdk reads; cancelled, the generator ends. */
function streamParts(
  make: () => AsyncGenerator<TextStreamPart<ToolSet>>,
): ReadableStream<TextStreamPart<ToolSet>> {
  const parts = make();
  return new ReadableStream({
    async pull(controller) {
      const next = await parts.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel() {
      await parts.return(undefined);
    },
  });
}

/**
 * How a conversation names a picture in the workspace until a request reads it in: a file
 * part pointing at `workspace:<path>`. What a conversation carries from turn to turn is that
 * name, never the bytes — a phone's, held here, and a page's, sent again every turn — and
 * each request reads its pictures in for the model it goes to (seePictures). One left unread
 * would have the sdk fetch the address and fail aloud.
 */
const WORKSPACE = "workspace:";

/** A picture in the workspace, named for the conversation (WORKSPACE). */
const namedPicture = (path: string): FilePart => ({
  type: "file",
  mediaType: mimeOf(path),
  filename: path,
  data: {
    type: "url",
    url: new URL(`${WORKSPACE}${encodeURIComponent(path)}`),
  },
});

/** The workspace path a file part names (namedPicture), or null for any other. */
const namedPath = (part: FilePart): string | null => {
  const data = part.data as unknown;
  const url =
    data instanceof URL
      ? data
      : (data as { type?: unknown } | null)?.type === "url"
        ? (data as { url: unknown }).url
        : null;
  return url instanceof URL && url.protocol === WORKSPACE
    ? decodeURIComponent(url.pathname)
    : null;
};

/** Words, and the pictures sent with them named for the conversation (namedPicture). */
const withPictures = (text: string, pictures?: string[]): UserContent =>
  pictures?.length
    ? [{ type: "text", text }, ...pictures.map(namedPicture)]
    : text;

/** The file route a page's picture parts name their file under (thursday.schema picturePart). */
const FILE_ROUTE = queryKey.file("");

/**
 * A page's pictures (picturePart) named for the conversation before it is converted for the
 * model: the file route becomes the WORKSPACE name seePictures reads. A file part naming no
 * workspace file is said, and nothing of it is sent.
 */
function namePictures(ui: UIMessage[]): UIMessage[] {
  return ui.map((message) =>
    message.parts.some((part) => part.type === "file")
      ? {
          ...message,
          parts: message.parts.map((part) => {
            if (part.type !== "file") return part;
            const path = part.url.startsWith(FILE_ROUTE)
              ? workspaceRelative(part.url)
              : null;
            return path
              ? { ...part, url: `${WORKSPACE}${encodeURIComponent(path)}` }
              : {
                  type: "text" as const,
                  text: `${part.filename ?? "A file"} is not in the workspace, so nothing of it was sent to you.`,
                };
          }),
        }
      : message,
  );
}

/** Each message seePictures read, to the named one it was read from. */
const named = new WeakMap<ModelMessage, ModelMessage>();

/** Messages as a conversation carries them on: every picture read in back to its name. */
const asNamed = (messages: ModelMessage[]) =>
  messages.map((message) => named.get(message) ?? message);

/** The file bytes of the pictures a message already carries read in (base64 is a third more). */
function pictureBytes(message: ModelMessage): number {
  if (message.role !== "user" || typeof message.content === "string") return 0;
  let bytes = 0;
  for (const part of message.content) {
    if (part.type !== "file") continue;
    const data = part.data as unknown;
    const held =
      (data as { type?: unknown } | null)?.type === "data"
        ? (data as { data: unknown }).data
        : data;
    if (typeof held === "string") bytes += Math.floor((held.length * 3) / 4);
    else if (held instanceof Uint8Array || held instanceof ArrayBuffer)
      bytes += held.byteLength;
  }
  return bytes;
}

/**
 * One picture a conversation names, read in the `room` a request has left for pictures — or
 * the line that says why it is not there, so she never answers about a picture she was not
 * given. `blind` is the model this goes to, when it cannot see pictures.
 */
async function readPicture(
  path: string,
  blind: string | null,
  room: number,
): Promise<
  { data: string; mediaType: string; bytes: number } | { missed: string }
> {
  if (blind)
    return {
      missed: `${path} is a picture, and ${blind} cannot see pictures, so it was not sent to you.`,
    };
  const checked = await checkPicture(path);
  if ("missing" in checked)
    return {
      missed: `There is no file at ${path} in the workspace, so no picture was sent to you.`,
    };
  if ("notPicture" in checked)
    return {
      missed: `${path} is not a png, jpg, webp or gif, so it was not sent to you as a picture.`,
    };
  if ("tooBig" in checked)
    return {
      missed: `${tooBigToSee(path, checked.tooBig)} It was not sent to you.`,
    };
  if (checked.bytes > room)
    return {
      missed: `${path} is a picture not sent with this message: the pictures after it fill the ${formatBytes(LOOK.perRequest)} one message to you carries. Look at it with look_at to see it.`,
    };
  const data = await readFile(checked.full).catch(() => null);
  if (!data)
    return {
      missed: `${path} could not be read, so no picture was sent to you.`,
    };
  return {
    data: data.toString("base64"),
    mediaType: checked.mediaType,
    bytes: data.length,
  };
}

/**
 * The pictures a conversation names (namedPicture), read in for the model it is sent to as a
 * request goes: newest first, up to LOOK.perRequest with what is already read in, each after
 * the line that names it (`<path>, as an image:`), so several are told apart and each can be
 * looked at again by its path. A model that cannot see pictures (ai/model seesToolImages) is
 * told each by its path. What was read is tied to its named message (named), which is what
 * the conversation carries on with; the same conversation reads the same way every turn, so
 * a provider's cache of it holds until a newer picture pushes an older one out.
 */
async function seePictures(
  messages: ModelMessage[],
  ref: TextModelRef,
): Promise<ModelMessage[]> {
  const blind = seesToolImages(ref) ? null : ref.model;
  let room =
    LOOK.perRequest -
    messages.reduce((sum, message) => sum + pictureBytes(message), 0);
  const out = [...messages];
  for (let at = out.length - 1; at >= 0; at -= 1) {
    const message = out[at];
    if (message.role !== "user" || typeof message.content === "string")
      continue;
    if (
      !message.content.some(
        (part) => part.type === "file" && namedPath(part) !== null,
      )
    )
      continue;
    const content: Exclude<UserContent, string> = [];
    for (const part of [...message.content].reverse()) {
      const path = part.type === "file" ? namedPath(part) : null;
      if (!path) {
        content.unshift(part);
        continue;
      }
      const seen = await readPicture(path, blind, room);
      if ("missed" in seen) {
        content.unshift({ type: "text", text: seen.missed });
        continue;
      }
      room -= seen.bytes;
      content.unshift(
        { type: "text", text: `${path}, as an image:` },
        {
          type: "file",
          mediaType: seen.mediaType,
          data: { type: "data", data: seen.data },
        },
      );
    }
    const read: ModelMessage = { role: "user", content };
    named.set(read, message);
    out[at] = read;
  }
  return out;
}

/**
 * What reaches a turn already running: the user's own words, or a fact put in for them; the
 * workspace paths of pictures sent with the words, which reach her as pictures (seePictures).
 */
export type TurnNote = { text: string; said: boolean; pictures?: string[] };

/**
 * A turn whose conversation the server holds (reach): the same run as a page's, answered
 * whole. `messages` is the conversation so far, ending on what was just written; `said` is
 * those words when they are the user's, saved as their turn, and null for an update put in
 * for a bot, which is no turn of its own. `pictures` are the workspace paths of pictures
 * sent with those words, which go into their message as pictures (seePictures). `notes` is
 * asked before every step after the first: what arrived while she worked joins this turn
 * instead of waiting for the next, as it does for a bot (bot.run). What comes back is her
 * words, what she did, and the messages to carry into the next turn, in the order they were
 * said — and, when a spent plan moved the turn onto the OpenAI key (spareOf), the line that
 * tells them so.
 */
export async function answerInWriting(input: {
  callId: string;
  standing: string | null;
  messages: ModelMessage[];
  said: string | null;
  pictures?: string[];
  notes?: () => TurnNote[];
  signal?: AbortSignal;
}): Promise<{
  text: string;
  did: string[];
  messages: ModelMessage[];
  moved: string | null;
}> {
  const { callId, standing, messages, said, signal } = input;
  const [run, seq] = await Promise.all([
    loadRun(callId, null, true),
    nextTurnSeq(callId),
  ]);
  if (said !== null)
    await saveTurns(callId, [
      { id: crypto.randomUUID(), role: "user", text: said, seq },
    ]);
  const rows = turnRows(callId, said === null ? seq : seq + 1);
  const head = standingHead(standing);
  // The pictures sent with the last words go in their message by name, where every later
  // turn carries them in the same place (seePictures)
  const last = messages.at(-1);
  const asked =
    input.pictures?.length &&
    last?.role === "user" &&
    typeof last.content === "string"
      ? [
          ...messages.slice(0, -1),
          {
            role: "user" as const,
            content: withPictures(last.content, input.pictures),
          },
        ]
      : messages;
  // What the latest step was sent. The sdk returns only what she made, so this is where
  // a note that joined keeps its place between her steps
  let sent: ModelMessage[] = [...head, ...asked];
  /** Steps finished: a turn is moved to the key only while none has. */
  let finished = 0;
  // Read for the model it goes to: a turn moved onto the key reads its pictures again
  const ask = async (on: Run) =>
    generateText({
      model: on.model,
      instructions: on.system,
      messages: await seePictures(asNamed(sent), on.ref),
      allowSystemInMessages: true,
      tools: on.tools,
      providerOptions: on.providerOptions,
      stopWhen: stepCountIs(TEXT_CALL.maxSteps),
      abortSignal: signal,
      prepareStep: async ({ stepNumber, messages: soFar }) => {
        const notes = stepNumber > 0 ? (input.notes?.() ?? []) : [];
        sent = [
          ...soFar,
          ...notes.map((note) => ({
            role: "user" as const,
            content: withPictures(note.text, note.pictures),
          })),
        ];
        for (const note of notes) if (note.said) await rows.said(note.text);
        // Carried forward by the sdk: from here the steps stack on these
        return notes.length
          ? { messages: await seePictures(sent, on.ref) }
          : undefined;
      },
      onStepEnd: async (step) => {
        finished += 1;
        await rows.step(step);
      },
    });
  let result: Awaited<ReturnType<typeof ask>>;
  let moved: string | null = null;
  try {
    result = await ask(run);
  } catch (cause) {
    const spare = finished ? null : await spareOf(run.ref, cause);
    if (!spare) throw await planSpentError(cause);
    logger.info(`text call ${callId}: ${spare.line}`);
    moved = spare.line;
    try {
      result = await ask(await loadRun(callId, spare.ref, true));
    } catch (again) {
      throw await planSpentError(again);
    }
  }
  return {
    text: result.text.trim(),
    // What she did, as the call screen words it: all there is to show for a turn she
    // ended without a word
    did: result.steps.flatMap((step) =>
      step.toolCalls.map(
        (call) =>
          toolLine(call.toolName, JSON.stringify(call.input ?? {})) ??
          call.toolName,
      ),
    ),
    // By name: what carries on to the next turn is never a picture's bytes
    messages: asNamed([
      ...sent.slice(head.length),
      ...(result.steps.at(-1)?.response.messages ?? []),
    ]),
    moved,
  };
}

/**
 * The rows of one turn, numbered from one counter. `step` saves a step as it ends, in the
 * order she made its parts: a tool turn keeps its name and arguments as a spoken call's
 * does, her words are a turn, a summary is a thought. `said` keeps words of the user's that
 * joined the turn between two of her steps.
 */
function turnRows(callId: string, from: number) {
  let seq = from;
  // Under the id the page drew it with, so the same words carried again are the same row
  const said = (text: string, id: string = crypto.randomUUID()) =>
    saveTurns(callId, [{ id, role: "user", text, seq: seq++ }]);
  const step = async (step: StepResult<ToolSet>) => {
    for (const part of step.content) {
      if (part.type === "tool-call") {
        const answered = step.content.find(
          (other) =>
            other.type === "tool-result" &&
            other.toolCallId === part.toolCallId,
        );
        await saveTurns(callId, [
          {
            id: part.toolCallId,
            role: "tool",
            tool: part.toolName,
            text:
              part.toolName === TOOL_NAMES.web_search
                ? searchTurn(
                    part.input,
                    answered?.type === "tool-result" ? answered.output : null,
                  )
                : JSON.stringify(part.input ?? {}),
            seq: seq++,
          },
        ]);
      } else if (part.type === "text" && part.text.trim()) {
        await saveTurns(callId, [
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: part.text.trim(),
            seq: seq++,
          },
        ]);
      } else if (part.type === "reasoning" && part.text.trim()) {
        await saveThought(callId, {
          id: crypto.randomUUID(),
          text: part.text.trim(),
          seq,
        });
      }
    }
  };
  return { step, said };
}

/** What stood open as the call began, ahead of the conversation. */
const standingHead = (standing: string | null | undefined): ModelMessage[] =>
  standing ? [{ role: "system", content: standing }] : [];

type Run = Awaited<ReturnType<typeof loadRun>>;

/** What a turn runs on, whoever holds the conversation: the model, her prompt, her tools. */
async function loadRun(
  callId: string,
  picked?: TextModelRef | null,
  /** Held by the server for someone on a phone: no screen of theirs to put anything on. */
  phone = false,
  /** Where the page found the user (where.ts); a phone has no page to say. */
  where?: Where | null,
) {
  const settings = await readLiveSettings();
  const ref = await runsOnOf(settings, picked);
  // Reasoning effort is OpenAI's word: asked of its models only, sent to them only
  const openai = ref.provider === "openai" || ref.provider === "chatgpt";

  const [model, system, held, exaKey, openaiKey] = await Promise.all([
    getTextModel(ref),
    loadThursdayPrompt({
      backendPrompt: settings.backendPrompt,
      written: true,
      callId,
      phone,
      persona: settings.persona,
      stylePrompt: settings.stylePrompt,
      readSkills: settings.readSkills,
      where,
    }),
    loadTools({
      target: "thursday",
      callId,
      webSearch: settings.webSearch,
      readSkills: settings.readSkills,
      written: true,
      model: ref,
      phone,
    }),
    readConfig(EXA_API_KEY),
    readConfig(LIVE_PROVIDER.apiKeyName),
  ]);

  // One search, never two, as on a spoken call (thursday.action): Exa's is among the
  // tools while its key is set, else the model's own where its provider has one
  const hosted = model.searchTools && Object.values(model.searchTools)[0];
  const tools: ToolSet = {
    ...held,
    // under the search's one name, so the line, the row and the log read it as the search
    ...(settings.webSearch && !exaKey && hosted
      ? { [TOOL_NAMES.web_search]: hosted }
      : {}),
  };

  // The reasoning the call asks for. Whether the model takes it can only be asked with an
  // API key (acceptedReasoning); without one it goes as chosen, and a refusal is shown
  const reasoning = !openai
    ? null
    : openaiKey
      ? await acceptedReasoning({
          apiKey: openaiKey,
          model: ref.model,
          effort: settings.reasoningEffort,
        })
      : wantedReasoning(settings.reasoningEffort);

  return {
    ref,
    model: model.model,
    system,
    tools,
    providerOptions: {
      openai: {
        ...(reasoning?.effort ? { reasoningEffort: reasoning.effort } : {}),
        ...(reasoning && "summary" in reasoning && reasoning.summary
          ? { reasoningSummary: reasoning.summary }
          : {}),
      },
    },
  };
}

async function prepare({
  callId,
  standing,
  runsOn,
  messages,
  where,
}: z.infer<typeof BodySchema>) {
  const [run, ui, seq] = await Promise.all([
    loadRun(callId, runsOn, false, readWhere(where)),
    validateUIMessages({
      messages,
      dataSchemas: { [TEXT_CALL_NOTE]: TextCallNoteSchema },
    }),
    nextTurnSeq(callId),
  ]);

  // What was just sent is a turn the moment it arrives, answered or not: each message of
  // theirs since her last answer — a turn that broke leaves one nobody answered — with the
  // words they wrote while she was answering before it. Kept under the ids the page drew them
  // with, so what is sent again is the same row. A fact for a bot's update is no turn of its
  // own, as on a spoken call: her answer to it is what is kept. An answer that broke comes
  // back last when it is sent again, and she carries on from what it finished
  const last = ui.at(-1)?.role;
  if (last !== "user" && last !== "assistant")
    publicError("The conversation must end with your words or hers.");
  let at = seq;
  const answered = ui.findLastIndex((message) => message.role === "assistant");
  for (const sent of ui.slice(answered + 1)) {
    for (const note of notesIn([sent]))
      if (note.said)
        await saveTurns(callId, [
          { id: note.id, role: "user", text: note.text, seq: at++ },
        ]);
    const words = wordsOf(sent);
    if (words)
      await saveTurns(callId, [
        { id: sent.id, role: "user", text: words, seq: at++ },
      ]);
  }

  return {
    ...run,
    callId,
    seq: at,
    messages: [
      ...standingHead(standing),
      // A tool an earlier answer broke off in has no result to send: the model would
      // be refused the whole conversation for it
      ...(await convertToModelMessages(namePictures(spreadNotes(ui)), {
        ignoreIncompleteToolCalls: true,
      })),
    ],
  };
}

/**
 * Every note as a user message of its own, where it sits: ahead of the words it went out
 * with, or between the steps of her answer that read it, with the pictures sent with it. A
 * data part left in place is dropped from what the model is sent.
 */
function spreadNotes(ui: UIMessage[]): UIMessage[] {
  return ui.flatMap((message) => {
    const out: UIMessage[] = [];
    let parts: UIMessage["parts"] = [];
    const cut = () => {
      if (parts.length)
        out.push({ ...message, id: `${message.id}:${out.length}`, parts });
      parts = [];
    };
    for (const part of message.parts) {
      const note = noteOf(part);
      if (!note) {
        parts.push(part);
        continue;
      }
      cut();
      out.push({
        id: note.id,
        role: "user",
        parts: [
          { type: "text", text: note.text },
          ...(note.pictures ?? []).map(picturePart),
        ],
      });
    }
    cut();
    return out;
  });
}

export const NOTHING_TO_RUN_ON =
  "Writing to Thursday needs a GPT subscription sign-in or an OpenAI key — Settings › API keys.";

/**
 * A search as a spoken call keeps it (tool-line searchOf): what was looked for and the pages
 * read. Exa is asked with `query` and answers `sources`; a provider's own search names the
 * query in what it answers.
 */
function searchTurn(input: unknown, output: unknown): string {
  const asked = (input ?? {}) as { query?: unknown };
  const found = (output ?? {}) as {
    action?: { query?: unknown };
    sources?: unknown;
  };
  const query = [asked.query, found.action?.query].find(
    (one): one is string => typeof one === "string" && Boolean(one.trim()),
  );
  const sources = Array.isArray(found.sources)
    ? found.sources.flatMap((source) =>
        source && typeof source === "object" && "url" in source
          ? typeof source.url === "string"
            ? [
                {
                  url: source.url,
                  ...("title" in source && typeof source.title === "string"
                    ? { title: source.title }
                    : {}),
                },
              ]
            : []
          : [],
      )
    : [];
  return JSON.stringify({ query: query ?? null, sources });
}

const wordsOf = (message: UIMessage) =>
  message.parts
    .flatMap((part) => (part.type === "text" ? part.text : []))
    .join("\n")
    .trim();
