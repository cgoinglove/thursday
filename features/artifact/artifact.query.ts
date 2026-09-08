import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACT_VIEW, PATHS } from "@/config";
import { isListedFolder, viewKindOf } from "@/features/workspace/file-kind";
import { ARTIFACTS, insideWorkspace } from "@/features/workspace/workspace";
import { publicError } from "@/lib/public-error";
import type {
  Artifact,
  ArtifactFile,
  ArtifactSet,
  ArtifactShelf,
} from "./artifact.schema";

/**
 * Finished work, the way the bots already file it: one entry at the top of
 * `artifacts/` is one artifact. A skill writes `artifacts/<name>.html`, a job
 * that makes a set writes `artifacts/<name>/` — so the folder is the index and
 * nothing has to be recorded anywhere.
 *
 * Nothing here descends past the row it draws. The menu reads one folder; a set
 * reads its own when it is opened. There is no walk and no total, for the same
 * reason as Workspace: a folder's size is every file under it.
 */

const relative = (name: string) => `${PATHS.artifacts}/${name}`;

/** A file row, from one `stat`. Null when it is gone or the app cannot open it. */
async function fileAt(
  dir: string,
  path: string,
  name: string,
): Promise<ArtifactFile | null> {
  const view = viewKindOf(name);
  if (view === "none") return null;
  const info = await stat(join(dir, name)).catch(() => null);
  if (!info?.isFile()) return null;
  return { path, name, bytes: info.size, at: info.mtime, view };
}

/**
 * The menu: what sits at the top of `artifacts/`, newest first. A folder costs
 * one `stat` for its date and one `readdir` for its count — never a descent,
 * so a set of thirty and a set of thirty thousand cost the same.
 */
export async function readShelf(
  limit = ARTIFACT_VIEW.rows,
): Promise<ArtifactShelf> {
  const listing = await readdir(ARTIFACTS, { withFileTypes: true }).catch(
    () => [],
  );

  const rows = await Promise.all(
    listing.map(async (entry): Promise<Artifact | null> => {
      const path = relative(entry.name);

      if (entry.isDirectory()) {
        if (!isListedFolder(entry.name)) return null;
        const full = join(ARTIFACTS, entry.name);
        const [info, inside] = await Promise.all([
          stat(full).catch(() => null),
          readdir(full, { withFileTypes: true }).catch(() => []),
        ]);
        // Counted the way the sheet draws them, or the row promises more than it opens
        const count = inside.filter(
          (child) => child.isFile() && viewKindOf(child.name) !== "none",
        ).length;
        if (!info || count === 0) return null;
        return {
          name: entry.name,
          path,
          at: info.mtime,
          kind: "set",
          bytes: 0,
          count,
          view: "none",
        };
      }

      if (!entry.isFile()) return null;
      const file = await fileAt(ARTIFACTS, path, entry.name);
      return (
        file && {
          name: file.name,
          path: file.path,
          at: file.at,
          kind: "file",
          bytes: file.bytes,
          count: 1,
          view: file.view,
        }
      );
    }),
  );

  // Newest first: the thing a bot just handed over is the thing being looked for.
  const entries = rows
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
  name: string,
  limit = ARTIFACT_VIEW.setFiles,
): Promise<ArtifactSet> {
  const path = relative(name);
  const full = await insideWorkspace(path);
  if (!full) publicError("Outside the workspace");

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
    name,
    files: files.slice(0, limit),
    total: files.length,
  };
}

/** Deletes one artifact file. A whole set goes one file at a time, or through Workspace. */
export async function deleteArtifact(path: string): Promise<void> {
  if (!path.startsWith(`${PATHS.artifacts}/`)) publicError("Not an artifact");
  const full = await insideWorkspace(path);
  if (!full) publicError("Outside the workspace");
  const info = await stat(full).catch(() => null);
  if (!info) publicError("File not found");
  if (!info.isFile()) publicError("That is a folder, not a file");
  await rm(full);
}
