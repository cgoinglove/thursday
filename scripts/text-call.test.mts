import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import {
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
  doStream: async ({ prompt }) => {
    prompts.push(JSON.stringify(prompt));
    const next = steps.shift();
    assert.ok(next, "Unexpected step");
    const content = next();
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
const realModel = await import("../features/ai/model.ts");
mock.module("../features/ai/model.ts", {
  namedExports: {
    ...realModel,
    getTextModel: async (ref: { model?: string }) => {
      // A pick that cannot be run: refused before anything of the turn is kept
      if (ref.model === "refused") throw new Error("No key for that model.");
      return { ref, model, searchTools: null };
    },
  },
});
const realLive = await import("../lib/live/live.server.ts");
mock.module("../lib/live/live.server.ts", {
  // Asked of the provider over the network; nothing here depends on the answer
  namedExports: { ...realLive, acceptedReasoning: async () => null },
});

const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { readConfig, writeConfig } = await import(
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
    messages: [first, words("u-6", "and in Seoul")],
  });
  assert.deepEqual(await rowsOf(callId), [
    ["user", "what time is it in L"],
    ["user", "and in Seoul"],
    ["assistant", "Both, then."],
  ]);
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
  await writeLiveSettings(LiveSettingsSchema.parse({ persona: "hype" }));
  const now = await readLiveSettings();
  assert.equal(now.persona, "hype");
  assert.equal(now.voice, LIVE_DEFAULTS.voice);
  assert.equal(now.stylePrompt, "");
  // Switched off, which is the default: the row it had of its own must not switch it on
  assert.equal(now.readSkills, false);

  // Only what differs from the defaults is kept, so a default nobody picked moves with
  // the app when it changes — the backend model a release replaces, for one
  const kept2 = JSON.parse((await readConfig(THURSDAY_KEYS.settings)) ?? "{}");
  assert.deepEqual(kept2, { persona: "hype" });
  await writeLiveSettings(
    LiveSettingsSchema.parse({
      persona: "hype",
      backendModel: "gpt-older-luna",
      reasoningEffort: null,
    }),
  );
  assert.deepEqual(
    JSON.parse((await readConfig(THURSDAY_KEYS.settings)) ?? "{}"),
    { persona: "hype", backendModel: "gpt-older-luna", reasoningEffort: null },
  );
  // Picking the default again lets go of the old one
  await writeLiveSettings(LiveSettingsSchema.parse({ persona: "hype" }));
  assert.equal(
    (await readLiveSettings()).backendModel,
    LIVE_DEFAULTS.backendModel,
  );

  // A row already seeded with a browser's default backend reads as unpicked too
  await writeConfig(
    THURSDAY_KEYS.settings,
    JSON.stringify({ persona: "hype", backendModel: "gpt-5.6-luna" }),
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
  assert.equal(both.persona, "hype");
  await assert.rejects(changeLiveSettings({ persona: "" }));
});
