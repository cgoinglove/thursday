import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import {
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { APP_DIR, GIVEN_FILES, PATHS, WORKSPACE_VIEW } from "@/config";
import { listThreadFolders } from "@/features/bot/thread.query";
import { publicError } from "@/lib/public-error";
import { isListedFile, isListedFolder, viewKindOf } from "./file-kind";
import {
  insideWorkspace,
  jobScratch,
  openWorkspace,
  WORKSPACE,
} from "./workspace";
import type {
  FileOnDisk,
  FileVersion,
  PageSave,
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
        : entry.isFile() && isListedFile(entry.name),
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
 * The revision a page names in its head, new on every write (skills/artifact/runtime/shell head.html and
 * put.mjs write it too). The first one is the head's: a body cannot reach the head.
 */
const REVISION = /<meta name="revision" content="([^"]*)">/;

/** A sheet's page names the .xlsx it shows (skills/artifact/runtime/sheet/sheet.html). */
const SHEET = /<meta name="sheet-xlsx" content="[0-9a-f]*"/;
const SHEET_SCRIPT = join(
  APP_DIR,
  PATHS.skills.default,
  "artifact",
  "scripts",
  "spreadsheet.mjs",
);
const run = promisify(execFile);

/**
 * The .xlsx beside a sheet's page written from the page as it was edited, and the page made to
 * name it (spreadsheet.mjs sync). False when the .xlsx was changed since the page drew it — in
 * Excel, or by a bot — which the page is told as it is told of a page written since.
 */
async function syncSheet(edited: string, page: string): Promise<boolean> {
  return run(process.execPath, [SHEET_SCRIPT, "sync", edited, "--page", page], {
    env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH ?? "" },
    maxBuffer: 4 * 1024 * 1024,
  }).then(
    () => true,
    (failed: { code?: number; stderr?: string }) => {
      if (failed.code === 3) return false;
      publicError(
        failed.stderr?.trim().split("\n").at(-1) ||
          "The Excel file could not be written.",
      );
    },
  );
}

/** How far into a page its revision is looked for: the shell's head puts it on the page's sixth line (runtime/shell/head.html). */
const REVISION_HEAD = 1024;

/**
 * A file as it is now, to tell whether it changed since a screen showed it: its size and
 * time, as the file route's ETag has them, and for a page the shell dressed, the revision
 * every write gives it — a bot's put or a reader's save (savePage) — which is how the page
 * itself tells its own save from someone else's write. Null when it is not there.
 */
export async function readFileVersion(
  rel: string,
): Promise<FileVersion | null> {
  const full = await insideWorkspace(rel);
  const info = full ? await stat(full).catch(() => null) : null;
  if (!full || !info?.isFile()) return null;
  let revision: string | null = null;
  if (/\.html?$/i.test(rel)) {
    const handle = await open(full);
    try {
      const head = Buffer.alloc(REVISION_HEAD);
      const { bytesRead } = await handle.read(head, 0, REVISION_HEAD, 0);
      revision =
        REVISION.exec(head.subarray(0, bytesRead).toString("utf8"))?.[1] ??
        null;
    } finally {
      await handle.close();
    }
  }
  return { version: versionOf(revision, info), revision };
}

/** One way to say a file's version, for a read and for the save that wrote it. */
const versionOf = (revision: string | null, info: Stats) =>
  `${revision ?? ""}:${info.size.toString(16)}-${info.mtimeMs.toString(16)}`;

/**
 * Writes a page a bot made back over itself, as its reader edited it where the app shows
 * it (skills/artifact/runtime/shell). Only a page that is there already: this keeps edits and never makes
 * a file. No larger than the viewer draws, since a page past that was never on screen to
 * be edited. Written beside the file and moved into place, so it is never half a page.
 *
 * `base` is the revision the page was opened at. A file that names another one was written
 * since — a bot put new work in, another window saved — and keeping this copy would undo
 * that, so it is refused and the page says so.
 */
export async function savePage(
  rel: string,
  html: string,
  base: string,
): Promise<PageSave> {
  if (!/\.html?$/i.test(rel)) publicError("Only a page keeps its own edits");
  const full = await insideWorkspace(rel);
  if (!full) publicError("Outside the workspace");
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) publicError("File not found");
  if (Buffer.byteLength(html) > WORKSPACE_VIEW.elementMax)
    publicError(
      `Larger than ${Math.round(WORKSPACE_VIEW.elementMax / 1024 / 1024)} MB`,
    );
  const onDisk = await readFile(full, "utf8");
  const now = REVISION.exec(onDisk)?.[1] ?? "";
  if (now !== base) return { changed: true };
  const revision = REVISION.test(html) ? randomBytes(6).toString("hex") : "";
  const kept = revision
    ? html.replace(REVISION, `<meta name="revision" content="${revision}">`)
    : html;
  // One per save: two tabs keeping one page at once must not write into one file
  const beside = `${full}.${crypto.randomUUID()}.saving`;
  try {
    await writeFile(beside, kept);
    if (SHEET.test(onDisk) && !(await syncSheet(beside, full))) {
      await rm(beside, { force: true });
      return { changed: true };
    }
    await rename(beside, full);
  } catch (error) {
    await rm(beside, { force: true });
    throw error;
  }
  return {
    changed: false,
    revision,
    version: versionOf(revision || null, await stat(full)),
  };
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
