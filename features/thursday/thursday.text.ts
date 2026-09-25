import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  type ModelMessage,
  type StepResult,
  stepCountIs,
  streamText,
  type ToolSet,
  toUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
  validateUIMessages,
} from "ai";
import { z } from "zod";
import { TEXT_CALL } from "@/config";
import { LIVE_PROVIDER, type LiveSettings } from "@/features/ai/live.schema";
import { loadTools } from "@/features/ai/load-tools";
import { getTextModel, modelErrorToString } from "@/features/ai/model";
import {
  type TextModelRef,
  textModelRefSchema,
} from "@/features/ai/model.schema";
import { loadCallStanding } from "@/features/ai/prompts/call-standing";
import { loadThursdayPrompt } from "@/features/ai/prompts/thursday.prompt";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { EXA_API_KEY } from "@/features/config/config.const";
import { readConfig } from "@/features/config/config.query";
import { acceptedReasoning, wantedReasoning } from "@/lib/live/live.server";
import { logger } from "@/lib/logger";
import { startError } from "@/lib/protocol/to-result";
import { publicError } from "@/lib/public-error";
import {
  insertCall,
  nextTurnSeq,
  readLiveSettings,
  saveThought,
  saveTurns,
} from "./thursday.query";
import {
  TEXT_CALL_NOTE,
  TEXT_CALL_PROVIDERS,
  type TextCallHandshake,
  type TextCallNote,
  TextCallNoteSchema,
  type TextCallProvider,
  textCallRunsOn,
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
});

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
  const result = streamText({
    model: run.model,
    instructions: run.system,
    messages: run.messages,
    allowSystemInMessages: true,
    tools: run.tools,
    providerOptions: run.providerOptions,
    stopWhen: stepCountIs(TEXT_CALL.maxSteps),
    abortSignal: signal,
    prepareStep: async ({ stepNumber, messages: soFar }) => {
      const notes = inbox.splice(0);
      if (!notes.length) return undefined;
      for (const note of notes)
        if (note.said) await rows.said(note.text, note.id);
      took.set(stepNumber, notes);
      // Carried forward by the sdk: from here the steps stack on these
      return {
        messages: [
          ...soFar,
          ...notes.map((note) => ({
            role: "user" as const,
            content: note.text,
          })),
        ],
      };
    },
    onStepEnd: rows.step,
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
      controller.enqueue(chunk);
    },
    // Over before the page hears the end: what comes after her last step goes with the next turn
    flush: close,
  });
  // A provider's refusal is the user's to act on, so it is never masked
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools: run.tools,
      onError: modelErrorToString,
    }).pipeThrough(told),
  });
}

/** What reaches a turn already running: the user's own words, or a fact put in for them. */
export type TurnNote = { text: string; said: boolean };

/**
 * A turn whose conversation the server holds (reach): the same run as a page's, answered
 * whole. `messages` is the conversation so far, ending on what was just written; `said` is
 * those words when they are the user's, saved as their turn, and null for an update put in
 * for a bot, which is no turn of its own. `notes` is asked before every step after the
 * first: what arrived while she worked joins this turn instead of waiting for the next, as
 * it does for a bot (bot.run). What comes back is her words, what she did, and the
 * messages to carry into the next turn, in the order they were said.
 */
export async function answerInWriting(input: {
  callId: string;
  standing: string | null;
  messages: ModelMessage[];
  said: string | null;
  notes?: () => TurnNote[];
  signal?: AbortSignal;
}): Promise<{ text: string; did: string[]; messages: ModelMessage[] }> {
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
  // What the latest step was sent. The sdk returns only what she made, so this is where
  // a note that joined keeps its place between her steps
  let sent: ModelMessage[] = [...head, ...messages];
  const result = await generateText({
    model: run.model,
    instructions: run.system,
    messages: sent,
    allowSystemInMessages: true,
    tools: run.tools,
    providerOptions: run.providerOptions,
    stopWhen: stepCountIs(TEXT_CALL.maxSteps),
    abortSignal: signal,
    prepareStep: async ({ stepNumber, messages: soFar }) => {
      const notes = stepNumber > 0 ? (input.notes?.() ?? []) : [];
      sent = [
        ...soFar,
        ...notes.map((note) => ({ role: "user" as const, content: note.text })),
      ];
      for (const note of notes) if (note.said) await rows.said(note.text);
      // Carried forward by the sdk: from here the steps stack on these
      return notes.length ? { messages: sent } : undefined;
    },
    onStepEnd: rows.step,
  });
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
    messages: [
      ...sent.slice(head.length),
      ...(result.steps.at(-1)?.response.messages ?? []),
    ],
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

/** What a turn runs on, whoever holds the conversation: the model, her prompt, her tools. */
async function loadRun(
  callId: string,
  picked?: TextModelRef | null,
  /** Held by the server for someone on a phone: no screen of theirs to put anything on. */
  phone = false,
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
      phone,
      persona: settings.persona,
      stylePrompt: settings.stylePrompt,
      readSkills: settings.readSkills,
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
}: z.infer<typeof BodySchema>) {
  const [run, ui, seq] = await Promise.all([
    loadRun(callId, runsOn),
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
    for (const note of notesIn(sent))
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
      ...(await convertToModelMessages(spreadNotes(ui), {
        ignoreIncompleteToolCalls: true,
      })),
    ],
  };
}

/** The notes a message carries (`data-note` parts), in order. */
const notesIn = (message: UIMessage): TextCallNote[] =>
  message.parts.flatMap((part) =>
    part.type === `data-${TEXT_CALL_NOTE}`
      ? [(part as { data: TextCallNote }).data]
      : [],
  );

/**
 * Every note as a user message of its own, where it sits: ahead of the words it went out
 * with, or between the steps of her answer that read it. A data part left in place is
 * dropped from what the model is sent.
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
      if (part.type !== `data-${TEXT_CALL_NOTE}`) {
        parts.push(part);
        continue;
      }
      cut();
      const note = (part as { data: TextCallNote }).data;
      out.push({
        id: note.id,
        role: "user",
        parts: [{ type: "text", text: note.text }],
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
