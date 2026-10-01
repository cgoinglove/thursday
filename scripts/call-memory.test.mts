import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { MockLanguageModelV4 } from "ai/test";

// The pass after a spoken call, over an empty home with a model that is only a script: which
// calls it reads, what it is shown, the tools it holds, and what it leaves on the call's row.
const home = await mkdtemp(join(tmpdir(), "thursday-call-memory-"));
process.env.THURSDAY_HOME = home;
process.env.THURSDAY_SKIP_BROWSER = "1";

/** One step's content, or a throw for a model that refuses. */
type Step = () => Record<string, unknown>[];
const steps: Step[] = [];
const seen: { system: string; user: string; tools: string[] }[] = [];
const model = new MockLanguageModelV4({
  doGenerate: async ({ prompt, tools }) => {
    seen.push({
      system: prompt
        .flatMap((message) =>
          message.role === "system" ? [String(message.content)] : [],
        )
        .join("\n"),
      user: JSON.stringify(prompt.filter((message) => message.role === "user")),
      tools: (tools ?? []).map((tool) => tool.name),
    });
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
/** What each pass was built on, in order. */
const builtFor: string[] = [];
const realModel = await import("../features/ai/model.ts");
mock.module("../features/ai/model.ts", {
  namedExports: {
    ...realModel,
    getTextModel: async (ref: { provider: string; model: string }) => {
      builtFor.push(`${ref.provider}/${ref.model}`);
      return { ref, model, searchTools: null };
    },
  },
});

const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { database } = await import("../database/db.ts");
const { callTable } = await import("../database/tables.ts");
const { eq } = await import("drizzle-orm");
const { CALL_MEMORY, TEXT_CALL } = await import("../config.ts");
const { writeConfig } = await import("../features/config/config.query.ts");
const { LIVE_PROVIDER } = await import("../features/ai/live.schema.ts");
const { TOOL_NAMES } = await import("../features/ai/tools/tool-name.ts");
const { ensureRootNotes, readNotes, writeFacts } = await import(
  "../features/memory/memory.query.ts"
);
const { endCall, insertCall, saveTurns } = await import(
  "../features/thursday/thursday.query.ts"
);
const { keepCallMemory } = await import("../features/memory/call-memory.ts");
await ensureRootNotes();
await writeConfig(LIVE_PROVIDER.apiKeyName, "sk-test");

after(async () => {
  await rm(home, { recursive: true, force: true });
});

/** A call with these turns, ended; spoken unless `model` says it was in writing. */
async function placeCall(
  turns: { role: "user" | "assistant"; text: string }[],
  model = "gpt-live-1",
): Promise<string> {
  const callId = await insertCall({
    provider: "openai",
    model,
    backendModel: "gpt-backend-test",
  });
  if (turns.length)
    await saveTurns(
      callId,
      turns.map((turn, seq) => ({ id: `i-${seq}`, seq, ...turn })),
    );
  await endCall(callId);
  return callId;
}

const keptAt = async (callId: string) =>
  (
    await database
      .select({ at: callTable.memoryKeptAt })
      .from(callTable)
      .where(eq(callTable.id, callId))
  )[0]?.at ?? null;

const remember = (path: string, facts: { text: string }[]) => () => [
  {
    type: "tool-call",
    toolCallId: `t-${path}`,
    toolName: TOOL_NAMES.memory_remember,
    input: JSON.stringify({ path, facts }),
  },
];
const done = () => [{ type: "text", text: "done" }];

test("an ended spoken call is read once: what it kept is the call's, and the call is stamped", async () => {
  const callId = await placeCall([
    { role: "user", text: "Hi. You can call me Sam." },
    { role: "assistant", text: "Nice to meet you, Sam." },
    { role: "user", text: "I work as a nurse, mostly night shifts." },
  ]);
  // What the voice handed over while the call ran: shown, so it is not written again
  await writeFacts(
    "profile",
    [{ text: "Works night shifts." }],
    "call",
    callId,
  );
  steps.push(remember("profile", [{ text: "Their name is Sam." }]), done);
  seen.length = 0;
  await keepCallMemory();

  assert.equal(steps.length, 0);
  assert.equal(seen.length, 2);
  assert.deepEqual(builtFor.at(-1), "openai/gpt-backend-test");
  // Only what writes and merges: no forget, no thread, no shell
  assert.deepEqual(seen[0].tools.sort(), [
    TOOL_NAMES.memory_create,
    TOOL_NAMES.memory_describe,
    TOOL_NAMES.memory_recall,
    TOOL_NAMES.memory_remember,
  ]);
  assert.match(seen[0].user, /user: Hi\. You can call me Sam\./);
  assert.match(seen[0].user, /Thursday: Nice to meet you, Sam\./);
  assert.match(seen[0].user, /## Kept during this call/);
  assert.match(seen[0].user, /- profile: Works night shifts\. #\d+/);
  assert.match(seen[0].system, /## What to keep/);
  assert.match(seen[0].system, /## Memory/);
  // The call's own chapter keeps what only the call holds
  assert.doesNotMatch(seen[0].system, new RegExp(TOOL_NAMES.memory_forget));
  assert.doesNotMatch(seen[0].system, new RegExp(TOOL_NAMES.thread_tell));

  const { notes } = await readNotes(["profile"], { touch: false });
  const name = notes[0].facts.find(
    (fact) => fact.text === "Their name is Sam.",
  );
  assert.ok(name, "the fact the pass wrote is kept");
  assert.ok("saidAt" in name, "and reads as said on that call");
  assert.ok(await keptAt(callId));

  // Woken again, it reads nothing: the call was read once
  seen.length = 0;
  await keepCallMemory();
  assert.equal(seen.length, 0);
});

test("a call in writing and a call nobody spoke on are never read", async () => {
  const written = await placeCall(
    [{ role: "user", text: "I'm allergic to peanuts." }],
    TEXT_CALL.model,
  );
  const silent = await placeCall([
    { role: "assistant", text: "Hi, I'm Thursday." },
  ]);
  seen.length = 0;
  await keepCallMemory();
  assert.equal(seen.length, 0);
  assert.equal(await keptAt(written), null);
  assert.equal(await keptAt(silent), null);
});

test("a call that ended before the catch-up window is left alone", async () => {
  const old = await placeCall([{ role: "user", text: "My sister is Mia." }]);
  await database
    .update(callTable)
    .set({ endedAt: new Date(Date.now() - CALL_MEMORY.catchUpMs - 60_000) })
    .where(eq(callTable.id, old));
  seen.length = 0;
  await keepCallMemory();
  assert.equal(seen.length, 0);
  assert.equal(await keptAt(old), null);
});

test("a pass that fails is logged, never thrown, and not tried again", async () => {
  const callId = await placeCall([
    { role: "user", text: "Ugh, it's so hot today." },
  ]);
  steps.push(() => {
    throw new Error("The model refused.");
  });
  seen.length = 0;
  await keepCallMemory();
  assert.equal(seen.length, 1);
  assert.ok(await keptAt(callId));
  seen.length = 0;
  await keepCallMemory();
  assert.equal(seen.length, 0);
});

test("wakes that come while a pass runs are taken up by it, each call read once", async () => {
  const first = await placeCall([{ role: "user", text: "I live by the sea." }]);
  steps.push(done);
  const running = keepCallMemory();
  const second = await placeCall([{ role: "user", text: "I have a dog." }]);
  steps.push(done);
  const woken = keepCallMemory();
  await Promise.all([running, woken]);
  assert.equal(steps.length, 0);
  assert.ok(await keptAt(first));
  assert.ok(await keptAt(second));
});
