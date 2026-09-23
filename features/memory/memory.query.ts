import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { appEvents } from "@/app/api/events/app-event.server";
import { PAGE_SIZE } from "@/config";
import { database } from "@/database/db";
import { callTable, memoryFactTable, memoryNoteTable } from "@/database/tables";
import { createKeyedLock } from "@/lib/queue";
import {
  isAlwaysListed,
  MEMORY_ALWAYS_LISTED,
  MEMORY_PATHS,
  type MemoryFactWrite,
  type MemoryNoteView,
  type MemorySource,
  recallScore,
} from "./memory.schema";

// Forgetting deletes a fact; revising appends a new row and retires the old one (isLatest = false).

// Tool calls during a call run concurrently (routes, not actions) and SQLite allows
// one write transaction, so writes are serialized on a single key.
const writeLock = createKeyedLock();
const serialize = <T>(work: () => Promise<T>) => writeLock("memory", work);

const changed = () => appEvents.emit({ type: "memory" });

/** Always-listed notes sort first. */
const listedFirst = inArray(memoryNoteTable.path, MEMORY_ALWAYS_LISTED);

/** One page of notes in display order; sorted server-side so pages stay stable. */
export async function findAllNotes(
  options: { offset?: number; limit?: number } = {},
) {
  // (hits + 1) / (1 + days since last read, or since creation). Same rule as recallScore.
  const score = sql<number>`
    (${memoryNoteTable.hits} + 1.0) /
    (1.0 + max(0.0, (unixepoch() - coalesce(${memoryNoteTable.lastReadAt}, ${memoryNoteTable.createdAt})) / 86400.0))
  `;

  const notes = await database
    .select()
    .from(memoryNoteTable)
    .orderBy(desc(listedFirst), desc(score), memoryNoteTable.id)
    .limit(options.limit ?? PAGE_SIZE)
    .offset(options.offset ?? 0);

  const facts = notes.length ? await latestFacts(notes.map((n) => n.id)) : [];

  const byNote = new Map<number, typeof facts>();
  for (const fact of facts) {
    const list = byNote.get(fact.noteId);
    if (list) list.push(fact);
    else byNote.set(fact.noteId, [fact]);
  }

  return notes.map((note) => {
    const own = byNote.get(note.id) ?? [];
    return { ...note, factCount: own.length, facts: own };
  });
}

/** Current facts for several notes at once. */
function latestFacts(noteIds: number[]) {
  return database
    .select({
      id: memoryFactTable.id,
      noteId: memoryFactTable.noteId,
      text: memoryFactTable.text,
      source: memoryFactTable.source,
      createdAt: memoryFactTable.createdAt,
      saidAt: callTable.startedAt,
    })
    .from(memoryFactTable)
    .leftJoin(callTable, eq(memoryFactTable.callId, callTable.id))
    .where(
      and(
        eq(memoryFactTable.isLatest, true),
        inArray(memoryFactTable.noteId, noteIds),
      ),
    )
    .orderBy(asc(memoryFactTable.id));
}

export async function createNote(
  path: string,
  description: string,
  options: { ownedByUser?: boolean } = {},
) {
  const [note] = await database
    .insert(memoryNoteTable)
    .values({ path, description, ownedByUser: options.ownedByUser ?? false })
    .onConflictDoNothing({ target: memoryNoteTable.path })
    .returning();
  if (note) changed();
  return note ?? null;
}

export async function updateNote(id: number, patch: { description?: string }) {
  const [note] = await database
    .update(memoryNoteTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(memoryNoteTable.id, id))
    .returning();
  if (note) changed();
  return note ?? null;
}

/** Facts cascade with the note. */
export async function deleteNote(id: number) {
  const removed = await database
    .delete(memoryNoteTable)
    .where(eq(memoryNoteTable.id, id))
    .returning({ id: memoryNoteTable.id });
  if (removed.length > 0) changed();
  return removed.length > 0;
}

export async function addFact(noteId: number, text: string) {
  const [fact] = await database
    .insert(memoryFactTable)
    // Only the screen calls this, so the hand is known here (memory.action)
    .values({ noteId, text, source: "user" })
    .returning();
  await touchNote(noteId);
  changed();
  return fact;
}

