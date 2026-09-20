import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { GIVEN_FILES, PATHS, WORKSPACE_VIEW } from "@/config";
import { listThreadFolders } from "@/features/bot/thread.query";
import { publicError } from "@/lib/public-error";
import { isListedFolder, viewKindOf } from "./file-kind";
import {
  insideWorkspace,
  jobScratch,
  openWorkspace,
  WORKSPACE,
} from "./workspace";
import type {
  FileOnDisk,
  WorkspaceEntry,
  WorkspaceFolder,
} from "./workspace.schema";

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

/**
 * Which of these workspace-relative paths name no file: a message can mention a
 * file that was never written or has since gone. A path that leaves the workspace
 * is not judged and never listed.
 */
export async function statFiles(paths: string[]): Promise<FileOnDisk[]> {
  const found = await Promise.all(
    paths.map(async (path) => {
      const full = await insideWorkspace(path);
      if (!full) return null;
      const info = await stat(full).catch(() => null);
      return info?.isFile() ? { path, bytes: info.size } : null;
    }),
  );
  return found.filter((file) => file !== null);
}

/**
 * Keeps files the user handed over under GIVEN_FILES.dir and says where, workspace-relative
 * and in order. A name is kept as close to its own as a path in a sentence allows — no
 * spaces, nothing a shell or the path pattern would trip on — and a name already taken
 * gets a number, since two hand-overs of `report.pdf` are two files.
 */
export async function keepGivenFiles(files: File[]): Promise<string[]> {
  // Through the workspace's own sandbox, as every other write into it goes
  const workspace = await openWorkspace();
  const taken = new Set(
    await readdir(join(WORKSPACE, GIVEN_FILES.dir)).catch(() => []),
  );
  const kept: string[] = [];
  for (const file of files) {
    const clean =
      file.name
        .normalize("NFC")
        .replace(/[^\p{L}\p{N}._-]+/gu, "-")
        .replace(/^[-.]+|-+$/g, "") || "file";
    const dot = clean.lastIndexOf(".");
    const stem = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : "";
    let name = clean;
    for (let n = 2; taken.has(name); n++) name = `${stem}-${n}${ext}`;
    taken.add(name);
    const rel = `${GIVEN_FILES.dir}/${name}`;
    await workspace.writeFile(rel, Buffer.from(await file.arrayBuffer()));
    kept.push(rel);
  }
  return kept;
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
 *
 * A job that is running, or waiting on an answer, keeps its own — this is the
 * button someone presses when the disk is full, and it would otherwise pull the
 * working material out from under a job mid-step. The sweep by age already makes
 * the same exception (bot.runner sweepJobFiles).
 */
export async function emptyScratch(): Promise<void> {
  const full = join(WORKSPACE, PATHS.scratch);
  const busy = new Set(
    (await listThreadFolders())
      .filter(
        (thread) => thread.status === "running" || thread.status === "waiting",
      )
      .map((thread) => jobScratch(thread.id, thread.label).split("/").pop()),
  );
  for (const entry of await readdir(full).catch(() => [])) {
    if (busy.has(entry)) continue;
    await rm(join(full, entry), { recursive: true, force: true });
  }
}
