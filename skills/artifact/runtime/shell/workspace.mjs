// Where an artifact script works, found the same way by each of them: the workspace it runs
// in, the bot's folder of finished work there, the names a file may take, and the error a
// script stops on with a message the bot can act on.
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** A mistake the caller can fix: its message is printed, and the script exits 1. */
export class Stop extends Error {}

/** The app's workspace: the nearest folder above holding its fence and a `projects` folder. */
function findWorkspace() {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (
      existsSync(join(dir, "pnpm-workspace.yaml")) &&
      existsSync(join(dir, "projects"))
    )
      return dir;
    if (dir === dirname(dir)) return process.cwd();
  }
}

export const WORKSPACE = findWorkspace();

/**
 * The bot's finished work: `THURSDAY_ARTIFACTS` from its shell, from the workspace or whole.
 * Resolved, not joined: joined, a whole path landed nested inside the workspace.
 */
export const ARTIFACTS = resolve(
  WORKSPACE,
  process.env.THURSDAY_ARTIFACTS || "artifacts",
);

/** A path as the reader should type it: short from the workspace, whole from outside it. */
export const shown = (path) => {
  const near = relative(WORKSPACE, path);
  if (!near) return ".";
  return near.startsWith("..") ? path : near;
};

/** What a document, a canvas, a book or an app may be named. */
export const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u;
