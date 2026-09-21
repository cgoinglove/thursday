import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
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
const model = new MockLanguageModelV4({
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
    getTextModel: async (ref: unknown) => ({ ref, model, searchTools: null }),
  },
});
const realLive = await import("../lib/live/live.server.ts");
mock.module("../lib/live/live.server.ts", {
  // Asked of the provider over the network; nothing here depends on the answer
  namedExports: { ...realLive, acceptedReasoning: async () => null },
});

const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { writeConfig } = await import("../features/config/config.query.ts");
const { LIVE_PROVIDER, LiveSettingsSchema } = await import(
  "../features/ai/live.schema.ts"
);
await writeConfig(LIVE_PROVIDER.apiKeyName, "sk-test");
const { TOOL_NAMES } = await import("../features/ai/tools/tool-name.ts");
const { readCallConversation } = await import(
  "../features/thursday/thursday.query.ts"
);
const { answerInWriting, openTextCall } = await import(
  "../features/thursday/thursday.text.ts"
);
const { isCallOpen, sweepCalls } = await import(
  "../features/thursday/thursday.query.ts"
);

after(async () => {
  await rm(home, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});

test("what arrives while she works joins the turn between her steps, and keeps its place", async () => {
  const settings = LiveSettingsSchema.parse({});
  const { callId } = await openTextCall(settings);
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
    settings,
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
  const rows = (await readCallConversation(callId, 1, 20))?.turns ?? [];
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

test("the last tab going closes the calls a tab held, never one the server holds for a phone", async () => {
  const settings = LiveSettingsSchema.parse({});
  const page = (await openTextCall(settings)).callId;
  const phone = (await openTextCall(settings)).callId;
  await sweepCalls([phone]);
  assert.equal(await isCallOpen(page), false);
  assert.equal(await isCallOpen(phone), true);
  // At boot nothing is held: what the last process left open is closed
  await sweepCalls();
  assert.equal(await isCallOpen(phone), false);
});
