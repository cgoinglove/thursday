"use server";

import { z } from "zod";
import { MEMORY_LIMITS } from "@/config";
import {
  addFact,
  createNote,
  deleteNote,
  forgetFact,
  reviseFact,
  setFactAlwaysLoad,
  updateNote,
} from "@/features/memory/memory.query";
import { isMemoryPath } from "@/features/memory/memory.schema";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";

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
        `Only ${MEMORY_LIMITS.carried} facts can be carried into every call — drop one first`,
      );
    }
    if (result === "missing") publicError("Fact not found");
  },
);
