"use server";

import { z } from "zod";
import { parseTextModel } from "@/features/ai/model.schema";
import {
  addFact,
  createNote,
  deleteNote,
  forgetFact,
  reviseFact,
  setFactAlwaysLoad,
  updateNote,
} from "@/features/memory/memory.query";
import {
  ALWAYS_LOADED_MAX,
  isMemoryPath,
} from "@/features/memory/memory.schema";
import { stampCallsTidied } from "@/features/thursday/thursday.query";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";
import { MemoryTidyLevelSchema } from "./memory.schema";
import { startTidy, stopTidy } from "./memory.tidy";
import { readTidyLevel, writeTidyLevel, writeTidyModel } from "./tidy.query";

const PathSchema = z.string().trim().refine(isMemoryPath, "Invalid note path");

export const createNoteAction = serverAction(
  async (path: unknown, description: unknown, facts: string[] = []) => {
    const parsedPath = PathSchema.parse(path);
    const parsedDescription = z.string().min(1).parse(description);

    // Typed by hand, so user-owned: never auto-deleted when empty.
    const note = await createNote(parsedPath, parsedDescription, {
      ownedByUser: true,
    });
    if (!note) publicError("Note already exists");

    for (const text of facts.map((f) => f.trim()).filter(Boolean)) {
      await addFact(note.id, text);
    }
    return { id: note.id };
  },
);

export const updateNoteAction = serverAction(
  async (id: number, patch: { description?: string }) => {
    const note = await updateNote(id, patch);
    if (!note) publicError("Note not found");
  },
);

export const deleteNoteAction = serverAction(async (id: number) => {
  if (!(await deleteNote(id))) publicError("Note not found");
});

/** One fact per line. */
export const addFactsAction = serverAction(
  async (noteId: number, texts: string[]) => {
    const lines = texts.map((text) => text.trim()).filter(Boolean);
    if (lines.length === 0) publicError("Fact text is required");
    for (const line of lines) {
      await addFact(noteId, line);
    }
    return { added: lines.length };
  },
);

export const reviseFactAction = serverAction(
  async (noteId: number, factId: number, text: string) => {
    if (!text.trim()) publicError("Fact text is required");
    const fact = await reviseFact(noteId, factId, text.trim());
    if (!fact) publicError("Fact not found");
  },
);

export const forgetFactAction = serverAction(
  async (noteId: number, factId: number) => {
    if (!(await forgetFact(noteId, factId))) publicError("Fact not found");
  },
);

/** The cap is enforced in memory.query, same as for model writes. */
export const setFactAlwaysLoadAction = serverAction(
  async (noteId: number, factId: number, alwaysLoad: boolean) => {
    const result = await setFactAlwaysLoad(noteId, factId, alwaysLoad);
    if (result === "full") {
      publicError(
        `Only ${ALWAYS_LOADED_MAX} facts can be carried into every call — drop one first`,
      );
    }
    if (result === "missing") publicError("Fact not found");
  },
);

// The tidy pass (memory.tidy): its two settings and the two hands on it.

/** Switching on stamps every past call as read, so the pass starts from now rather than the beginning of history. */
export const setMemoryTidyLevelAction = serverAction(async (level: unknown) => {
  const parsed = MemoryTidyLevelSchema.parse(level);
  const before = await readTidyLevel();
  if (before === "off" && parsed !== "off") await stampCallsTidied();
  await writeTidyLevel(parsed);
  if (parsed === "off") await stopTidy("Switched off.");
});

/** `provider/model`, or empty for the app default. */
export const setMemoryTidyModelAction = serverAction(async (value: unknown) => {
  const said = z.string().trim().parse(value);
  if (!said) return writeTidyModel(null);
  const ref = parseTextModel(said);
  if (!ref) publicError("That is not a model this app can run.");
  await writeTidyModel(ref);
});

/** What the screen's "tidy now" does; the size and quiet checks are skipped, not the pass itself. */
export const runMemoryTidyAction = serverAction(async () => {
  const outcome = await startTidy({ force: true });
  if (outcome === "off") publicError("Tidying is off — pick a level first.");
  if (outcome === "running") publicError("A pass is already running.");
  if (outcome === "nothing") publicError("Every call has been read.");
});

export const cancelMemoryTidyAction = serverAction(async () => {
  await stopTidy("Cancelled.");
});
