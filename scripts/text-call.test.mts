import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import {
  APICallError,
  readUIMessageStream,
  simulateReadableStream,
  type UIMessage,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";

// A held turn of a call in writing — the real prompt, tools and rows — over an empty
// home, with a model that is only a script: what joins the turn between two of her steps,
// where it sits in what is carried on, and which rows it leaves.
const home = await mkdtemp(join(tmpdir(), "thursday-text-call-"));
process.env.THURSDAY_HOME = home;
process.env.THURSDAY_SKIP_BROWSER = "1";

const prompts: string[] = [];
/** The tools each step was handed, by name. */
const held: string[][] = [];
const systems: string[] = [];
const steps: (() => Record<string, unknown>[])[] = [];
const usage = {
  inputTokens: {
    total: 100,
    noCache: 100,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};
const model = new MockLanguageModelV4({
  // A page's turn streams: the same script, its words sent as a stream
  doStream: async ({ prompt, abortSignal }) => {
    prompts.push(JSON.stringify(prompt));
    const next = steps.shift();
    assert.ok(next, "Unexpected step");
    const content = next();
    // A model that goes quiet partway: what comes before `stall` is sent, and nothing after
    // until the request is aborted, which ends it as a fetch's body ends
    if (content.at(-1)?.type === "stall")
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of content.slice(0, -1)) controller.enqueue(part);
            abortSignal?.addEventListener("abort", () =>
              controller.error(abortSignal.reason),
            );
          },
        }) as never,
      };
    return {
      stream: simulateReadableStream({
        initialDelayInMs: null,
        chunkDelayInMs: null,
        chunks: [
          ...content.flatMap((part) =>
            part.type === "text"
              ? [
                  { type: "text-start", id: "text" },
                  { type: "text-delta", id: "text", delta: part.text },
                  { type: "text-end", id: "text" },
                ]
              : [part],
          ),
          {
            type: "finish",
            finishReason: {
              unified: content.some((part) => part.type === "tool-call")
                ? "tool-calls"
                : "stop",
              raw: undefined,
            },
            usage,
          },
        ] as never[],
      }),
    };
  },
  doGenerate: async ({ prompt, tools }) => {
    prompts.push(JSON.stringify(prompt));
    held.push((tools ?? []).map((tool) => tool.name));
    systems.push(
      prompt
        .flatMap((message) =>
          message.role === "system" ? [String(message.content)] : [],
        )
        .join("\n"),
    );
    const next = steps.shift();
    assert.ok(next, "Unexpected step");
    const content = next();
    return {
      content: content as never,
      finishReason: {
        unified: content.some((part) => part.type === "tool-call")
          ? "tool-calls"
          : "stop",
        raw: undefined,
      },
      usage: {
        inputTokens: {
          total: 100,
          noCache: 100,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    };
  },
});
/** Which provider each turn's model was built for, in order. */
const builtFor: string[] = [];
const realModel = await import("../features/ai/model.ts");
mock.module("../features/ai/model.ts", {
  namedExports: {
    ...realModel,
    getTextModel: async (ref: { provider?: string; model?: string }) => {
      // A pick that cannot be run: refused before anything of the turn is kept
      if (ref.model === "refused") throw new Error("No key for that model.");
      builtFor.push(String(ref.provider));
      return { ref, model, searchTools: null };
    },
  },
});

/** The GPT subscription's refusal once the plan is spent, as ai/chatgpt words it. */
const planSpent = () =>
  new APICallError({
    message:
      "GPT Subscription usage limit reached on the plus plan. It resets in 3 hours.",
    url: "https://chatgpt.com/backend-api/codex/responses",
    requestBodyValues: {},
    statusCode: 402,
    responseBody: JSON.stringify({
      error: {
        message:
          "GPT Subscription usage limit reached on the plus plan. It resets in 3 hours.",
        code: "usage_limit_reached",
      },
    }),
    isRetryable: false,
  });
const realLive = await import("../lib/live/live.server.ts");
mock.module("../lib/live/live.server.ts", {
  // Asked of the provider over the network; nothing here depends on the answer
  namedExports: { ...realLive, acceptedReasoning: async () => null },
});

const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { readConfig, removeConfig, writeConfig } = await import(
  "../features/config/config.query.ts"
);
const { LIVE_PROVIDER, LiveSettingsSchema } = await import(
  "../features/ai/live.schema.ts"
);
await writeConfig(LIVE_PROVIDER.apiKeyName, "sk-test");
const { TOOL_NAMES } = await import("../features/ai/tools/tool-name.ts");
const { answerInWriting, openTextCall, streamTextCall, tellTextCall } =
  await import("../features/thursday/thursday.text.ts");
const {
  isCallOpen,
  listRecentTurns,
  changeLiveSettings,
  readLiveSettings,
  seedLiveSettings,
  sweepCalls,
  writeLiveSettings,
} = await import("../features/thursday/thursday.query.ts");
const { THURSDAY_KEYS } = await import(
  "../features/thursday/thursday.schema.ts"
);

