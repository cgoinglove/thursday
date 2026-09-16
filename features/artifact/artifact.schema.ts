import type { FileViewKind } from "@/features/workspace/file-kind";
import type { DateLike } from "@/lib/date-like";

/**
 * What the Artifacts section reads. One row per entry in a bot's folder,
 * `artifacts/<bot>/`, or loose at the top of `artifacts/`: a skill drops
 * `<name>.html`, a job that makes a set drops `<name>/`. So the folders are the
 * index — nothing records what an artifact is or who made it, because where it
 * is already says it.
 */

/** One file inside a set, or the artifact itself when it is a lone file. */
export type ArtifactFile = {
  /** Workspace-relative, under `artifacts/`. */
  path: string;
  name: string;
  bytes: number;
  at: DateLike;
  /** How the screen opens it (`file-kind`). */
  view: FileViewKind;
};

/** One row of the menu: a file the bot handed over, or a folder it filled. */
export type Artifact = {
  /** The file's own name, or the folder's. */
  name: string;
  path: string;
  /** The bot whose folder holds it; null when it sits loose at the top of `artifacts/`. */
  bot: string | null;
  /** Last written; the menu sorts and bands by this. */
  at: DateLike;
  /** A folder is a set — one row however many files are in it. */
  kind: "file" | "set";
  /** A lone file's size. A set says its count instead. */
  bytes: number;
  /** Files in the set; 1 for a lone file. */
  count: number;
  /** How a lone file opens. A set opens as its own sheet. */
  view: FileViewKind;
};

/** The menu, and what the rail says. */
export type ArtifactShelf = {
  entries: Artifact[];
  /** Every row, before the page limit. */
  total: number;
  /** Files across every row, so the rail counts what the rows hide. */
  files: number;
};

/** One set, opened. */
export type ArtifactSet = {
  path: string;
  name: string;
  files: ArtifactFile[];
  /** Files in the folder, before the page limit. */
  total: number;
};
