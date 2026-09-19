"use server";

import { asSchema } from "ai";
import z from "zod";
import { LIVE_PROVIDER, LiveSettingsSchema } from "@/features/ai/live.schema";
import { loadTools } from "@/features/ai/load-tools";
import { textModelRefSchema } from "@/features/ai/model.schema";
import { loadLastCall } from "@/features/ai/prompts/call-last";
import { loadCallStanding } from "@/features/ai/prompts/call-standing";
import { loadLivePrompt } from "@/features/ai/prompts/live.prompt";
import { loadThursdayPrompt } from "@/features/ai/prompts/thursday.prompt";
import { removeThread } from "@/features/bot/bot.runner";
import { listAllThreadIds } from "@/features/bot/thread.query";
import { EXA_API_KEY } from "@/features/config/config.const";
import { readConfig } from "@/features/config/config.query";
import { deleteAllNotes } from "@/features/memory/memory.query";
import {
  LIVE_MODEL,
  LiveCloseSchema,
  type ToolManifest,
} from "@/lib/live/live.schema";
import { acceptedReasoning, createLiveCall } from "@/lib/live/live.server";
import { createServerProbe } from "@/lib/probe.server";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";
import {
  deleteCall,
  deleteEndedCalls,
  endCall,
  insertCall,
  saveThought,
  saveTurns,
  writeCallSkillsOn,
} from "./thursday.query";
import {
  type CallHandshake,
  CallThoughtSchema,
  CallTurnSchema,
  type TextCallHandshake,
} from "./thursday.schema";
import { openTextCall } from "./thursday.text";

// Server actions run one at a time per client, so the recording actions stay
// small: a tool call mid-sentence may be queued behind them.

/** An offer with every ICE candidate gathered stays far below this. */
const SDP_MAX_LENGTH = 65_536;

/**
 * The same tool set /api/thursday/tool-call executes. Tools without `execute`
 * (`end_call`, `emote`) are included: the model must see them and the page intercepts them.
 */
async function loadToolManifest(webSearch: boolean): Promise<ToolManifest[]> {
  const tools = await loadTools({ target: "thursday", webSearch });

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
 * and what it needs to draw and save the call. `calledBack` is the page placing it
 * for waiting work rather than the user, which changes what she opens with.
 */
export const openCallAction = serverAction(
  async (
    settings: unknown,
    sdp: unknown,
    calledBack?: unknown,
  ): Promise<CallHandshake> => {
    const thursday = LiveSettingsSchema.parse(settings);
    const offer = z.string().min(1).max(SDP_MAX_LENGTH).parse(sdp);
    const apiKey = await readConfig(LIVE_PROVIDER.apiKeyName);
    if (!apiKey) {
      publicError(`No ${LIVE_PROVIDER.label} key — add one in Config.`);
    }

    // A call-back opens on why she called, not on the call before it
    const rang = z.boolean().default(false).parse(calledBack);
    const last = rang ? null : await loadLastCall();

    // Assembled per call, never cached: both prompts read what earlier calls stored.
    const [voice, backend, tools, reasoning, standing, exaKey] =
      await Promise.all([
        loadLivePrompt({
          voicePrompt: thursday.voicePrompt,
          calledBack: rang,
          remembers: last !== null,
        }),
        loadThursdayPrompt(thursday.backendPrompt),
        loadToolManifest(thursday.webSearch),
        acceptedReasoning({
          apiKey,
          model: thursday.backendModel,
          effort: thursday.reasoningEffort,
        }),
        loadCallStanding(),
        readConfig(EXA_API_KEY),
      ]);

    // Connect before insert: a refused key or model must not leave an open row nobody can close.
    // Free-text model ids are not checked here; the provider refuses them and says why.
    const connection = await createLiveCall({
      apiKey,
      sdp: offer,
      voice: thursday.voice,
      instructions: voice.text,
      backend: {
        model: thursday.backendModel,
        instructions: backend,
        tools,
        reasoning,
        // One search, never two: Exa's is in the manifest while its key is set
        // (load-tools), and the backend's own hosted search stands in without one
        hosted: thursday.webSearch && !exaKey ? ["webSearch"] : [],
      },
    });
    const callId = await insertCall({
      provider: LIVE_PROVIDER.id,
      model: LIVE_MODEL,
      backendModel: thursday.backendModel,
    });

    createServerProbe("server")("call.open", {
      callId,
      calledBack,
      opening: voice.opening,
      standing,
      voiceChars: voice.text.length,
      backendChars: backend.length,
      webSearch: thursday.webSearch,
      exa: Boolean(exaKey),
    });
    return {
      callId,
      sdp: connection.transport.sdp,
      last,
      opening: voice.opening,
      standing,
    };
  },
);

/**
 * Opens a call in writing (thursday.text): the row its turns hang off, and what stood
 * open. No connection is made here — the first words are what reach a model — so a key
 * that turns out refused leaves a row with those words in it, which is what happened.
 */
export const openTextCallAction = serverAction(
  async (settings: unknown, runsOn?: unknown): Promise<TextCallHandshake> => {
    const opened = await openTextCall(
      LiveSettingsSchema.parse(settings),
      textModelRefSchema.nullish().parse(runsOn),
    );
    createServerProbe("server")("call.open.text", { callId: opened.callId });
    return opened;
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
  async (callId: unknown, turns: unknown) => {
    await saveTurns(
      z.string().min(1).parse(callId),
      CallTurnSchema.array().min(1).parse(turns),
    );
  },
);

export const saveThoughtAction = serverAction(
  async (callId: unknown, thought: unknown) => {
    await saveThought(
      z.string().min(1).parse(callId),
      CallThoughtSchema.parse(thought),
    );
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