after(async () => {
  await rm(home, { recursive: true, force: true });
});

test("what arrives while she works joins the turn between her steps, and keeps its place", async () => {
  const { callId } = await openTextCall();
  steps.push(
    () => [
      {
        type: "tool-call",
        toolCallId: "t-1",
        toolName: TOOL_NAMES.thread_status,
        input: JSON.stringify({ thread: "all" }),
      },
    ],
    () => [{ type: "text", text: "Nothing has been started yet." }],
  );
  const waiting = [
    { text: "the OpenAI one", said: true },
    { text: "[Jarvis → Thursday, a fact.]", said: false },
  ];
  const result = await answerInWriting({
    callId,
    standing: "What stood open as the call began.",
    messages: [{ role: "user", content: "check the credit" }],
    said: "check the credit",
    notes: () => waiting.splice(0),
  });

  assert.equal(result.text, "Nothing has been started yet.");
  assert.equal(prompts.length, 2);
  assert.ok(
    !prompts[0].includes("the OpenAI one"),
    "not before her first step",
  );
  assert.ok(
    prompts[1].indexOf("the OpenAI one") > prompts[1].indexOf("tool-result"),
    "after what the tool answered, before her next step",
  );

  // What is carried on: the conversation alone, in the order it was said
  assert.deepEqual(
    result.messages.map((message) => message.role),
    ["user", "assistant", "tool", "user", "user", "assistant"],
  );
  assert.equal(result.messages[0].content, "check the credit");
  assert.equal(result.messages[3].content, "the OpenAI one");

  // Held for someone on a phone: nothing of hers can land on a screen in front of them
  assert.ok(held[0].includes(TOOL_NAMES.thread_status));
  assert.ok(!held[0].includes(TOOL_NAMES.thread_show));
  assert.ok(!systems[0].includes(TOOL_NAMES.thread_show));
  assert.match(systems[0], /name its files by their path in your answer/);

  // Their words are turns of theirs; a fact is no turn of its own
  const rows =
    (await listRecentTurns(200)).find((call) => call.callId === callId)
      ?.turns ?? [];
  assert.deepEqual(
    rows.map((row) => [row.role, row.text.slice(0, 20)]),
    [
      ["user", "check the credit"],
      ["tool", JSON.stringify({ thread: "all" }).slice(0, 20)],
      ["user", "the OpenAI one"],
      ["assistant", "Nothing has been sta"],
    ],
  );
});

/** A page's turn read to its end: the chunks it streamed, in order. */
async function pageTurn(body: Record<string, unknown>) {
  const response = await streamTextCall(body, new AbortController().signal);
  const sent = await response.text();
  assert.equal(response.status, 200, sent);
  return sent
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

/** Her answer as the page holds it once the stream is over. */
async function answerOf(chunks: Record<string, unknown>[]): Promise<UIMessage> {
  let message: UIMessage | undefined;
  for await (const snapshot of readUIMessageStream({
    stream: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk as never);
        controller.close();
      },
    }),
  }))
    message = snapshot;
  assert.ok(message);
  return message;
}

const words = (id: string, text: string) => ({
  id,
  role: "user" as const,
  parts: [{ type: "text" as const, text }],
});

/** One call's rows as the history keeps them: whose, and how they open. */
const rowsOf = async (callId: string) =>
  (
    (await listRecentTurns(200)).find((call) => call.callId === callId)
      ?.turns ?? []
  ).map((row) => [row.role, row.text.slice(0, 20)]);

/** What the model was last sent as the user's, in order. */
const usersSaid = () =>
  (JSON.parse(prompts.at(-1) ?? "[]") as { role: string; content: unknown }[])
    .filter((message) => message.role === "user")
    .map((message) => JSON.stringify(message.content));

