import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "@/config";
import { publicError } from "@/lib/public-error";
import { viewKindOf } from "./file-kind";
import { insideWorkspace, WORKSPACE } from "./workspace";
import type {
  WorkspaceEntry,
  WorkspaceFolder,
  WorkspaceUsage,
} from "./workspace.schema";

/**
 * Reading what the bots left behind. Two rules the whole section rests on:
 * only files the app can open are listed (a bot writes node_modules, browser
 * snapshots and spilled tool output too), and every folder is listed whatever
 * is inside it, carrying what it takes on disk. So the listing and the disk
 * number answer different questions, and the rail says both.
 */

/** Bytes and openable files under one folder. Walks; the workspace is local and small. */
async function measure(full: string): Promise<WorkspaceUsage> {
  let bytes = 0;
  let openable = 0;
  const entries = await readdir(full, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = join(full, entry.name);
    if (entry.isDirectory()) {
      const under = await measure(child);
      bytes += under.bytes;
      openable += under.openable;
    } else if (entry.isFile()) {
      const info = await stat(child).catch(() => null);
      if (!info) continue;
      bytes += info.size;
      if (viewKindOf(entry.name) !== "none") openable += 1;
    }
  }
  return { bytes, openable };
}

export function readWorkspaceUsage(): Promise<WorkspaceUsage> {
  return measure(WORKSPACE);
}

/** One folder's rows, and what the whole workspace costs. `rel` "" is the root. */
export async function readWorkspaceFolder(
  rel: string,
): Promise<WorkspaceFolder> {
  const full = await insideWorkspace(rel);
  if (!full) publicError("Outside the workspace");

  const info = await stat(full).catch(() => null);
  if (!info?.isDirectory()) publicError("No such folder");

  const entries: WorkspaceEntry[] = [];
  for (const entry of await readdir(full, { withFileTypes: true })) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const { bytes } = await measure(join(full, entry.name));
      entries.push({ kind: "dir", name: entry.name, path, bytes });
      continue;
    }
    if (!entry.isFile()) continue;
    const view = viewKindOf(entry.name);
    if (view === "none") continue;
    const stats = await stat(join(full, entry.name)).catch(() => null);
    if (!stats) continue;
    entries.push({
      kind: "file",
      name: entry.name,
      path,
      bytes: stats.size,
      at: stats.mtime,
      view,
    });
  }

  // Folders first, then files, each alphabetical — the skill browser's order.
  entries.sort(
    (a, b) =>
      Number(a.kind === "file") - Number(b.kind === "file") ||
      a.name.localeCompare(b.name),
  );

  return { path: rel, entries, usage: await readWorkspaceUsage() };
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
export async function emptyScratch(): Promise<WorkspaceUsage> {
  const full = join(WORKSPACE, PATHS.scratch);
  const freed = await measure(full).catch(() => ({ bytes: 0, openable: 0 }));
  for (const entry of await readdir(full).catch(() => [])) {
    await rm(join(full, entry), { recursive: true, force: true });
  }
  return freed;
}