/** Revision never overwrites: the old row is retired and a new row becomes current. */
export async function reviseFact(noteId: number, factId: number, text: string) {
  const fact = await serialize(() =>
    database.transaction(async (tx) => {
      const retired = await tx
        .update(memoryFactTable)
        .set({ isLatest: false })
        .where(
          and(
            eq(memoryFactTable.id, factId),
            eq(memoryFactTable.noteId, noteId),
            eq(memoryFactTable.isLatest, true),
          ),
        )
        .returning({ id: memoryFactTable.id });
      if (retired.length === 0) return null;

      const [fact] = await tx
        .insert(memoryFactTable)
        .values({ noteId, text, source: "user" })
        .returning();
      await tx
        .update(memoryNoteTable)
        .set({ updatedAt: new Date() })
        .where(eq(memoryNoteTable.id, noteId));
      return fact;
    }),
  );
  if (fact) changed();
  return fact;
}

/**
 * Deletes the current row only. Retired versions have no link to it and stay;
 * every read filters on isLatest and the note's cascade removes them eventually.
 */
export async function forgetFact(noteId: number, factId: number) {
  const removed = await database
    .delete(memoryFactTable)
    .where(
      and(eq(memoryFactTable.id, factId), eq(memoryFactTable.noteId, noteId)),
    )
    .returning({ id: memoryFactTable.id });
  if (removed.length > 0) {
    await touchNote(noteId);
    changed();
  }
  return removed.length > 0;
}

function touchNote(id: number) {
  return database
    .update(memoryNoteTable)
    .set({ updatedAt: new Date() })
    .where(eq(memoryNoteTable.id, id));
}

/**
 * The always-listed notes exist from the first call. Their description is
 * app-owned (MEMORY_PATHS), so it is reset on every boot.
 */
export async function ensureRootNotes() {
  for (const path of MEMORY_ALWAYS_LISTED) {
    const description =
      MEMORY_PATHS.find((entry) => entry.path === path)?.of ?? path;
    await database
      .insert(memoryNoteTable)
      .values({ path, description })
      .onConflictDoUpdate({
        target: memoryNoteTable.path,
        set: { description },
      });
  }
}

/**
 * Notes by path, whole. A path is the one name a note has: the listing a model
 * reads carries it on every line, so a name that is not on it is answered as
 * missing rather than guessed at.
 */
export async function readNotes(
  paths: string[],
  options: { touch?: boolean } = {},
): Promise<{ notes: MemoryNoteView[]; missing: string[] }> {
  const wanted = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
  if (!wanted.length) return { notes: [], missing: [] };

  const found = await database
    .select({
      id: memoryNoteTable.id,
      path: memoryNoteTable.path,
      description: memoryNoteTable.description,
    })
    .from(memoryNoteTable)
    .where(inArray(memoryNoteTable.path, wanted));
  const byPath = new Map(found.map((note) => [note.path, note]));
  const missing = wanted.filter((path) => !byPath.has(path));
  if (!found.length) return { notes: [], missing };

  const ids = found.map((note) => note.id);
  const facts = await latestFacts(ids);

  if (options.touch !== false) {
    await database
      .update(memoryNoteTable)
      .set({ hits: sql`${memoryNoteTable.hits} + 1`, lastReadAt: new Date() })
      .where(inArray(memoryNoteTable.id, ids));
  }

  // In the order asked for
  const notes = wanted.flatMap((path) => {
    const note = byPath.get(path);
    return note
      ? [
          {
            path: note.path,
            description: note.description,
            facts: facts
              .filter((fact) => fact.noteId === note.id)
              .map((fact) => ({
                id: fact.id,
                text: fact.text,
                ...(fact.saidAt ? { saidAt: fact.saidAt } : {}),
              })),
          },
        ]
      : [];
  });
  return { notes, missing };
}