test("words written while she answers join before her next step, come back ahead of it, and stay where she read them", async () => {
  const { callId } = await openTextCall();
  const from = prompts.length;
  const note = { id: "note-1", text: "the business account", said: true };
  steps.push(
    () => {
      // Written while her first step runs
      assert.equal(tellTextCall(callId, "turn-1", note), true);
      // Another call's answer is not this one's
      assert.equal(tellTextCall("another-call", "turn-1", note), false);
      return [
        {
          type: "tool-call",
          toolCallId: "p-1",
          toolName: TOOL_NAMES.thread_status,
          input: JSON.stringify({ thread: "all" }),
        },
      ];
    },
    () => [{ type: "text", text: "Nothing has been started yet." }],
  );
  const asked = words("u-1", "check the credit");
  const chunks = await pageTurn({ callId, turn: "turn-1", messages: [asked] });

  assert.ok(
    !prompts[from].includes("the business account"),
    "not before step one",
  );
  assert.ok(
    prompts[from + 1].indexOf("the business account") >
      prompts[from + 1].indexOf("tool-result"),
    "after what the tool answered, before her next step",
  );

  // Told back ahead of the step that read it, never inside the one before
  const types = chunks.map((chunk) => chunk.type);
  const second = types.indexOf("start-step", types.indexOf("start-step") + 1);
  assert.deepEqual(chunks[second - 1], {
    type: "data-note",
    id: "note-1",
    data: note,
  });

  // Over: what is told now waits for the next turn instead
  assert.equal(tellTextCall(callId, "turn-1", note), false);

  // Their words are a turn of theirs, in the order they came
  assert.deepEqual(await rowsOf(callId), [
    ["user", "check the credit"],
    ["tool", JSON.stringify({ thread: "all" }).slice(0, 20)],
    ["user", "the business account"],
    ["assistant", "Nothing has been sta"],
  ]);

  // Sent with the next turn, the note sits where she read it: after the tool's answer,
  // before the words she wrote after it, and it is not kept a second time
  const answer = await answerOf(chunks);
  steps.push(() => [{ type: "text", text: "Done." }]);
  await pageTurn({
    callId,
    turn: "turn-2",
    messages: [asked, answer, words("u-2", "and the other one")],
  });
  assert.deepEqual(
    (JSON.parse(prompts.at(-1) ?? "[]") as { role: string }[])
      .map((message) => message.role)
      .filter((role) => role !== "system"),
    ["user", "assistant", "tool", "user", "assistant", "user"],
  );
  assert.deepEqual((await rowsOf(callId)).slice(4), [
    ["user", "and the other one"],
    ["assistant", "Done."],
  ]);
});

test("a fact for a bot's update goes ahead of the words it waited with, is no turn of its own, and nothing sent again is kept twice", async () => {
  const { callId } = await openTextCall();
  const fact = {
    id: "fact-1",
    text: '[Jarvis → Thursday, thread "Credits" (t-1), question.]\nSign in to the platform, then say so.',
    said: false,
  };
  const late = {
    id: "note-2",
    text: "not that account, the other one",
    said: true,
  };
  const sent = {
    id: "u-3",
    role: "user" as const,
    parts: [
      { type: "data-note", id: fact.id, data: fact },
      { type: "data-note", id: late.id, data: late },
      { type: "text", text: "go ahead now" },
    ],
  };
  steps.push(() => [{ type: "text", text: "Alright." }]);
  await pageTurn({ callId, turn: "turn-3", messages: [sent] });
  const order = usersSaid();
  const at = (text: string) => order.findIndex((one) => one.includes(text));
  assert.ok(at("Sign in to the platform") >= 0);
  assert.ok(at("Sign in to the platform") < at("not that account"));
  assert.ok(at("not that account") < at("go ahead now"));
  assert.deepEqual(await rowsOf(callId), [
    ["user", "not that account, th"],
    ["user", "go ahead now"],
    ["assistant", "Alright."],
  ]);

  // Sent again whole, as Send it again does: the same ids, so the same rows
  steps.push(() => [{ type: "text", text: "Alright." }]);
  await pageTurn({ callId, turn: "turn-4", messages: [sent] });
  assert.deepEqual(
    (await rowsOf(callId)).filter(([role]) => role === "user"),
    [
      ["user", "not that account, th"],
      ["user", "go ahead now"],
    ],
  );
});

test("an answer that broke carries on from the last tool it finished: nothing runs twice, and nothing is kept twice", async () => {
  const { callId } = await openTextCall();
  steps.push(
    () => [
      {
        type: "tool-call",
        toolCallId: "b-1",
        toolName: TOOL_NAMES.thread_status,
        input: JSON.stringify({ thread: "all" }),
      },
    ],
    () => {
      throw new Error("The plan's limit was reached.");
    },
  );
  const asked = words("u-4", "is anything running?");
  const chunks = await pageTurn({ callId, turn: "turn-5", messages: [asked] });
  assert.ok(chunks.some((chunk) => chunk.type === "error"));
  const broken = await answerOf(chunks);
  // As Send it again leaves it: up to the last tool the answer finished
  const through = broken.parts.findLastIndex(
    (part) => part.type.startsWith("tool-") && "output" in part,
  );
  assert.ok(through >= 0);
  const kept = { ...broken, parts: broken.parts.slice(0, through + 1) };

  const from = prompts.length;
  steps.push(() => [{ type: "text", text: "Nothing is running yet." }]);
  await pageTurn({ callId, turn: "turn-6", messages: [asked, kept] });
  // One step, on from what the tool answered: the tool is not asked again
  assert.equal(prompts.length, from + 1);
  assert.equal(
    (JSON.parse(prompts[from]) as { role: string }[]).at(-1)?.role,
    "tool",
  );
  assert.deepEqual(await rowsOf(callId), [
    ["user", "is anything running?"],
    ["tool", JSON.stringify({ thread: "all" }).slice(0, 20)],
    ["assistant", "Nothing is running y"],
  ]);
});

