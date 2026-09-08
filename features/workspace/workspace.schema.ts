import type { DateLike } from "@/lib/date-like";
import type { FileViewKind } from "./file-kind";

/**
 * What the Workspace section reads. A folder listing is the unit: the section
 * walks one folder at a time, the way the skill browser does. Nothing here is
 * recursive — a folder's size is every file under it, and answering that on
 * every click is what a workspace with a `node_modules` in it cannot afford.
 */

/** A folder row: a door, not a measurement. `isListedFolder` decides which ones open. */
export type WorkspaceDir = {
  kind: "dir";
  name: string;
  /** Workspace-relative. */
  path: string;
};

/** A file row. Only kinds the app can open are listed (file-kind `viewKindOf`). */
export type WorkspaceFile = {
  kind: "file";
  name: string;
  path: string;
  /** One `stat`, so it costs the same whatever the file weighs. */
  bytes: number;
  /** Last written. */
  at: DateLike;
  /** How the screen opens it. */
  view: FileViewKind;
};

export type WorkspaceEntry = WorkspaceDir | WorkspaceFile;

/** One folder. Its own rows and nothing about the rest of the tree. */
export type WorkspaceFolder = {
  /** Workspace-relative; "" is the root. */
  path: string;
  /** At most the limit asked for, folders first. */
  entries: WorkspaceEntry[];
  /** Everything the folder would list, so the rail can say what is not on screen. */
  total: number;
};
