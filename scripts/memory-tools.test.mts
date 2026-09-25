import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// Memory's tools against an empty temporary home: the real query on a real database.
const home = await mkdtemp(join(tmpdir(), "thursday-memory-"));
process.env.THURSDAY_HOME = home;

const { migrateDatabase } = await import("../database/migrate.ts");
await migrateDatabase();
const { MEMORY_LIMITS } = await import("../config.ts");
const { TOOL_NAMES } = await import("../features/ai/tools/tool-name.ts");
const { createMemoryTools } = await import(
  "../features/ai/tools/memory.tool.ts"
);
const { ensureRootNotes, listNoteIndex, readNotes } = await import(
  "../features/memory/memory.query.ts"
);
await ensureRootNotes();

after(async () => {
  await rm(home, { recursive: true, force: true });
});

const hand = createMemoryTools("call", null);

type Answer = {
  note?: string;
  path?: string;
  description?: string;
  factCount?: number;
  facts?: { id: number; text: string }[];
};

/** Calls one of memory's tools the way the sdk does, with the arguments a model would send. */
const call = (name: keyof typeof hand, input: unknown): Promise<Answer> =>
  (
    hand[name] as unknown as {
      execute: (input: unknown, options: unknown) => Promise<Answer>;
    }
  ).execute(input, { toolCallId: "t", messages: [] });

const lineOf = async (path: string) =>
  (await listNoteIndex()).find((note) => note.path === path)?.description;

test("a subject not on the listing is refused by remember and made by create, with its line", async () => {
  const refused = await call(TOOL_NAMES.memory_remember, {
    path: "people/sam",
    facts: [{ text: "Lives in Busan." }],
  });
  assert.match(
    refused.note ?? "",
    /^Nothing on the listing called people\/sam\./,
  );
  assert.match(refused.note ?? "", /`memory_create`, with its line/);
  assert.equal(await lineOf("people/sam"), undefined);

  const made = await call(TOOL_NAMES.memory_create, {
    path: "people/sam",
    description: "Their brother, Sam",
    facts: [{ text: "Lives in Busan." }, { text: "lives in busan" }],
  });
  assert.match(made.note ?? "", /^Saved\./);
  // The same fact twice in one write is one fact
  assert.equal(made.factCount, 1);
  assert.equal(await lineOf("people/sam"), "Their brother, Sam");

  const twin = await call(TOOL_NAMES.memory_create, {
    path: "people/sam",
    description: "Another Sam",
    facts: [{ text: "Plays chess." }],
  });
  assert.match(twin.note ?? "", /already on the listing/);
  assert.equal(await lineOf("people/sam"), "Their brother, Sam");
  assert.equal((await readNotes(["people/sam"])).notes[0]?.facts.length, 1);
});

test("a line past the cap is refused, on create and on describe, and nothing is written", async () => {
  const long = "x".repeat(MEMORY_LIMITS.descriptionChars + 1);
  const made = await call(TOOL_NAMES.memory_create, {
    path: "people/kim",
    description: long,
    facts: [{ text: "Runs a bakery." }],
  });
  assert.match(made.note ?? "", /runs to 101 characters/);
  assert.equal(await lineOf("people/kim"), undefined);

  const renamed = await call(TOOL_NAMES.memory_describe, {
    path: "people/sam",
    description: long,
  });
  assert.match(renamed.note ?? "", /runs to 101 characters/);
  assert.equal(await lineOf("people/sam"), "Their brother, Sam");

  const fits = await call(TOOL_NAMES.memory_describe, {
    path: "people/sam",
    description: "Their brother Sam, in Busan",
  });
  assert.match(fits.note ?? "", /^Renamed\./);
  assert.equal(await lineOf("people/sam"), "Their brother Sam, in Busan");

  const gone = await call(TOOL_NAMES.memory_describe, {
    path: "people/nobody",
    description: "Nobody",
  });
  assert.match(
    gone.note ?? "",
    /^Nothing on the listing called people\/nobody\./,
  );
});

test("profile and preferences keep the app's line and take facts through remember", async () => {
  const renamed = await call(TOOL_NAMES.memory_describe, {
    path: "preferences",
    description: "How they like it",
  });
  assert.match(renamed.note ?? "", /keep their own line/);
  const made = await call(TOOL_NAMES.memory_create, {
    path: "preferences",
    description: "How they like it",
    facts: [{ text: "Short answers." }],
  });
  assert.match(made.note ?? "", /always on the listing/);

  const kept = await call(TOOL_NAMES.memory_remember, {
    path: "preferences",
    facts: [{ text: "Short answers." }],
  });
  assert.match(kept.note ?? "", /^Saved\./);
  assert.equal(kept.factCount, 1);
  assert.match(
    (await lineOf("preferences")) ?? "",
    /^How they want things done, and said/,
  );
});

test("replaces retires the old fact, and a fact already there is not written twice", async () => {
  const before = (await readNotes(["people/sam"])).notes[0]?.facts ?? [];
  const busan = before.find((fact) => fact.text === "Lives in Busan.");
  assert.ok(busan);

  const again = await call(TOOL_NAMES.memory_remember, {
    path: "people/sam",
    facts: [{ text: "Lives in Busan!" }],
  });
  assert.equal(again.factCount, 1);

  const moved = await call(TOOL_NAMES.memory_remember, {
    path: "people/sam",
    facts: [{ text: "Moved to Seoul in 2026.", replaces: busan.id }],
  });
  assert.equal(moved.factCount, 1);
  const after = (await readNotes(["people/sam"])).notes[0]?.facts ?? [];
  assert.deepEqual(
    after.map((fact) => fact.text),
    ["Moved to Seoul in 2026."],
  );
  assert.notEqual(after[0].id, busan.id);
});

test("a path outside the convention is refused, and a note is opened by its path alone", async () => {
  const filed = await call(TOOL_NAMES.memory_create, {
    path: "misc/sam",
    description: "Sam",
    facts: [{ text: "Plays chess." }],
  });
  assert.match(filed.note ?? "", /not a path this listing can carry/);

  const byTitle = await call(TOOL_NAMES.memory_recall, { path: "sam" });
  assert.match(byTitle.note ?? "", /^Nothing on the listing called sam\./);
  const byPath = await call(TOOL_NAMES.memory_recall, { path: "people/sam" });
  assert.equal(byPath.factCount, 1);
  assert.equal(byPath.description, "Their brother Sam, in Busan");
});