test("a model that goes quiet partway through a turn ends it with an error after TEXT_CALL.chunkMs, rather than holding it open", async () => {
  const { TEXT_CALL } = await import("../config.ts");
  const was = TEXT_CALL.chunkMs;
  TEXT_CALL.chunkMs = 300;
  try {
    const { callId } = await openTextCall();
    // As seen: "Handing this to Analyst" was drawn from the tool's input, and nothing came after
    steps.push(() => [
      {
        type: "tool-input-start",
        id: "q-1",
        toolName: TOOL_NAMES.thread_start,
      },
      { type: "tool-input-delta", id: "q-1", delta: '{"bot":"Analyst"' },
      { type: "stall" },
    ]);
    const started = Date.now();
    const chunks = await pageTurn({
      callId,
      turn: "turn-quiet",
      messages: [
        words("u-quiet", "What's the weather like in Lisbon right now?"),
      ],
    });
    // Said as a failure, which the page shows with Send it again; an abort it reads as its own stop
    const failed = chunks.find((chunk) => chunk.type === "error");
    assert.match(String(failed?.errorText), /No answer came for 0 seconds/);
    assert.ok(!chunks.some((chunk) => chunk.type === "abort"));
    assert.ok(Date.now() - started < 5_000);
  } finally {
    TEXT_CALL.chunkMs = was;
  }
});

test("words a broken turn never kept are kept with the next turn, once", async () => {
  const { callId } = await openTextCall();
  const first = words("u-5", "what time is it in Lisbon?");
  const refused = await streamTextCall(
    {
      callId,
      turn: "turn-7",
      runsOn: { provider: "openai", model: "refused" },
      messages: [first],
    },
    new AbortController().signal,
  );
  assert.equal(refused.status, 500);
  assert.deepEqual(await rowsOf(callId), []);

  steps.push(() => [{ type: "text", text: "Both, then." }]);
  await pageTurn({
    callId,
    turn: "turn-8",
    messages: [first, words("u-6", "and in Lima")],
  });
  assert.deepEqual(await rowsOf(callId), [
    ["user", "what time is it in L"],
    ["user", "and in Lima"],
    ["assistant", "Both, then."],
  ]);
});

/** A provider turning down the key itself, as the sdk wraps it: a 401 (ai/model isKeyRefused). */
const keyRefused = (statusCode = 401) =>
  new APICallError({
    message: "Incorrect API key provided: sk-ab******cd.",
    url: "https://api.openai.com/v1/responses",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });

test("a refused key is named to the page just ahead of its error, and nothing else is", async () => {
  const { callId } = await openTextCall();
  builtFor.length = 0;
  steps.push(() => {
    throw keyRefused();
  });
  const chunks = await pageTurn({
    callId,
    turn: "turn-refused",
    messages: [words("u-r1", "what is on today?")],
  });
  const at = chunks.findIndex((chunk) => chunk.type === "error");
  assert.ok(at > 0);
  assert.deepEqual(chunks[at - 1], {
    type: "data-refused",
    data: { provider: builtFor.at(-1) },
    transient: true,
  });

  // A 403 is a model or a region the account may not use: said as it came, no Settings
  steps.push(() => {
    throw keyRefused(403);
  });
  const denied = await pageTurn({
    callId,
    turn: "turn-denied",
    messages: [words("u-r2", "and tomorrow?")],
  });
  assert.ok(denied.some((chunk) => chunk.type === "error"));
  assert.ok(!denied.some((chunk) => chunk.type === "data-refused"));
});

