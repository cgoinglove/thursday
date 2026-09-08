import { and, asc, between, desc, eq, inArray, sql } from "drizzle-orm";
import { appEvents } from "@/app/api/events/app-event.server";
import { PAGE_SIZE } from "@/config";
import { database } from "@/database/db";
import { memoryFactTable, memoryNoteTable } from "@/database/tables";
import { createKeyedLock } from "@/lib/queue";
import {
  ALWAYS_LOADED_MAX,
  isAlwaysListed,
  MEMORY_ALWAYS_LISTED,
  MEMORY_PATHS,
  type MemoryAlwaysLoaded,
  type MemoryNoteView,
  type MemoryNoteWrite,
  type MemoryWrite,
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
      alwaysLoad: memoryFactTable.alwaysLoad,
      createdAt: memoryFactTable.createdAt,
    })
    .from(memoryFactTable)
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

/** Note by path with all current facts. */
export async function findNoteByPath(path: string) {
  const [note] = await database
    .select()
    .from(memoryNoteTable)
    .where(eq(memoryNoteTable.path, path.trim()));
  if (!note) return null;

  const facts = await latestFacts([note.id]);
  return { ...note, factCount: facts.length, facts };
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
    .values({ noteId, text })
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
        .values({ noteId, text })
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

type NamedNote = { id: number; path: string; description: string };

/**
 * Resolves names to notes: exact path first, then aliases and titles.
 * Reads and writes share this so a note opened by alias is written under the same path.
 */
async function findNotesByName(names: string[]) {
  const wanted = names.map((name) => name.trim()).filter(Boolean);
  const found: NamedNote[] = [];
  const missing: string[] = [];
  if (!wanted.length) return { found, missing };

  const columns = {
    id: memoryNoteTable.id,
    path: memoryNoteTable.path,
    description: memoryNoteTable.description,
  };

  const exact = await database
    .select(columns)
    .from(memoryNoteTable)
    .where(inArray(memoryNoteTable.path, wanted));
  const byName = new Map<string, NamedNote>(
    exact.map((note) => [note.path.toLowerCase(), note]),
  );

  // Aliases are a JSON column, so the fallback scans the table once.
  if (wanted.some((name) => !byName.has(name.toLowerCase()))) {
    const rows = await database
      .select({ ...columns, aliases: memoryNoteTable.aliases })
      .from(memoryNoteTable);
    const put = (name: string, note: NamedNote) => {
      const key = name.trim().toLowerCase();
      if (key && !byName.has(key)) byName.set(key, note);
    };
    // Exact paths first so an alias cannot shadow another note's path.
    for (const row of rows) put(row.path, row);
    for (const row of rows) {
      put(row.path.slice(row.path.indexOf("/") + 1), row);
      for (const alias of row.aliases ?? []) put(alias, row);
    }
  }

  const seen = new Set<number>();
  for (const name of wanted) {
    const hit = byName.get(name.toLowerCase());
    if (!hit) {
      missing.push(name);
      continue;
    }
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    found.push(hit);
  }
  return { found, missing };
}

/** Path of the note a model-given name refers to, or null. */
export async function resolveNotePath(name: string): Promise<string | null> {
  const { found } = await findNotesByName([name]);
  return found[0]?.path ?? null;
}

export async function readNotes(
  names: string[],
  options: { touch?: boolean } = {},
): Promise<{ notes: MemoryNoteView[]; missing: string[] }> {
  const { found, missing } = await findNotesByName(names);
  if (!found.length) return { notes: [], missing };

  const ids = found.map((note) => note.id);
  const facts = await latestFacts(ids);

  if (options.touch !== false) {
    await database
      .update(memoryNoteTable)
      .set({ hits: sql`${memoryNoteTable.hits} + 1`, lastReadAt: new Date() })
      .where(inArray(memoryNoteTable.id, ids));
  }

  return {
    notes: found.map((note) => ({
      path: note.path,
      description: note.description,
      facts: facts
        .filter((fact) => fact.noteId === note.id)
        .map((fact) => ({ id: fact.id, text: fact.text })),
    })),
    missing,
  };
}

/** Facts differing only in whitespace, punctuation or case count as the same fact. */
export const sameFact = (text: string) =>
  text.toLowerCase().replace(/[\s.,!?…·'"`]/g, "");

/**
 * One transaction for the whole batch: a revision is retire + insert and must not
 * be split. Facts already present (sameFact) are skipped, not reinserted.
 */
export async function writeNotes(
  input: MemoryNoteWrite[],
): Promise<MemoryWrite> {
  const unnamed: string[] = [];
  const paths: string[] = [];
  // Facts that asked for alwaysLoad when no slot was free (still stored).
  const notLoaded: string[] = [];

  await serialize(() =>
    database.transaction(async (tx) => {
      // Free alwaysLoad slots (ALWAYS_LOADED_MAX), counted inside the transaction.
      const [loaded] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(memoryFactTable)
        .where(
          and(
            eq(memoryFactTable.alwaysLoad, true),
            eq(memoryFactTable.isLatest, true),
          ),
        );
      let room = ALWAYS_LOADED_MAX - Number(loaded?.count ?? 0);

      /** Claims an alwaysLoad slot; without one the fact is stored as ordinary. */
      const claim = (want: boolean, text: string) => {
        if (!want) return false;
        if (room > 0) {
          room -= 1;
          return true;
        }
        notLoaded.push(text);
        return false;
      };

      for (const entry of input) {
        const path = entry.path.trim();
        if (!path) continue;
        paths.push(path);

        const description = entry.description?.trim();
        const aliases = entry.aliases?.map((a) => a.trim()).filter(Boolean);
        const facts = (entry.facts ?? [])
          .map((fact) => ({ ...fact, text: fact.text.trim() }))
          .filter((fact) => fact.text);

        // Description and aliases replace, never merge; omitted fields stay untouched.
        const [existingNote] = await tx
          .select({ id: memoryNoteTable.id })
          .from(memoryNoteTable)
          .where(eq(memoryNoteTable.path, path));

        let noteId: number;
        if (existingNote) {
          noteId = existingNote.id;
          if (description || aliases) {
            await tx
              .update(memoryNoteTable)
              .set({
                ...(description ? { description } : {}),
                ...(aliases ? { aliases } : {}),
                updatedAt: new Date(),
              })
              .where(eq(memoryNoteTable.id, noteId));
          }
        } else {
          const [made] = await tx
            .insert(memoryNoteTable)
            .values({
              path,
              // Placeholder description; the caller is told via `unnamed`.
              description: description ?? facts[0]?.text.slice(0, 80) ?? path,
              ...(aliases ? { aliases } : {}),
            })
            .returning({ id: memoryNoteTable.id });
          noteId = made.id;
          if (!description) unnamed.push(path);
        }

        if (!facts.length) continue;

        const existing = await tx
          .select({
            id: memoryFactTable.id,
            text: memoryFactTable.text,
            alwaysLoad: memoryFactTable.alwaysLoad,
          })
          .from(memoryFactTable)
          .where(
            and(
              eq(memoryFactTable.noteId, noteId),
              eq(memoryFactTable.isLatest, true),
            ),
          );
        // Normalized text -> current row; kept current so duplicates within one call merge too.
        const known = new Map(existing.map((row) => [sameFact(row.text), row]));

        /** Toggles alwaysLoad on an existing row; the fact itself is unchanged. */
        const reload = async (
          row: { id: number; alwaysLoad: boolean },
          want: boolean,
          text: string,
        ) => {
          if (want === row.alwaysLoad) return;
          // Unloading frees a slot for later facts in the same write.
          const next = want ? claim(true, text) : ((room += 1), false);
          if (next === row.alwaysLoad) return;
          await tx
            .update(memoryFactTable)
            .set({ alwaysLoad: next })
            .where(eq(memoryFactTable.id, row.id));
          row.alwaysLoad = next;
        };

        for (const fact of facts) {
          if (fact.replaces != null) {
            const [target] = await tx
              .select({
                id: memoryFactTable.id,
                text: memoryFactTable.text,
                alwaysLoad: memoryFactTable.alwaysLoad,
              })
              .from(memoryFactTable)
              .where(
                and(
                  eq(memoryFactTable.id, fact.replaces),
                  eq(memoryFactTable.noteId, noteId),
                  eq(memoryFactTable.isLatest, true),
                ),
              );
            // An unknown id falls through and the fact is simply stored.
            if (target) {
              // Same text: only alwaysLoad changes, so no new version.
              if (sameFact(target.text) === sameFact(fact.text)) {
                await reload(
                  target,
                  fact.alwaysLoad ?? target.alwaysLoad,
                  fact.text,
                );
                known.set(sameFact(target.text), target);
                continue;
              }

              await tx
                .update(memoryFactTable)
                .set({ isLatest: false })
                .where(eq(memoryFactTable.id, target.id));
              known.delete(sameFact(target.text));
              // A retired alwaysLoad row frees its slot for the replacement.
              if (target.alwaysLoad) room += 1;

              // No duplicate check: this is a revision, not an addition.
              const [added] = await tx
                .insert(memoryFactTable)
                .values({
                  noteId,
                  text: fact.text,
                  alwaysLoad: claim(
                    fact.alwaysLoad ?? target.alwaysLoad,
                    fact.text,
                  ),
                })
                .returning({
                  id: memoryFactTable.id,
                  alwaysLoad: memoryFactTable.alwaysLoad,
                });
              known.set(sameFact(fact.text), { ...added, text: fact.text });
              continue;
            }
          }

          const seen = known.get(sameFact(fact.text));
          if (seen) {
            // Rewriting a known fact is a no-op unless it asks to change alwaysLoad.
            if (fact.alwaysLoad != null) {
              await reload(seen, fact.alwaysLoad, fact.text);
            }
            continue;
          }

          const [added] = await tx
            .insert(memoryFactTable)
            .values({
              noteId,
              text: fact.text,
              alwaysLoad: claim(fact.alwaysLoad === true, fact.text),
            })
            .returning({
              id: memoryFactTable.id,
              alwaysLoad: memoryFactTable.alwaysLoad,
            });
          known.set(sameFact(fact.text), { ...added, text: fact.text });
        }

        await tx
          .update(memoryNoteTable)
          .set({ updatedAt: new Date() })
          .where(eq(memoryNoteTable.id, noteId));
      }
    }),
  );

  // Re-read without touching hits: saving is not recall.
  const { notes } = await readNotes(paths, { touch: false });
  changed();
  return { notes, unnamed, notLoaded };
}

/** Facts loaded into every session. The limit is a safety net over the cap writeNotes enforces. */
export function listAlwaysLoaded(): Promise<MemoryAlwaysLoaded[]> {
  return database
    .select({
      id: memoryFactTable.id,
      path: memoryNoteTable.path,
      text: memoryFactTable.text,
    })
    .from(memoryFactTable)
    .innerJoin(memoryNoteTable, eq(memoryFactTable.noteId, memoryNoteTable.id))
    .where(
      and(
        eq(memoryFactTable.alwaysLoad, true),
        eq(memoryFactTable.isLatest, true),
      ),
    )
    .orderBy(asc(memoryNoteTable.path), asc(memoryFactTable.id))
    .limit(ALWAYS_LOADED_MAX);
}

/** Settings toggle for alwaysLoad; same cap as model writes, no new version. */
export async function setFactAlwaysLoad(
  noteId: number,
  factId: number,
  alwaysLoad: boolean,
): Promise<"ok" | "full" | "missing"> {
  const result = await serialize(() =>
    database.transaction(async (tx): Promise<"ok" | "full" | "missing"> => {
      if (alwaysLoad) {
        const [loaded] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(memoryFactTable)
          .where(
            and(
              eq(memoryFactTable.alwaysLoad, true),
              eq(memoryFactTable.isLatest, true),
            ),
          );
        if (Number(loaded?.count ?? 0) >= ALWAYS_LOADED_MAX) return "full";
      }

      const [row] = await tx
        .update(memoryFactTable)
        .set({ alwaysLoad })
        .where(
          and(
            eq(memoryFactTable.id, factId),
            eq(memoryFactTable.noteId, noteId),
            eq(memoryFactTable.isLatest, true),
          ),
        )
        .returning({ id: memoryFactTable.id });
      return row ? "ok" : "missing";
    }),
  );
  if (result === "ok") changed();
  return result;
}

/** Index for the system prompt: one line per note, no fact text, hottest first. */
export async function listNoteIndex() {
  const [notes, counts] = await Promise.all([
    database
      .select({
        id: memoryNoteTable.id,
        path: memoryNoteTable.path,
        description: memoryNoteTable.description,
        aliases: memoryNoteTable.aliases,
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
        aliases: note.aliases,
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

/** Facts written in a window, with their note: what a call already saved, so the tidy pass does not save it twice (memory.tidy). */
export function listFactsWrittenBetween(
  from: Date,
  to: Date,
): Promise<MemoryAlwaysLoaded[]> {
  return database
    .select({
      id: memoryFactTable.id,
      path: memoryNoteTable.path,
      text: memoryFactTable.text,
    })
    .from(memoryFactTable)
    .innerJoin(memoryNoteTable, eq(memoryFactTable.noteId, memoryNoteTable.id))
    .where(
      and(
        eq(memoryFactTable.isLatest, true),
        between(memoryFactTable.createdAt, from, to),
      ),
    )
    .orderBy(asc(memoryFactTable.id));
}

/** One current fact with its note path; null when gone. */
export async function findFactById(
  id: number,
): Promise<MemoryAlwaysLoaded | null> {
  const [fact] = await database
    .select({
      id: memoryFactTable.id,
      path: memoryNoteTable.path,
      text: memoryFactTable.text,
    })
    .from(memoryFactTable)
    .innerJoin(memoryNoteTable, eq(memoryFactTable.noteId, memoryNoteTable.id))
    .where(and(eq(memoryFactTable.id, id), eq(memoryFactTable.isLatest, true)));
  return fact ?? null;
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
