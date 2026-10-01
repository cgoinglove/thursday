"use server";

import { asSchema } from "ai";
import * as z from "zod";
import { LIVE_CALL } from "@/config";
import { reclaim } from "@/database/db";
import { readChatGptPlan } from "@/features/ai/chatgpt";
import {
  LIVE_LINES,
  LIVE_PROVIDER,
  liveLineOf,
} from "@/features/ai/live.schema";
import { loadTools } from "@/features/ai/load-tools";
import {
  planName,
  TEXT_MODEL_PROVIDERS,
  textModelRefSchema,
} from "@/features/ai/model.schema";
import { loadCallStanding } from "@/features/ai/prompts/call-standing";
import { loadLivePrompt } from "@/features/ai/prompts/live.prompt";
import { loadThursdayPrompt } from "@/features/ai/prompts/thursday.prompt";
import { removeThread } from "@/features/bot/bot.runner";
import { listAllThreadIds } from "@/features/bot/thread.query";
import { EXA_API_KEY } from "@/features/config/config.const";
import {
  hasConfig,
  missingKeyWords,
  readConfig,
} from "@/features/config/config.query";
import { deleteAllNotes } from "@/features/memory/memory.query";
import {
  LIVE_MODEL,
  LIVE_PLAN_MODEL,
  LiveCloseSchema,
  type ToolManifest,
} from "@/lib/live/live.schema";
import { acceptedReasoning, createLiveCall } from "@/lib/live/live.server";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";
import { estimateTokens } from "@/lib/tokens";
import { openPlanLine, planRelayOf } from "./thursday.plan";
import {
  changeLiveSettings,
  deleteCall,
  deleteEndedCalls,
  endCall,
  insertCall,
  readLiveSettings,
  saveThought,
  saveTurns,
  seedLiveSettings,
} from "./thursday.query";
import {
  type CallHandshake,
  CallThoughtSchema,
  CallTurnSchema,
  type TextCallHandshake,
  TextCallNoteSchema,
} from "./thursday.schema";
import { openTextCall, readWhere, tellTextCall } from "./thursday.text";

// Server actions run one at a time per client, so the recording actions stay
// small: a tool call mid-sentence may be queued behind them.

/** An offer with every ICE candidate gathered stays far below this. */
const SDP_MAX_LENGTH = 65_536;

/**
 * The same tool set /api/thursday/tool-call executes. Tools without `execute`
 * (`end_call`, `emote`) are included: the model must see them and the page
 * intercepts them.
 */