test("a call in writing reads its own words as the conversation, never again as an earlier call", async () => {
  const { callId } = await openTextCall();
  const first = words("u-7", "the harbour at dawn");
  steps.push(() => [{ type: "text", text: "Lovely." }]);
  await pageTurn({ callId, turn: "turn-9", messages: [first] });
  steps.push(() => [{ type: "text", text: "Sure." }]);
  await pageTurn({
    callId,
    turn: "turn-10",
    messages: [first, words("u-8", "and at night")],
  });
  const system = (
    JSON.parse(prompts.at(-1) ?? "[]") as { role: string; content: unknown }[]
  )
    .filter((message) => message.role === "system")
    .map((message) => String(message.content))
    .join("\n");
  assert.match(system, /## Memory/);
  assert.doesNotMatch(system, /harbour at dawn/);
});

test("where the page found them reaches her prompt, and a malformed one is dropped, never failing the turn", async () => {
  const { callId } = await openTextCall();
  const systemOf = () =>
    (JSON.parse(prompts.at(-1) ?? "[]") as { role: string; content: unknown }[])
      .filter((message) => message.role === "system")
      .map((message) => String(message.content))
      .join("\n");
  const weather = {
    code: 3,
    temperature: 21.3,
    low: 21,
    high: 28.1,
    sunrise: "07:28",
    sunset: "19:25",
  };
  const asked = words("u-w1", "what should I wear");
  steps.push(() => [{ type: "text", text: "A light jacket." }]);
  await pageTurn({
    callId,
    turn: "turn-w1",
    messages: [asked],
    where: { place: "Lisbon, Portugal", weather },
  });
  assert.match(
    systemOf(),
    /\*\*Where they are\*\*: Lisbon, Portugal — overcast, 21°C/,
  );

  // A service that sent a null: the turn is answered as if nothing were sent
  steps.push(() => [{ type: "text", text: "Still a jacket." }]);
  await pageTurn({
    callId,
    turn: "turn-w2",
    messages: [asked, words("u-w2", "and tonight")],
    where: { place: "Lisbon, Portugal", weather: { ...weather, low: null } },
  });
  assert.doesNotMatch(systemOf(), /Where they are/);
});

test("a closing tab's beacon ends the call it held", async () => {
  const { POST } = await import("../app/api/thursday/call/end/route.ts");
  const { callId } = await openTextCall();
  assert.equal(await isCallOpen(callId), true);
  const response = await POST(
    new Request("http://127.0.0.1:3000/api/thursday/call/end", {
      method: "POST",
      body: callId,
    }),
    {} as never,
  );
  assert.equal(response.status, 200);
  assert.equal(await isCallOpen(callId), false);
});

test("the last tab going closes the calls a tab held, never one the server holds for a phone", async () => {
  const page = (await openTextCall()).callId;
  const phone = (await openTextCall()).callId;
  await sweepCalls([phone]);
  assert.equal(await isCallOpen(page), false);
  assert.equal(await isCallOpen(phone), true);
  // At boot nothing is held: what the last process left open is closed
  await sweepCalls();
  assert.equal(await isCallOpen(phone), false);
});

// The settings every entrance reads, and the one path that runs once per install: what a
// browser kept before they moved here, and the switch that was a row of its own.
test("the kept settings take a browser's copy once, keep only what differs from the defaults, and read the old skills row until a row exists", async () => {
  const { LIVE_DEFAULTS } = await import("../features/ai/live.schema.ts");
  // Nothing kept: the defaults, and the switch as its own row left it
  assert.equal((await readLiveSettings()).persona, LIVE_DEFAULTS.persona);
  assert.equal((await readLiveSettings()).readSkills, false);
  await writeConfig(THURSDAY_KEYS.wasSkills, "on");
  assert.equal((await readLiveSettings()).readSkills, true);

  // A browser's own copy, in the shape it kept it: `voicePrompt` is what the style was
  // called while only the voice read it, and the old switch is where `readSkills` starts
  const carried = {
    voice: "cedar",
    persona: "calm",
    voicePrompt: "Quieter.",
    captionView: "sides",
    backendModel: "gpt-5.6-luna",
  };
  assert.equal(await seedLiveSettings(carried), true);
  const kept = await readLiveSettings();
  assert.equal(kept.voice, "cedar");
  assert.equal(kept.persona, "calm");
  assert.equal(kept.stylePrompt, "Quieter.");
  // The backend its browser defaulted to, which nobody picked, follows the app's
  assert.equal(kept.backendModel, LIVE_DEFAULTS.backendModel);
  // No browser ever held the switch, so it comes from the row it had of its own
  assert.equal(kept.readSkills, true);
  // Not a field of theirs, so it never reaches the row
  assert.equal("captionView" in kept, false);

  // A second browser, opened later, cannot put its own over what is kept
  assert.equal(
    await seedLiveSettings({ voice: "marin", persona: "rough" }),
    false,
  );
  assert.equal((await readLiveSettings()).persona, "calm");

  // Sent whole, so a field left out goes back to its default rather than lingering
  await writeLiveSettings(LiveSettingsSchema.parse({ persona: "rough" }));
  const now = await readLiveSettings();
  assert.equal(now.persona, "rough");
  assert.equal(now.voice, LIVE_DEFAULTS.voice);
  assert.equal(now.stylePrompt, "");
  // Switched off, which is the default: the row it had of its own must not switch it on
  assert.equal(now.readSkills, false);

  // Only what differs from the defaults is kept, so a default nobody picked moves with
  // the app when it changes — the backend model a release replaces, for one
  const kept2 = JSON.parse((await readConfig(THURSDAY_KEYS.settings)) ?? "{}");
  assert.deepEqual(kept2, { persona: "rough" });
  await writeLiveSettings(
    LiveSettingsSchema.parse({
      persona: "rough",
      backendModel: "gpt-older-luna",
      reasoningEffort: null,
    }),
  );
  assert.deepEqual(
    JSON.parse((await readConfig(THURSDAY_KEYS.settings)) ?? "{}"),
    { persona: "rough", backendModel: "gpt-older-luna", reasoningEffort: null },
  );
  // Picking the default again lets go of the old one
  await writeLiveSettings(LiveSettingsSchema.parse({ persona: "rough" }));
  assert.equal(
    (await readLiveSettings()).backendModel,
    LIVE_DEFAULTS.backendModel,
  );

  // A row already seeded with a browser's default backend reads as unpicked too
  await writeConfig(
    THURSDAY_KEYS.settings,
    JSON.stringify({ persona: "rough", backendModel: "gpt-5.6-luna" }),
  );
  assert.equal(
    (await readLiveSettings()).backendModel,
    LIVE_DEFAULTS.backendModel,
  );

  // What a screen changes goes alone and lands on what is kept: a style typed, then a
  // switch flipped before the first came back, keeps both
  await changeLiveSettings({ stylePrompt: "Short answers." });
  await changeLiveSettings({ webSearch: false });
  const both = await readLiveSettings();
  assert.equal(both.stylePrompt, "Short answers.");
  assert.equal(both.webSearch, false);
  assert.equal(both.persona, "rough");
  await assert.rejects(changeLiveSettings({ persona: "" }));

  // A character since retired is read as the closest of the four, not reset to the default
  await writeConfig(
    THURSDAY_KEYS.settings,
    JSON.stringify({ persona: "steady" }),
  );
  assert.equal((await readLiveSettings()).persona, "calm");
});

// A spent GPT plan: the turn moves onto the OpenAI key before anything of it ran, and says so
const onPlan = { provider: "chatgpt", model: "gpt-6-luna" };

test("a phone's turn the spent plan refuses is answered on the OpenAI key, and says so", async () => {
  await writeConfig("CHATGPT_SIGN_IN", "{}");
  try {
    const { callId } = await openTextCall();
    builtFor.length = 0;
    steps.push(
      () => {
        throw planSpent();
      },
      () => [{ type: "text", text: "It is noon in Lisbon." }],
    );
    const result = await answerInWriting({
      callId,
      standing: null,
      messages: [{ role: "user", content: "what time is it in Lisbon?" }],
      said: "what time is it in Lisbon?",
    });
    assert.deepEqual(builtFor, ["chatgpt", "openai"]);
    assert.equal(result.text, "It is noon in Lisbon.");
    assert.match(
      result.moved ?? "",
      /^GPT Subscription usage limit reached on the plus plan\. It resets in 3 hours\. Answering on your OpenAI key \(6 Luna\)/,
    );
    // Their words are kept once, and her answer after them
    assert.deepEqual(await rowsOf(callId), [
      ["user", "what time is it in L"],
      ["assistant", "It is noon in Lisbon"],
    ]);

    // Any other refusal is not moved: it reaches them as it was said
    steps.push(() => {
      throw new Error("The provider said no.");
    });
    await assert.rejects(
      answerInWriting({
        callId,
        standing: null,
        messages: [{ role: "user", content: "and in Lima?" }],
        said: "and in Lima?",
      }),
      /The provider said no\./,
    );
  } finally {
    await removeConfig("CHATGPT_SIGN_IN");
  }
});

test("a spent plan with no key, or refused partway through a turn, says what the user can do and runs nothing twice", async () => {
  await writeConfig("CHATGPT_SIGN_IN", "{}");
  await removeConfig(LIVE_PROVIDER.apiKeyName);
  try {
    const { callId } = await openTextCall();
    steps.push(() => {
      throw planSpent();
    });
    await assert.rejects(
      answerInWriting({
        callId,
        standing: null,
        messages: [{ role: "user", content: "hello" }],
        said: "hello",
      }),
      /resets in 3 hours\. With an OpenAI key in Settings › API keys, she answers on it until then\./,
    );

    // With the key, but after a tool already ran: the tool is not run again on the key
    await writeConfig(LIVE_PROVIDER.apiKeyName, "sk-test");
    builtFor.length = 0;
    steps.push(
      () => [
        {
          type: "tool-call",
          toolCallId: "s-1",
          toolName: TOOL_NAMES.thread_status,
          input: JSON.stringify({ thread: "all" }),
        },
      ],
      () => {
        throw planSpent();
      },
    );
    await assert.rejects(
      answerInWriting({
        callId,
        standing: null,
        messages: [{ role: "user", content: "anything running?" }],
        said: "anything running?",
      }),
      /Write again and she answers on your OpenAI key\./,
    );
    assert.deepEqual(builtFor, ["chatgpt"]);
    assert.equal(steps.length, 0);
  } finally {
    await writeConfig(LIVE_PROVIDER.apiKeyName, "sk-test");
    await removeConfig("CHATGPT_SIGN_IN");
  }
});

test("a page's turn the spent plan refuses streams on the OpenAI key, tells the page once, and keeps what it had read", async () => {
  const { callId } = await openTextCall();
  builtFor.length = 0;
  const note = { id: "note-m", text: "the other account", said: true };
  steps.push(
    () => {
      throw planSpent();
    },
    () => [{ type: "text", text: "Done on the key." }],
  );
  // Written before her first step: the step on the key reads it
  const response = streamTextCall(
    { callId, turn: "turn-m", runsOn: onPlan, messages: [words("u-m", "go")] },
    new AbortController().signal,
  );
  tellTextCall(callId, "turn-m", note);
  const sent = await (await response).text();
  const chunks = sent
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);

  assert.deepEqual(builtFor, ["chatgpt", "openai"]);
  assert.ok(!chunks.some((chunk) => chunk.type === "error"), sent);
  assert.equal(chunks.filter((chunk) => chunk.type === "start").length, 1);
  const moved = chunks.filter((chunk) => chunk.type === "data-moved");
  assert.equal(moved.length, 1);
  assert.equal(moved[0].transient, true);
  assert.match(
    String((moved[0].data as { why: string }).why),
    /usage limit reached/,
  );
  const answer = await answerOf(chunks);
  assert.ok(
    answer.parts.some(
      (part) => part.type === "text" && part.text === "Done on the key.",
    ),
  );
  assert.ok(prompts.at(-1)?.includes("the other account"));
  assert.deepEqual(await rowsOf(callId), [
    ["user", "go"],
    ["user", "the other account"],
    ["assistant", "Done on the key."],
  ]);
});

