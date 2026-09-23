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
const { answerInWriting, openTextCall } = await import(
  "../features/thursday/thursday.text.ts"
);
const {
  isCallOpen,
  listRecentTurns,
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
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
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
test("the kept settings take a browser's copy once, and read the old skills row until they hold one", async () => {
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
  };
  assert.equal(await seedLiveSettings(carried), true);
  const kept = await readLiveSettings();
  assert.equal(kept.voice, "cedar");
  assert.equal(kept.persona, "calm");
  assert.equal(kept.stylePrompt, "Quieter.");
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

  // Written whole, so a field left out goes back to its default rather than lingering
  await writeLiveSettings(LiveSettingsSchema.parse({ persona: "hype" }));
  const now = await readLiveSettings();
  assert.equal(now.persona, "hype");
  assert.equal(now.voice, LIVE_DEFAULTS.voice);
  assert.equal(now.stylePrompt, "");
  // Its own field now, so the row that used to hold it is not read again
  assert.equal(now.readSkills, false);
});
