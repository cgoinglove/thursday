import type { DateLike } from "@/lib/date-like";
import type { FileViewKind } from "./file-kind";

/**
 * What the Workspace section reads. A folder listing is the unit: the section
 * walks one folder at a time, the way the skill browser does. Nothing here is
 * recursive — a folder's size is every file under it, and answering that on
 * every click is what a workspace with a `node_modules` in it cannot afford.
 */

/** A folder row: a door, not a measurement. `isListedFolder` decides which ones open. */
type WorkspaceDir = {
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

/**
 * One of the paths a message names, as it is on disk. A path with no file comes
 * back in no answer at all, which is how the screen knows to strike it through.
 */
export type FileOnDisk = {
  path: string;
  bytes: number;
};

/**
 * What keeping a page's edits came to: written, under the revision the page names from
 * now on, or refused because the file moved on after the page was opened ("" is a page
 * from before revisions, which names none).
 */
export type PageSave =
  /** `version` is the file's as the save left it (workspace.query readFileVersion): the screen that saved knows its own write. */
  { changed: false; revision: string; version: string } | { changed: true };

/**
 * A file as it is now (workspace.query readFileVersion): `version` changes with every write,
 * `revision` is what a page the shell dressed carries, null for anything else.
 */
export type FileVersion = { version: string; revision: string | null };

/** One folder. Its own rows and nothing about the rest of the tree. */
export type WorkspaceFolder = {
  /** Workspace-relative; "" is the root. */
  path: string;
  /** At most the limit asked for, folders first. */
  entries: WorkspaceEntry[];
  /** Everything the folder would list, so the rail can say what is not on screen. */
  total: number;
};