async function loadToolManifest(
  opened: CallHandshake["opened"],
): Promise<ToolManifest[]> {
  const tools = await loadTools({ target: "thursday", ...opened });

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
 * for waiting work rather than the user, which changes what she opens with. `where` is where
 * the page found the user and the weather there (where.ts), for both prompts. `here` asks for
 * the opening that greets them with the weather, while the page shows it (here-globe).
 */
export const openCallAction = serverAction(
  async (
    sdp: unknown,
    calledBack?: unknown,
    where?: unknown,
    here?: unknown,
  ): Promise<CallHandshake> => {
    const thursday = await readLiveSettings();
    const offer = z.string().min(1).max(SDP_MAX_LENGTH).parse(sdp);
    const keys = new Map(
      await Promise.all(
        LIVE_LINES.map(async (line) => {
          const key = TEXT_MODEL_PROVIDERS[line].apiKeyName;
          return [key, await hasConfig(key)] as const;
        }),
      ),
    );
    const signedIn = keys.get(TEXT_MODEL_PROVIDERS.chatgpt.apiKeyName) ?? false;
    const plan = signedIn ? await readChatGptPlan() : null;
    const line = liveLineOf(
      thursday.runsOn,
      (key) => keys.get(key) ?? false,
      plan,
    );
    if (!line) {
      // Signed in on a plan without calls: said as that, with the way that opens one
      if (signedIn)
        publicError(
          `Your ${TEXT_MODEL_PROVIDERS.chatgpt.label} is on the ${planName(plan)} plan, which has no spoken calls. Add an ${LIVE_PROVIDER.label} key in Settings › API keys, or sign in with a paid plan. Calls in writing and bots run on it as they are.`,
        );
      publicError(
        // Neither line can open it; one saved but no longer readable is said as that
        await missingKeyWords(
          TEXT_MODEL_PROVIDERS.chatgpt.apiKeyName,
          await missingKeyWords(
            LIVE_PROVIDER.apiKeyName,
            `A spoken call needs a ${TEXT_MODEL_PROVIDERS.chatgpt.label} sign-in or an ${LIVE_PROVIDER.label} key — Settings › API keys.`,
          ),
        ),
      );
    }

    const rang = z.boolean().default(false).parse(calledBack);
    const found = readWhere(where);
    const showing = z.boolean().default(false).parse(here);
    // What the manifest is built from, sent back with the handshake so a tool called
    // later is looked up in this same set (thursday.schema `opened`)
    const opened = {
      webSearch: thursday.webSearch,
      readSkills: thursday.readSkills,
    };

    // Assembled per call, never cached: both prompts read what earlier calls stored.
    const [voice, backend, standing] = await Promise.all([
      loadLivePrompt({
        stylePrompt: thursday.stylePrompt,
        persona: thursday.persona,
        calledBack: rang,
        where: found,
        here: showing,
        plan: line === "chatgpt",
      }),
      loadThursdayPrompt({
        backendPrompt: thursday.backendPrompt,
        readSkills: thursday.readSkills,
        where: found,
      }),
      loadCallStanding(),
    ]);

    // On the plan the app runs her backend itself, and the page follows the call through it
    if (line === "chatgpt") {
      const plan = await openPlanLine({
        sdp: offer,
        voice: { instructions: voice.text, voice: thursday.planVoice },
        settings: thursday,
        backendPrompt: backend,
        opened,
        insertRow: () =>
          insertCall({
            provider: line,
            model: LIVE_PLAN_MODEL,
            backendModel: thursday.backendModel,
          }),
      }).catch((cause) => {
        // Refused, a voice whose instructions run past Live's limit is the likely why: memory
        // the voice reads whole grew past it, and the refusal itself names no reason (10-01)
        const size = estimateTokens(voice.text);
        if (size <= LIVE_CALL.instructionsTokens) throw cause;
        publicError(
          `${cause instanceof Error ? cause.message : String(cause)} What she reads of you comes to about ${size.toLocaleString("en-US")} tokens, past the ${LIVE_CALL.instructionsTokens.toLocaleString("en-US")} a call takes: tidy Profile and Preferences in Settings › Memory, then call again.`,
        );
      });
      return {
        callId: plan.callId,
        sdp: plan.sdp,
        opening: voice.opening,
        here: voice.here,
        standing,
        opened,
        relay: planRelayOf(plan.callId),
      };
    }

    const apiKey = await readConfig(LIVE_PROVIDER.apiKeyName);
    if (!apiKey) {
      publicError(
        `No ${LIVE_PROVIDER.label} key — add one in Settings › API keys.`,
      );
    }
    const [tools, reasoning, exaKey] = await Promise.all([
      loadToolManifest(opened),
      acceptedReasoning({
        apiKey,
        model: thursday.backendModel,
        effort: thursday.reasoningEffort,
      }),
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
    return {
      callId,
      sdp: connection.transport.sdp,
      opening: voice.opening,
      here: voice.here,
      standing,
      opened,
      relay: null,
    };
  },
);

/**
 * Opens a call in writing (thursday.text): the row its turns hang off, and what stood
 * open. No connection is made here — the first words are what reach a model — so a key
 * that turns out refused leaves a row with those words in it, which is what happened.
 */
export const openTextCallAction = serverAction(
  async (runsOn?: unknown): Promise<TextCallHandshake> =>
    openTextCall(textModelRefSchema.nullish().parse(runsOn)),
);

/**
 * Words written, or a fact for a bot's update, while she is answering in writing: they join
 * that answer before her next step (thursday.text). What she did not read by its end — too
 * late, refused (false), or queued behind another action — the page carries into the next turn.
 */
export const tellTextCallAction = serverAction(
  async (callId: unknown, turn: unknown, note: unknown): Promise<boolean> =>
    tellTextCall(
      z.string().min(1).parse(callId),
      z.string().min(1).parse(turn),
      TextCallNoteSchema.parse(note),
    ),
);

/**
 * Settings › Thursday: the fields a screen changed (thursday.query changeLiveSettings).
 * Nothing is cached: the next call builds its prompts and its tool set from this
 * (ai/load-tools, prompts/thursday.prompt).
 */
export const setLiveSettingsAction = serverAction(async (change: unknown) =>
  changeLiveSettings(z.record(z.string(), z.unknown()).parse(change)),
);

/**
 * The copy a browser kept before these moved to the server, offered once on load. It is
 * taken only while no row exists, so a second browser — or the same one opened again —
 * cannot put its own back over what is kept.
 */
export const seedLiveSettingsAction = serverAction(async (settings: unknown) =>
  // Not parsed here: the seed migrates what it is given, since a browser that has not been
  // opened in a while names its fields as an older version did (thursday.query)
  seedLiveSettings(settings),
);

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
export const deleteCallAction = serverAction(async (callId: unknown) => {
  if (!(await deleteCall(z.string().min(1).parse(callId)))) {
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

  // The rows are gone; this is what gives their space back (database/db)
  await reclaim();

  return { calls, threads: threadIds.length, notes };
});
