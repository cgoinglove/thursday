"use server";

import { asSchema } from "ai";
import { loadTools } from "@/features/ai/load-tools";
import {
  SPEACH_MODEL_PROVIDER_LIST,
  SPEACH_MODEL_PROVIDERS,
  type SpeachModelRef,
} from "@/features/ai/model.schema";
import { loadThursdayPrompt } from "@/features/ai/prompts/thursday.prompt";
import { readConfig } from "@/features/config/config.query";
import { scheduleTidy } from "@/features/memory/memory.tidy";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";
import { issueClientSecret } from "@/lib/realtime/client-secret";
import type { ToolManifest } from "@/lib/realtime/realtime.schema";
import { deleteCall, endCall, insertCall, saveTurns } from "./thursday.query";
import {
  type CallHandshake,
  CallTurnSchema,
  type ThursdaySettings,
  ThursdaySettingsSchema,
} from "./thursday.schema";

// Server actions run one at a time per client, so the recording actions stay
// small: a tool call mid-sentence may be queued behind them.

/** The picked model if its key still exists, else the first provider with a key. */
async function resolveVoiceModel(
  picked: ThursdaySettings["model"],
): Promise<SpeachModelRef> {
  if (
    picked &&
    (await readConfig(SPEACH_MODEL_PROVIDERS[picked.provider].apiKeyName))
  ) {
    return picked;
  }

  // Voice and model ids are provider-specific, so neither carries over.
  for (const provider of SPEACH_MODEL_PROVIDER_LIST) {
    if (await readConfig(provider.apiKeyName)) {
      return { provider: provider.id, voice: null, model: null };
    }
  }
  publicError("No voice key — calls run on one. Add one in Config.");
}

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
 * Opens a call: inserts the row and returns the credential plus what to send
 * once connected. Settings live in the browser (thursday.store), so they arrive
 * as an argument and are parsed, not trusted.
 */
export const openCallAction = serverAction(
  async (settings: ThursdaySettings): Promise<CallHandshake> => {
    const thursday = ThursdaySettingsSchema.parse(settings);

    const ref = await resolveVoiceModel(thursday.model);
    const provider = SPEACH_MODEL_PROVIDERS[ref.provider];
    const apiKey = await readConfig(provider.apiKeyName);
    if (!apiKey) publicError(`No ${provider.label} key — add one in Config.`);

    // Assembled per call, never cached: the prompt reads what earlier calls stored.
    const [prompt, tools] = await Promise.all([
      loadThursdayPrompt(thursday.systemPrompt, thursday.locale),
      loadToolManifest(),
    ]);

    // Free-text model ids are not validated here; the provider rejects at issue time.
    const model = ref.model ?? provider.models[0].id;
    // Issue before insert: a rejected credential must not leave an open call row
    // nobody can close.
    const credential = await issueClientSecret({
      provider: ref.provider,
      apiKey,
      model,
    });
    const callId = await insertCall({ provider: ref.provider, model });

    return {
      callId,
      provider: ref.provider,
      credential,
      session: {
        model,
        voice: ref.voice ?? provider.defaultVoice,
        instructions: prompt.text,
        tools,
      },
      opening: prompt.opening,
    };
  },
);

export const saveTurnsAction = serverAction(
  async (callId: string, turns: unknown) => {
    await saveTurns(callId, CallTurnSchema.array().min(1).parse(turns));
  },
);

export const endCallAction = serverAction(async (callId: string) => {
  if (await endCall(callId)) scheduleTidy();
});

/**
 * Deletes a call and its turns; the next call's prompt no longer includes it.
 * The query refuses a call still in progress.
 */
export const deleteCallAction = serverAction(async (callId: string) => {
  if (!(await deleteCall(callId))) {
    publicError("That call is still on the line — hang up first.");
  }
});