/** Facts differing only in whitespace, punctuation or case count as the same fact. */
const sameFact = (text: string) =>
  text.toLowerCase().replace(/[\s.,!?…·'"`]/g, "");

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];

/**
 * Writes a batch of facts under one note inside the caller's transaction. A
 * revision is retire + insert and must not be split; a fact already present
 * (sameFact) is skipped, not reinserted, so a batch that repeats the note merges.
 */
async function insertFacts(
  tx: Tx,
  noteId: number,
  facts: MemoryFactWrite[],
  source: MemorySource,
  callId: string | null,
): Promise<void> {
  const existing = await tx
    .select({ id: memoryFactTable.id, text: memoryFactTable.text })
    .from(memoryFactTable)
    .where(
      and(
        eq(memoryFactTable.noteId, noteId),
        eq(memoryFactTable.isLatest, true),
      ),
    );
  // Normalized text -> current row; kept current so duplicates within one call merge too.
  const known = new Map(existing.map((row) => [sameFact(row.text), row]));

  for (const fact of facts) {
    const text = fact.text.trim();
    if (!text) continue;

    if (fact.replaces != null) {
      const [target] = await tx
        .select({ id: memoryFactTable.id, text: memoryFactTable.text })
        .from(memoryFactTable)
        .where(
          and(
            eq(memoryFactTable.id, fact.replaces),
            eq(memoryFactTable.noteId, noteId),
            eq(memoryFactTable.isLatest, true),
          ),
        );
      // An unknown id falls through and the fact is simply stored; the same text is nothing to change
      if (target) {
        if (sameFact(target.text) === sameFact(text)) continue;
        await tx
          .update(memoryFactTable)
          .set({ isLatest: false })
          .where(eq(memoryFactTable.id, target.id));
        known.delete(sameFact(target.text));
        // No duplicate check: this is a revision, not an addition.
        const [added] = await tx
          .insert(memoryFactTable)
          .values({ noteId, text, source, callId })
          .returning({ id: memoryFactTable.id });
        known.set(sameFact(text), { ...added, text });
        continue;
      }
    }

    if (known.has(sameFact(text))) continue;
    const [added] = await tx
      .insert(memoryFactTable)
      .values({ noteId, text, source, callId })
      .returning({ id: memoryFactTable.id });
    known.set(sameFact(text), { ...added, text });
  }

  await tx
    .update(memoryNoteTable)
    .set({ updatedAt: new Date() })
    .where(eq(memoryNoteTable.id, noteId));
}

/**
 * Facts under a note that is already on the listing; null when the path is not.
 * A missing path is an answer for the caller to relay, never a note made on the
 * way: a note comes into being with its line (createNoteWithFacts).
 *
 * @param source Which hand is writing; recorded on every fact (memory.schema MemorySource).
 * @param callId The call it is being said in; null for the screen and for a bot.
 */
export async function writeFacts(
  path: string,
  facts: MemoryFactWrite[],
  source: MemorySource,
  callId: string | null = null,
): Promise<MemoryNoteView | null> {
  const target = path.trim();
  const written = await serialize(() =>
    database.transaction(async (tx) => {
      const [note] = await tx
        .select({ id: memoryNoteTable.id })
        .from(memoryNoteTable)
        .where(eq(memoryNoteTable.path, target));
      if (!note) return false;
      await insertFacts(tx, note.id, facts, source, callId);
      return true;
    }),
  );
  if (!written) return null;

  // Re-read without touching hits: saving is not recall.
  const { notes } = await readNotes([target], { touch: false });
  changed();
  return notes[0] ?? null;
}

/**
 * A new note with its line and its first facts, in one transaction; null when
 * the path is already taken, so a second write to a subject amends the note
 * that has it (writeFacts) rather than making a twin.
 */
export async function createNoteWithFacts(
  path: string,
  description: string,
  facts: MemoryFactWrite[],
  source: MemorySource,
  callId: string | null = null,
): Promise<MemoryNoteView | null> {
  const target = path.trim();
  const made = await serialize(() =>
    database.transaction(async (tx) => {
      const [note] = await tx
        .insert(memoryNoteTable)
        .values({ path: target, description })
        .onConflictDoNothing({ target: memoryNoteTable.path })
        .returning({ id: memoryNoteTable.id });
      if (!note) return false;
      await insertFacts(tx, note.id, facts, source, callId);
      return true;
    }),
  );
  if (!made) return null;

  const { notes } = await readNotes([target], { touch: false });
  changed();
  return notes[0] ?? null;
}

/** The line a note is listed by, replaced whole; false when there is no such note. */
export async function describeNote(
  path: string,
  description: string,
): Promise<boolean> {
  const [note] = await database
    .update(memoryNoteTable)
    .set({ description, updatedAt: new Date() })
    .where(eq(memoryNoteTable.path, path.trim()))
    .returning({ id: memoryNoteTable.id });
  if (note) changed();
  return Boolean(note);
}

/** Index for the system prompt: one line per note, no fact text, hottest first. */
export async function listNoteIndex() {
  const [notes, counts] = await Promise.all([
    database
      .select({
        id: memoryNoteTable.id,
        path: memoryNoteTable.path,
        description: memoryNoteTable.description,
        hits: memoryNoteTable.hits,
        lastReadAt: memoryNoteTable.lastReadAt,
        createdAt: memoryNoteTable.createdAt,
      })
      .from(memoryNoteTable),
    database
      .select({
        noteId: memoryFactTable.noteId,
        count: sql<number>`count(*)`,
      })
      .from(memoryFactTable)
      .where(eq(memoryFactTable.isLatest, true))
      .groupBy(memoryFactTable.noteId),
  ]);

  const countOf = new Map(counts.map((row) => [row.noteId, row.count]));

  return (
    notes
      // Empty notes are hidden, except the always-listed ones.
      .filter(
        (note) => isAlwaysListed(note.path) || (countOf.get(note.id) ?? 0) > 0,
      )
      .sort((a, b) => {
        const listed =
          Number(isAlwaysListed(b.path)) - Number(isAlwaysListed(a.path));
        return listed || recallScore(b) - recallScore(a);
      })
      .map((note) => ({
        path: note.path,
        description: note.description,
        factCount: countOf.get(note.id) ?? 0,
        lastSeenAt: note.lastReadAt ?? note.createdAt,
      }))
  );
}

/**
 * Deletes one fact by id. When the last fact goes the note goes too,
 * unless it is user-owned or always-listed.
 */
export async function forgetFactById(
  factId: number,
): Promise<{ path: string; noteGone: boolean } | null> {
  const forgotten = await serialize(() =>
    database.transaction(async (tx) => {
      const removed = await tx
        .delete(memoryFactTable)
        .where(eq(memoryFactTable.id, factId))
        .returning({ noteId: memoryFactTable.noteId });
      if (removed.length === 0) return null;

      const noteId = removed[0].noteId;
      const [note] = await tx
        .select({
          path: memoryNoteTable.path,
          ownedByUser: memoryNoteTable.ownedByUser,
        })
        .from(memoryNoteTable)
        .where(eq(memoryNoteTable.id, noteId));

      const [remaining] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(memoryFactTable)
        .where(
          and(
            eq(memoryFactTable.noteId, noteId),
            eq(memoryFactTable.isLatest, true),
          ),
        );

      if (
        remaining?.count === 0 &&
        note &&
        !note.ownedByUser &&
        !isAlwaysListed(note.path)
      ) {
        await tx.delete(memoryNoteTable).where(eq(memoryNoteTable.id, noteId));
        return { path: note.path, noteGone: true };
      }

      await tx
        .update(memoryNoteTable)
        .set({ updatedAt: new Date() })
        .where(eq(memoryNoteTable.id, noteId));
      return { path: note?.path ?? "", noteGone: false };
    }),
  );
  if (forgotten) changed();
  return forgotten;
}

/**
 * Every note, facts included (cascade). The always-listed notes come straight
 * back, empty: the caller runs `ensureRootNotes` so memory is never pathless.
 */
export async function deleteAllNotes(): Promise<number> {
  const removed = await database
    .delete(memoryNoteTable)
    .returning({ id: memoryNoteTable.id });
  await ensureRootNotes();
  if (removed.length > 0) changed();
  return removed.length;
}
