import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// The real queries run against a migrated database in an empty temporary home.
const home = await mkdtemp(join(tmpdir(), "thursday-live-history-"));
process.env.THURSDAY_HOME = home;
const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { database } = await import("../database/db.ts");
const { callMessageTable, callTable } = await import("../database/tables.ts");
const { endCall, insertCall, listCallHistory, saveTurns } = await import(
  "../features/thursday/thursday.query.ts"
);
after(() => rm(home, { recursive: true, force: true }));

test("a revised display group keeps its place and its newest fragments, and a call from before Live still reads", async () => {
  const callId = await insertCall({
    provider: "openai",
    model: "gpt-live-1",
    backendModel: "gpt-5.6-luna",
  });
  await saveTurns(callId, [
    {
      id: "live-0",
      role: "user",
      text: "Please find",
      seq: 100,
      fragments: [
        { start: 100, end: 200, text: "Please " },
        { start: 250, end: 350, text: "find" },
      ],
    },
  ]);
  const revised = [
    { start: 100, end: 200, text: "Please " },
    { start: 250, end: 350, text: "find " },
    { start: 400, end: 500, text: "it." },
  ];
  await saveTurns(callId, [
    {
      id: "live-0",
      role: "user",
      text: "Please find it.",
      seq: 999,
      fragments: revised,
    },
    { id: "item-1", role: "tool", tool: "delegate", text: "{}", seq: 120 },
  ]);
  assert.equal(
    await endCall(callId, { reason: "close_requested", seconds: 42 }),
    true,
  );
  // A second end keeps the first confirmation
  assert.equal(await endCall(callId, { reason: "error", seconds: 1 }), false);

  const oldId = crypto.randomUUID();
  await database.insert(callTable).values({
    id: oldId,
    provider: "xai",
    model: "grok-voice",
    startedAt: new Date("2026-09-01T00:00:00Z"),
    endedAt: new Date("2026-09-01T00:05:00Z"),
  });
  await database.insert(callMessageTable).values({
    callId: oldId,
    id: "item_a",
    seq: 0,
    role: "assistant",
    text: "Hello.",
  });

  const [live, old] = await listCallHistory({ before: null });
  assert.equal(live.id, callId);
  assert.equal(live.backendModel, "gpt-5.6-luna");
  assert.equal(live.seconds, 42);
  assert.equal(live.endedReason, "close_requested");
  const user = live.turns.find((turn) => turn.id === "live-0");
  assert.equal(user?.text, "Please find it.");
  assert.equal(user?.seq, 100);
  assert.deepEqual(user?.fragments, revised);
  assert.equal(
    live.turns.find((turn) => turn.role === "tool")?.fragments,
    null,
  );

  assert.equal(old.id, oldId);
  assert.equal(old.backendModel, null);
  assert.equal(old.seconds, null);
  assert.equal(old.endedReason, null);
  assert.equal(old.turns[0].text, "Hello.");
  assert.equal(old.turns[0].fragments, null);
});

test("a call ended without confirmation leaves its seconds unknown", async () => {
  const callId = await insertCall({
    provider: "openai",
    model: "gpt-live-1",
    backendModel: "gpt-5.6-terra",
  });
  await saveTurns(callId, [
    { id: "live-0", role: "assistant", text: "Hi.", seq: 0, fragments: [] },
  ]);
  await endCall(callId, null);
  // Found by id: start times are stored to the second, so calls in one test run can tie
  const call = (await listCallHistory({ before: null })).find(
    (row) => row.id === callId,
  );
  assert.ok(call);
  assert.equal(call.seconds, null);
  assert.equal(call.endedReason, null);
  assert.notEqual(call.endedAt, null);
});
