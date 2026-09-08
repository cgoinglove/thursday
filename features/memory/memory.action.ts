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
import { markEveryCallRead } from "@/features/thursday/thursday.query";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";
import { startTidy, stopTidy } from "./memory.tidy";
import { readTidyOn, writeTidyModel, writeTidyOn } from "./tidy.query";

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

// Reading calls back (memory.tidy): the switch, the model, and the two hands on it.

/** Switching on stamps every past call as read, so it starts from now rather than from the beginning of history. */
export const setMemoryTidyOnAction = serverAction(async (on: unknown) => {
  const wanted = z.boolean().parse(on);
  if (wanted && !(await readTidyOn())) await markEveryCallRead();
  await writeTidyOn(wanted);
  if (!wanted) await stopTidy("Switched off.");
});

/** `provider/model`, or empty for the app default. */
export const setMemoryTidyModelAction = serverAction(async (value: unknown) => {
  const said = z.string().trim().parse(value);
  if (!said) return writeTidyModel(null);
  const ref = parseTextModel(said);
  if (!ref) publicError("That is not a model this app can run.");
  await writeTidyModel(ref);
});

/** The screen's "Read now": skips the count, not the read itself. */
export const runMemoryTidyAction = serverAction(async () => {
  const outcome = await startTidy({ force: true });
  if (outcome === "off") publicError("Reading calls back is switched off.");
  if (outcome === "no-model") {
    publicError("Pick a model first — this does not run on the app default.");
  }
  if (outcome === "running") publicError("It is already reading.");
  if (outcome === "nothing") publicError("Every call has been read back.");
});

export const cancelMemoryTidyAction = serverAction(async () => {
  await stopTidy("Cancelled.");
});
