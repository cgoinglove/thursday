import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { PATHS, WORKSPACE_VIEW } from "@/config";
import { publicError } from "@/lib/public-error";
import { isListedFolder, viewKindOf } from "./file-kind";
import { insideWorkspace, WORKSPACE } from "./workspace";
import type { WorkspaceEntry, WorkspaceFolder } from "./workspace.schema";

/**
 * Reading what the bots left behind. The section is for opening artifacts, so
 * it costs what one page of one folder costs: a `readdir`, plus a `stat` for
 * each file actually returned. Nothing descends and nothing sums — a folder's
 * size is every file under it, and a workspace with a `node_modules` in it
 * makes that walk tens of thousands of stats on every click. `du` questions go
 * to Reveal folder.
 */

/** One folder's rows, at most `limit` of them. `rel` "" is the root. */
export async function readWorkspaceFolder(
  rel: string,
  limit = WORKSPACE_VIEW.rows,
): Promise<WorkspaceFolder> {
  const full = await insideWorkspace(rel);
  if (!full) publicError("Outside the workspace");

  // readdir on a file is ENOTDIR, so this covers "gone" and "not a folder" both
  const listing = await readdir(full, { withFileTypes: true }).catch(
    () => null,
  );
  if (!listing) publicError("No such folder");

  // What is listed is decided from the name alone, so the count below is the
  // whole folder even though only one page of it is read off the disk.
  const listed = listing
    .filter((entry) =>
      entry.isDirectory()
        ? isListedFolder(entry.name)
        : entry.isFile() && viewKindOf(entry.name) !== "none",
    )
    // Folders first, then files, each alphabetical — the skill browser's order.
    .sort(
      (a, b) =>
        Number(a.isFile()) - Number(b.isFile()) || a.name.localeCompare(b.name),
    );

  const rows = await Promise.all(
    listed
      .slice(0, limit)
      .map(async (entry): Promise<WorkspaceEntry | null> => {
        const path = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return { kind: "dir", name: entry.name, path };
        const info = await stat(join(full, entry.name)).catch(() => null);
        if (!info) return null;
        return {
          kind: "file",
          name: entry.name,
          path,
          bytes: info.size,
          at: info.mtime,
          view: viewKindOf(entry.name),
        };
      }),
  );

  return {
    path: rel,
    entries: rows.filter((row) => row !== null),
    total: listed.length,
  };
}

/** Deletes one file. Folders are refused: a whole tree goes through `emptyScratch`. */
export async function deleteWorkspaceFile(rel: string): Promise<void> {
  const full = await insideWorkspace(rel);
  if (!full) publicError("Outside the workspace");
  const info = await stat(full).catch(() => null);
  if (!info) publicError("File not found");
  if (!info.isFile()) publicError("That is a folder, not a file");
  await rm(full);
}

/**
 * Empties `scratch/`, the folder the bots are told is for work in progress
 * (bot.prompt). The folder itself stays: `openWorkspace` expects the three.
 */
export async function emptyScratch(): Promise<void> {
  const full = join(WORKSPACE, PATHS.scratch);
  for (const entry of await readdir(full).catch(() => [])) {
    await rm(join(full, entry), { recursive: true, force: true });
  }
}
