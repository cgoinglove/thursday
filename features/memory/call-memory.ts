import { generateText, stepCountIs } from "ai";
import { CALL_MEMORY } from "@/config";
import { loadTools } from "@/features/ai/load-tools";
import {
  getTextModel,
  modelErrorToString,
  promptCacheOptions,
} from "@/features/ai/model";
import { loadCallMemoryPrompt } from "@/features/ai/prompts/call-memory.prompt";
import {
  type EndedSpokenCall,
  listCallTalk,
  readLiveSettings,
  takeCallForMemory,
} from "@/features/thursday/thursday.query";
import { readTextCallProvider } from "@/features/thursday/thursday.text";
import { logger } from "@/lib/logger";
import { listCallFacts } from "./memory.query";

/**
 * The pass after a spoken call. On a spoken call the voice alone decides what reaches the
 * backend that holds memory, and what the user says about themselves in passing it mostly
 * keeps to itself. Once the call has ended, a text model reads what was said and keeps what is
 * not kept yet, with the call's own memory tools, so a fact reads as said on that call.
 *
 * It runs on the server, never in a page: whatever ended the call — a goodbye, an idle close,
 * the tab going, a server stopping under it — is followed by a wake (`keepCallMemory`), and a
 * wake reads every spoken call that ended and was never read, oldest first. Taking a call
 * stamps it (thursday.query takeCallForMemory), so it is read at most once: a pass that fails
 * is logged and not tried again. A call in writing or from a phone is never read: there the
 * backend heard the user's own words.
 */

type Pinned = {
  __callMemory?: { running: Promise<void> | null; again: boolean };
};

/** Pinned to globalThis: an action and a route can load this module apart (data.md). */
const state = ((globalThis as Pinned).__callMemory ??= {
  running: null,
  again: false,
});

/**
 * Reads the spoken calls that ended unread, one at a time. Never rejects, and nothing that
 * ends a call waits on it; what it returns settles once no call is left to read, for a test.
 * A wake while a reading runs is taken up by it once it is through.
 */
export function keepCallMemory(): Promise<void> {
  if (state.running) {
    state.again = true;
    return state.running;
  }
  state.running = (async () => {
    do {
      state.again = false;
      const since = new Date(Date.now() - CALL_MEMORY.catchUpMs);
      for (;;) {
        const call = await takeCallForMemory(since);
        if (!call) break;
        await readCall(call).catch((cause) =>
          logger.error(`call memory ${call.id}: ${modelErrorToString(cause)}`),
        );
      }
    } while (state.again);
  })()
    .catch((cause) => logger.error("call memory", cause))
    .finally(() => {
      state.running = null;
      // A wake that came between the last look and here
      if (state.again) void keepCallMemory();
    });
  return state.running;
}

/** One call, read once: what it said, against memory as it stands now. */
async function readCall(call: EndedSpokenCall): Promise<void> {
  const began = Date.now();
  const [talk, kept, provider, settings] = await Promise.all([
    listCallTalk(call.id, CALL_MEMORY.turns + 1),
    listCallFacts(call.id),
    readTextCallProvider(),
    readLiveSettings(),
  ]);
  if (!talk.some((turn) => turn.role === "user")) return;
  if (!provider) {
    logger.warn(
      `call memory ${call.id}: no GPT subscription or OpenAI key to read the call on`,
    );
    return;
  }

  // The plan first, as a call in writing has it, on the model this call's backend ran on
  const ref = {
    provider,
    model: call.backendModel ?? settings.backendModel,
  };
  const clipped = talk.length > CALL_MEMORY.turns;
  const [model, prompt, tools] = await Promise.all([
    getTextModel(ref),
    loadCallMemoryPrompt({
      startedAt: call.startedAt,
      talk: clipped ? talk.slice(-CALL_MEMORY.turns) : talk,
      clipped,
      kept,
    }),
    loadTools({ target: "call-memory", callId: call.id }),
  ]);

  await generateText({
    model: model.model,
    instructions: prompt.system,
    messages: [{ role: "user", content: prompt.user }],
    tools,
    stopWhen: stepCountIs(CALL_MEMORY.steps),
    timeout: { stepMs: CALL_MEMORY.stepMs },
    // One key for every pass: what never changes leads, and the next pass reads it cached
    providerOptions: promptCacheOptions(ref, "call-memory"),
  });

  const now = await listCallFacts(call.id);
  const before = new Set(kept.map((fact) => fact.id));
  const wrote = now.filter((fact) => !before.has(fact.id)).length;
  logger.info(
    `call memory ${call.id}: ${wrote} fact(s) kept in ${((Date.now() - began) / 1000).toFixed(1)}s on ${ref.provider}/${ref.model}`,
  );
}
