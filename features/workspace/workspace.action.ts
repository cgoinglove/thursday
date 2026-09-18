"use server";

import { GIVEN_FILES } from "@/config";
import { openWorkspace } from "@/features/workspace/workspace";
import {
  deleteWorkspaceFile,
  emptyScratch,
  keepGivenFiles,
} from "@/features/workspace/workspace.query";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";
import { revealPath } from "@/lib/reveal-path";
import { errorToString } from "@/lib/utils";

/** Opens a workspace file in the machine's default app; relative paths resolve against the workspace. */
export const openFileAction = serverAction(async (path: string) => {
  const target = path.trim();
  if (!target) publicError("Which file?");
  const sandbox = await openWorkspace();
  const full = sandbox.resolve(target);
  try {
    await revealPath(full);
  } catch (cause) {
    publicError(`Could not open ${target}: ${errorToString(cause)}`);
  }
});

/** Deletes one file the bots wrote. The path is confined to the workspace by the query. */
export const deleteWorkspaceFileAction = serverAction(async (path: string) => {
  const target = path.trim();
  if (!target) publicError("Which file?");
  await deleteWorkspaceFile(target);
});

/** Empties `scratch/` — the one folder the bots are told is disposable. */
export const emptyScratchAction = serverAction(async () => {
  return emptyScratch();
});

/**
 * Takes files handed over from the screen (the write line, a drop on the window): form
 * field `file`, once per file. Answers their workspace-relative paths, in order.
 */
export const giveFilesAction = serverAction(async (form: unknown) => {
  if (!(form instanceof FormData)) publicError("No files came with that.");
  const files = form
    .getAll("file")
    .filter((one): one is File => one instanceof File && one.size > 0);
  if (!files.length) publicError("No files came with that.");
  if (files.length > GIVEN_FILES.perMessage)
    publicError(`At most ${GIVEN_FILES.perMessage} files at a time.`);
  const big = files.find((file) => file.size > GIVEN_FILES.maxBytes);
  if (big)
    publicError(
      `${big.name} is larger than ${Math.round(GIVEN_FILES.maxBytes / 1024 / 1024)} MB.`,
    );
  return keepGivenFiles(files);
});
