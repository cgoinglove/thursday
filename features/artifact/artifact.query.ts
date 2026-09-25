import type { Dirent } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { ARTIFACT_VIEW, PATHS } from "@/config";
import { listBotNames } from "@/features/bot/bot.query";
import {
  isListedFile,
  isListedFolder,
  viewKindOf,
} from "@/features/workspace/file-kind";
import {
  ARTIFACTS,
  botFolderName,
  DELETED_BOT_MARK,
  insideWorkspace,
} from "@/features/workspace/workspace";
import { publicError } from "@/lib/public-error";
import type {
  Artifact,
  ArtifactFile,
  ArtifactSet,
  ArtifactShelf,
} from "./artifact.schema";

/**
 * Finished work, the way the bots file it: each bot writes into its own folder,
 * `artifacts/<bot>/`, and one entry there — a file, or a folder of several — is
 * one artifact. What sits loose at the top of `artifacts/` (a bot's slip, or an
 * install from before bots had folders) is listed too, belonging to nobody. So
 * the folders are the index and nothing has to be recorded anywhere.
 *
 * Nothing here descends past the row it draws. The menu reads the top and each
 * bot's folder; a set reads its own when it is opened. There is no walk and no
 * total, for the same reason as Workspace: a folder's size is every file under it.
 */

/**
 * The absolute path, fenced to `artifacts/`. The fence is on the resolved path,
 * never on the string that was asked for: `insideWorkspace` normalizes `..`
 * away, so "artifacts/../scratch/x" passes any prefix test while opening a file
 * somewhere else entirely. What it answers is the real path, so the fence is
 * `artifacts/` resolved the same way: under a symlinked data folder (macOS's
 * `/var` and `/tmp` are both links) the path as configured refuses every file.
 */
async function insideArtifacts(path: string): Promise<string> {
  const [full, root] = await Promise.all([
    insideWorkspace(path),
    insideWorkspace(PATHS.artifacts),
  ]);
  if (!full || !root || !full.startsWith(root + sep))
    publicError("Not an artifact");
  return full;
}

/** A file row, from one `stat`. Null when it is gone or the app cannot open it. */
async function fileAt(
  dir: string,
  path: string,
  name: string,
): Promise<ArtifactFile | null> {
  if (!isListedFile(name)) return null;
  const view = viewKindOf(name);
  const info = await stat(join(dir, name)).catch(() => null);
  if (!info?.isFile()) return null;
  return { path, name, bytes: info.size, at: info.mtime, view };
}

/**
 * One row: a file, or a folder as a set. A folder costs one `stat` for its date
 * and one `readdir` for its count — never a descent, so a set of thirty and a
 * set of thirty thousand cost the same.
 */
async function entryAt(
  dir: string,
  base: string,
  entry: Dirent,
  bot: string | null,
): Promise<Artifact | null> {
  const path = `${base}/${entry.name}`;

  if (entry.isDirectory()) {
    if (!isListedFolder(entry.name)) return null;
    const full = join(dir, entry.name);
    const [info, inside] = await Promise.all([
      stat(full).catch(() => null),
      readdir(full, { withFileTypes: true }).catch(() => []),
    ]);
    // Counted the way the sheet draws them, or the row promises more than it opens
    const count = inside.filter(
      (child) => child.isFile() && isListedFile(child.name),
    ).length;
    if (!info || count === 0) return null;
    return {
      name: entry.name,
      path,
      bot,
      at: info.mtime,
      kind: "set",
      bytes: 0,
      count,
      view: "none",
    };
  }

  if (!entry.isFile()) return null;
  const file = await fileAt(dir, path, entry.name);
  return (
    file && {
      name: file.name,
      path: file.path,
      bot,
      at: file.at,
      kind: "file",
      bytes: file.bytes,
      count: 1,
      view: file.view,
    }
  );
}

/** Which bot a top-level folder belongs to, matched the way the folder was named (workspace.ts botFolderName). */
async function botsByFolder(): Promise<Map<string, string>> {
  const names = await listBotNames();
  return new Map(
    names.map((name) => [botFolderName(name).toLowerCase(), name]),
  );
}

/**
 * The bot a top-level folder was, when that bot was deleted (workspace removeBotFolder):
 * its folder is still a shelf of its work, not one set of the files at its top.
 */
async function deletedBotOf(dir: string): Promise<string | null> {
  try {
    const { bot } = JSON.parse(
      await readFile(join(dir, DELETED_BOT_MARK), "utf8"),
    ) as { bot?: unknown };
    return typeof bot === "string" && bot.trim() ? bot : null;
  } catch {
    return null;
  }
}

/**
 * The menu: every bot's entries and the loose ones, newest first. A bot's
 * folder is not a row of its own; its entries are, each carrying the bot.
 */
export async function readShelf(
  limit = ARTIFACT_VIEW.rows,
): Promise<ArtifactShelf> {
  const [listing, bots] = await Promise.all([
    readdir(ARTIFACTS, { withFileTypes: true }).catch(() => []),
    botsByFolder(),
  ]);

  const rows = await Promise.all(
    listing.map(async (entry) => {
      const dir = join(ARTIFACTS, entry.name);
      const bot = entry.isDirectory()
        ? (bots.get(entry.name.toLowerCase()) ?? (await deletedBotOf(dir)))
        : null;
      if (!bot) return [await entryAt(ARTIFACTS, PATHS.artifacts, entry, null)];

      const base = `${PATHS.artifacts}/${entry.name}`;
      const inside = await readdir(dir, { withFileTypes: true }).catch(
        () => [],
      );
      return Promise.all(inside.map((child) => entryAt(dir, base, child, bot)));
    }),
  );

  // Newest first: the thing a bot just handed over is the thing being looked for.
  const entries = rows
    .flat()
    .filter((row) => row !== null)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return {
    entries: entries.slice(0, limit),
    total: entries.length,
    files: entries.reduce((sum, entry) => sum + entry.count, 0),
  };
}

/** One set, opened: its files, newest first. Read only when the row is picked. */
export async function readSet(
  path: string,
  limit = ARTIFACT_VIEW.setFiles,
): Promise<ArtifactSet> {
  const full = await insideArtifacts(path);

  const listing = await readdir(full, { withFileTypes: true }).catch(
    () => null,
  );
  if (!listing) publicError("No such set");

  const rows = await Promise.all(
    listing
      .filter((entry) => entry.isFile())
      .map((entry) => fileAt(full, `${path}/${entry.name}`, entry.name)),
  );

  const files = rows
    .filter((row) => row !== null)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return {
    path,
    name: basename(path),
    files: files.slice(0, limit),
    total: files.length,
  };
}

/**
 * Deletes one artifact: a file, or a set with everything in it. A bot's whole
 * folder is not an artifact, so it is refused; its entries go one at a time.
 */
export async function deleteArtifact(path: string): Promise<void> {
  const full = await insideArtifacts(path);
  const info = await stat(full).catch(() => null);
  if (!info) publicError("Not found");
  if (info.isDirectory()) {
    // From artifacts/ resolved as `full` was: under a symlinked data folder the path as
    // configured is not a prefix of the real one, and every bot's folder would pass
    const root = await insideWorkspace(PATHS.artifacts);
    const inside = relative(root ?? ARTIFACTS, full);
    if (
      !inside.includes(sep) &&
      ((await botsByFolder()).has(inside.toLowerCase()) ||
        (await deletedBotOf(full)))
    )
      publicError("That is a bot's whole folder, not one artifact");
    await rm(full, { recursive: true });
    return;
  }
  await rm(full);
}