/** The smallest PNG there is: its signature, as a picture's bytes. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Puts pictures in the workspace's inbox, as the write line and a phone keep them. */
async function inboxWith(files: Record<string, Buffer>) {
  const { PATHS } = await import("../config.ts");
  const inbox = join(home, PATHS.workspace, "inbox");
  await mkdir(inbox, { recursive: true });
  for (const [name, bytes] of Object.entries(files))
    await writeFile(join(inbox, name), bytes);
}

/** The parts of the last message of theirs the model was sent: a picture as `file:<type>`, words as they are. */
const lastUserParts = () => {
  const sent = JSON.parse(prompts.at(-1) ?? "[]") as {
    role: string;
    content: { type: string; text?: string; mediaType?: string }[];
  }[];
  const user = sent.findLast((message) => message.role === "user");
  assert.ok(user);
  return user.content.map((part) =>
    part.type === "file" ? `file:${part.mediaType}` : String(part.text),
  );
};

test("a page's pictures go into the message they were sent with, as pictures, and say why where one cannot", async () => {
  const { LOOK } = await import("../config.ts");
  await inboxWith({
    "photo.png": PNG,
    "huge.png": Buffer.alloc(LOOK.maxBytes + 1),
  });
  const picture = (name: string, url = `/api/file/inbox/${name}`) => ({
    type: "file" as const,
    mediaType: "image/png",
    url,
    filename: name,
  });
  const { callId } = await openTextCall();
  const asked = {
    id: "u-pictures",
    role: "user" as const,
    parts: [
      { type: "text" as const, text: "What is this?" },
      picture("photo.png"),
      picture("huge.png"),
      picture("gone.png"),
      picture("elsewhere.png", "https://example.com/elsewhere.png"),
      picture("up.png", "/api/file/../up.png"),
    ],
  };
  steps.push(() => [{ type: "text", text: "A lighthouse." }]);
  const answer = await answerOf(
    await pageTurn({ callId, turn: "turn-pictures", messages: [asked] }),
  );
  const parts = lastUserParts();
  // Each picture after the line that names it, so several are told apart
  assert.deepEqual(parts.slice(0, 3), [
    "What is this?",
    "inbox/photo.png, as an image:",
    "file:image/png",
  ]);
  assert.match(parts[3], /huge\.png is 4\.0 MB, over the 4\.0 MB/);
  assert.match(parts[4], /no file at inbox\/gone\.png/);
  assert.match(parts[5], /elsewhere\.png is not in the workspace/);
  assert.match(parts[6], /up\.png is not in the workspace/);

  // The next turn carries the picture in the same place: the conversation the page sends
  // again names it, and she still sees it
  steps.push(() => [{ type: "text", text: "Still a lighthouse." }]);
  await pageTurn({
    callId,
    turn: "turn-pictures-2",
    messages: [asked, answer, words("u-pictures-2", "and now?")],
  });
  const again = JSON.parse(prompts.at(-1) ?? "[]") as {
    role: string;
    content: unknown;
  }[];
  const first = again.find((message) => message.role === "user");
  assert.match(JSON.stringify(first?.content), /"type":"file"/);

  // On a model that cannot see pictures, she is told so rather than sent one
  steps.push(() => [{ type: "text", text: "I cannot see it." }]);
  await pageTurn({
    callId,
    turn: "turn-blind",
    runsOn: { provider: "deepseek", model: "deepseek-chat" },
    messages: [
      {
        id: "u-blind",
        role: "user",
        parts: [{ type: "text", text: "And this?" }, picture("photo.png")],
      },
    ],
  });
  assert.deepEqual(lastUserParts().length, 2);
  assert.match(lastUserParts()[1], /deepseek-chat cannot see pictures/);
});

