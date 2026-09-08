"use server";

import { deleteArtifact } from "@/features/artifact/artifact.query";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";

/** Deletes one file a bot handed over. Reveal and open are workspace.action's. */
export const deleteArtifactAction = serverAction(async (path: string) => {
  const target = path.trim();
  if (!target) publicError("Which file?");
  await deleteArtifact(target);
});
