"use server";

import { asSchema } from "ai";
import z from "zod";
import { LIVE_PROVIDER } from "@/features/ai/live.schema";
import { loadTools } from "@/features/ai/load-tools";
import { loadLivePrompt } from "@/features/ai/prompts/live.prompt";
import { loadThursdayPrompt } from "@/features/ai/prompts/thursday.prompt";
import { removeThread } from "@/features/bot/bot.runner";
import { listAllThreadIds } from "@/features/bot/thread.query";
import { readConfig } from "@/features/config/config.query";
import { deleteAllNotes } from "@/features/memory/memory.query";
import {
  LIVE_MODEL,
  LiveCloseSchema,
  type ToolManifest,
} from "@/lib/live/live.schema";
import { createLiveCall } from "@/lib/live/live.server";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";
import {
  deleteCall,
  deleteEndedCalls,
  endCall,
  insertCall,
  saveTurns,
  writeCallSkillsOn,
} from "./thursday.query";
import {
  type CallHandshake,
  CallTurnSchema,
  ThursdaySettingsSchema,
} from "./thursday.schema";

// Server actions run one at a time per client, so the recording actions stay
// small: a tool call mid-sentence may be queued behind them.

/** An offer with every ICE candidate gathered stays far below this. */
const SDP_MAX_LENGTH = 65_536;

/**
 * The same tool set /api/thursday/tool-call executes. Tools without `execute`
 * (`end_call`) are included: the model must see them and the page intercepts them.
 */
async function loadToolManifest(): Promise<ToolManifest[]> {
  const tools = await loadTools({ target: "thursday" });

  return Object.entries(tools).map(([name, definition]) => {
    const { $schema, ...parameters } = asSchema(definition.inputSchema)
      .jsonSchema as Record<string, unknown>;
    return {
      name,
      // The SDK allows a function description; none of ours use one.
      description:
        typeof definition.description === "string"
          ? definition.description
          : "",
      parameters: parameters as ObjectSchema,
    };
  });
}

/**
 * Opens a Live call from the browser's SDP offer. Both prompts, the tool manifest
 * and the account key stay here; the browser gets the SDP answer, the call row
 * and what it needs to draw and save the call.
 */
export const openCallAction = serverAction(
  async (settings: unknown, sdp: unknown): Promise<CallHandshake> => {
    const thursday = ThursdaySettingsSchema.parse(settings);
    const offer = z.string().min(1).max(SDP_MAX_LENGTH).parse(sdp);
    const apiKey = await readConfig(LIVE_PROVIDER.apiKeyName);
    if (!apiKey) {
      publicError(`No ${LIVE_PROVIDER.label} key — add one in Config.`);
    }

    // Assembled per call, never cached: both prompts read what earlier calls stored.
    const [voice, backend, tools] = await Promise.all([
      loadLivePrompt({
        voicePrompt: thursday.voicePrompt,
        webSearch: thursday.webSearch,
        locale: thursday.locale,
      }),
      loadThursdayPrompt(thursday.backendPrompt),
      loadToolManifest(),
    ]);

    // Connect before insert: a refused key or model must not leave an open row nobody can close.
    // Free-text model ids are not checked here; the provider refuses them and says why.
    const connection = await createLiveCall({
      apiKey,
      sdp: offer,
      voice: thursday.voice,
      instructions: voice.text,
      input: voice.input,
      backend: {
        model: thursday.backendModel,
        instructions: backend,
        tools,
        reasoningEffort: thursday.reasoningEffort,
        webSearch: thursday.webSearch,
      },
    });
    const callId = await insertCall({
      provider: LIVE_PROVIDER.id,
      model: LIVE_MODEL,
      backendModel: thursday.backendModel,
    });

    return {
      callId,
      sdp: connection.transport.sdp,
      opening: voice.opening,
    };
  },
);

/**
 * Hands the call `load_skill`, or takes it back. Nothing is cached: the next
 * call builds its tool set and its prompt from this (ai/load-tools).
 */
export const setCallSkillsAction = serverAction(async (on: unknown) => {
  await writeCallSkillsOn(z.boolean().parse(on));
});

export const saveTurnsAction = serverAction(
  async (callId: string, turns: unknown) => {
    await saveTurns(callId, CallTurnSchema.array().min(1).parse(turns));
  },
);

/**
 * Ends the row. `close` is what `session.closed` confirmed; absent when the
 * confirmation never came, which leaves the billed seconds unknown.
 */
export const endCallAction = serverAction(
  async (callId: unknown, close?: unknown) => {
    await endCall(
      z.string().min(1).parse(callId),
      LiveCloseSchema.nullish().parse(close),
    );
  },
);

/**
 * Deletes a call and its turns; the next call's prompt no longer includes it.
 * The query refuses a call still in progress.
 */
export const deleteCallAction = serverAction(async (callId: string) => {
  if (!(await deleteCall(callId))) {
    publicError("That call is still on the line — hang up first.");
  }
});

/**
 * Deletes every ended call and its turns; returns how many went. A call still
 * on the line stays, as it does for one (deleteCall).
 */
export const deleteEndedCallsAction = serverAction(async () =>
  deleteEndedCalls(),
);

/**
 * Wipes what the app has kept of its own use: every ended call and its turns,
 * every thread and its messages, and every memory note. Keys, bots and connectors
 * stay — the set `pnpm reset` calls History.
 *
 * History is not one domain, so this reaches into three and each clears its own
 * rows. Live work is stopped before its row goes: `removeThread` aborts a running
 * job and closes its shell.
 */
export const resetHistoryAction = serverAction(async () => {
  const threadIds = await listAllThreadIds();
  for (const id of threadIds) await removeThread(id);

  const calls = await deleteEndedCalls();
  const notes = await deleteAllNotes();

  return { calls, threads: threadIds.length, notes };
});