test("a conversation's pictures go again with every request, newest first, up to what one request carries; an older one goes as its path", async () => {
  const { LOOK } = await import("../config.ts");
  // Four pictures, each under a look's limit, three of which fill a request's
  const size = Math.floor(LOOK.perRequest / 3) - 1;
  await inboxWith({
    "one.png": Buffer.alloc(size),
    "two.png": Buffer.alloc(size),
    "three.png": Buffer.alloc(size),
    "four.png": Buffer.alloc(size),
  });
  const said = (id: string, text: string, names: string[]) => ({
    id,
    role: "user" as const,
    parts: [
      { type: "text" as const, text },
      ...names.map((name) => ({
        type: "file" as const,
        mediaType: "image/png",
        url: `/api/file/inbox/${name}`,
        filename: name,
      })),
    ],
  });
  const { callId } = await openTextCall();
  const first = said("u-many-1", "Here are two.", ["one.png", "two.png"]);
  steps.push(() => [{ type: "text", text: "Two pictures." }]);
  const answer = await answerOf(
    await pageTurn({ callId, turn: "turn-many-1", messages: [first] }),
  );
  const second = said("u-many-2", "And two more.", ["three.png", "four.png"]);
  steps.push(() => [{ type: "text", text: "Four now." }]);
  await pageTurn({
    callId,
    turn: "turn-many-2",
    messages: [first, answer, second],
  });
  const sent = JSON.parse(prompts.at(-1) ?? "[]") as {
    role: string;
    content: { type: string; text?: string }[];
  }[];
  const users = sent.filter((message) => message.role === "user");
  const shape = (message: (typeof users)[number]) =>
    message.content.map((part) =>
      part.type === "file" ? "file" : String(part.text),
    );
  // The newest three go as pictures; the oldest is named, to look at again
  assert.deepEqual(shape(users[1]), [
    "And two more.",
    "inbox/three.png, as an image:",
    "file",
    "inbox/four.png, as an image:",
    "file",
  ]);
  const older = shape(users[0]);
  assert.equal(older[0], "Here are two.");
  assert.match(
    older[1],
    /inbox\/one\.png is a picture not sent with this message.*look_at/,
  );
  assert.deepEqual(older.slice(2), ["inbox/two.png, as an image:", "file"]);
});

