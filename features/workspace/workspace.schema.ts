import type { DateLike } from "@/lib/date-like";
import type { FileViewKind } from "./file-kind";

/**
 * What the Workspace section reads. A folder listing is the unit: the section
 * walks one folder at a time, the way the skill browser does.
 */

/** A folder row: listed whatever is inside it, so the disk it takes still reads. */
export type WorkspaceDir = {
  kind: "dir";
  name: string;
  /** Workspace-relative. */
  path: string;
  /** Everything under it, openable or not. */
  bytes: number;
};

/** A file row. Only kinds the app can open are listed (file-kind `viewKindOf`). */
export type WorkspaceFile = {
  kind: "file";
  name: string;
  path: string;
  bytes: number;
  /** Last written. */
  at: DateLike;
  /** How the screen opens it. */
  view: FileViewKind;
};

export type WorkspaceEntry = WorkspaceDir | WorkspaceFile;

/** What the whole workspace costs; the section's rail says it on every folder. */
export type WorkspaceUsage = {
  bytes: number;
  /** Files the app can open — never the number of files on disk. */
  openable: number;
};

/** One folder, plus the total: both change together, so they travel together. */
export type WorkspaceFolder = {
  /** Workspace-relative; "" is the root. */
  path: string;
  entries: WorkspaceEntry[];
  usage: WorkspaceUsage;
};
