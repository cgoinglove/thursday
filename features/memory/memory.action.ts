"use server";

import { z } from "zod";
import {
  addFact,
  createNote,
  deleteNote,
  forgetFact,
  reviseFact,
  updateNote,
} from "@/features/memory/memory.query";
import { isMemoryPath, NoteLineSchema } from "@/features/memory/memory.schema";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";

const PathSchema = z.string().trim().refine(isMemoryPath, "Invalid note path");

export const createNoteAction = serverAction(
  async (path: unknown, description: unknown, facts: string[] = []) => {
    const parsedPath = PathSchema.parse(path);
    const parsedDescription = NoteLineSchema.parse(description);

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
  async (id: number, patch: { description?: unknown }) => {
    const note = await updateNote(id, {
      ...(patch.description !== undefined
        ? { description: NoteLineSchema.parse(patch.description) }
        : {}),
    });
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