test("a phone's pictures go into its message as pictures, stay there for the next turn, and join a running turn with their words", async () => {
  await inboxWith({ "sent.png": PNG, "later.png": PNG });
  const { callId } = await openTextCall();
  const late = [
    { text: "and this one", said: true, pictures: ["inbox/later.png"] },
  ];
  steps.push(
    () => [
      {
        type: "tool-call",
        toolCallId: "pic-1",
        toolName: TOOL_NAMES.thread_status,
        input: JSON.stringify({ thread: "all" }),
      },
    ],
    () => [{ type: "text", text: "Two pictures." }],
  );
  const result = await answerInWriting({
    callId,
    standing: null,
    messages: [{ role: "user", content: "what is this?\ninbox/sent.png" }],
    said: "what is this?\ninbox/sent.png",
    pictures: ["inbox/sent.png"],
    notes: () => late.splice(0),
  });
  assert.equal(result.text, "Two pictures.");
  // The words and the picture in one message of theirs, carried on by name, never its bytes
  const first = result.messages[0];
  assert.equal(first.role, "user");
  assert.ok(Array.isArray(first.content));
  const [, part] = first.content as {
    type: string;
    data?: { type: string; url?: URL };
  }[];
  assert.equal(part.type, "file");
  assert.equal(part.data?.type, "url");
  assert.equal(part.data?.url?.href, "workspace:inbox%2Fsent.png");
  assert.doesNotMatch(JSON.stringify(result.messages), /base64|iVBOR/);
  // What joined between her steps brought its picture too, named
  assert.deepEqual(lastUserParts(), [
    "and this one",
    "inbox/later.png, as an image:",
    "file:image/png",
  ]);
  // The next turn reads the first picture in again from its name
  steps.push(() => [{ type: "text", text: "Still two." }]);
  await answerInWriting({
    callId,
    standing: null,
    messages: [...result.messages, { role: "user", content: "and?" }],
    said: "and?",
  });
  const again = JSON.parse(prompts.at(-1) ?? "[]") as {
    role: string;
    content: unknown;
  }[];
  assert.match(
    JSON.stringify(again.find((message) => message.role === "user")?.content),
    /inbox\/sent\.png, as an image:.*"type":"file"/,
  );
  // Kept as their words, as a turn of theirs is
  assert.deepEqual((await rowsOf(callId))[0], [
    "user",
    "what is this?\ninbox/",
  ]);
});
