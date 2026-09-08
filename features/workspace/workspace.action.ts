"use server";

import { openWorkspace } from "@/features/workspace/workspace";
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
