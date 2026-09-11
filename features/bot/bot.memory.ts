import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { BOT_MEMORY_LISTED } from "@/config";
import { botFolder, WORKSPACE } from "@/features/workspace/workspace";

/**
 * A bot's own memory: files it keeps in its folder, one topic each, written and read with
 * its own shell. The disk is the only index — a file's first line is its listing line — so
 * keeping something is one write, and no list can fall out of step with the files.
 */

/** Workspace-relative, the way a prompt names it (config PATHS.bots). */
export const botMemoryFolder = (bot: string): string =>
  `${botFolder(bot)}/memory`;

export type BotMemory = {
  /** Newest first, at most BOT_MEMORY_LISTED. `line` is empty for a file with nothing in it. */
  entries: { file: string; line: string }[];
  /** Every file in the folder, listed or not. */
  total: number;
};

/** Enough of a file to find its first line in; the rest is the bot's to open. */
const HEAD_BYTES = 1024;

export async function listBotMemory(bot: string): Promise<BotMemory> {
  const dir = join(WORKSPACE, botMemoryFolder(bot));
  const names = await readdir(dir).catch(() => []);
  const found = await Promise.all(
    names
      .filter((name) => !name.startsWith("."))
      .map(async (name) => {
        const info = await stat(join(dir, name)).catch(() => null);
        return info?.isFile() ? { name, changed: info.mtimeMs } : null;
      }),
  );
  const files = found
    .filter((file) => file !== null)
    .sort((a, b) => b.changed - a.changed);
  const entries = await Promise.all(
    files.slice(0, BOT_MEMORY_LISTED).map(async ({ name }) => ({
      file: name,
      line: await firstLine(join(dir, name)),
    })),
  );
  return { entries, total: files.length };
}

/**
 * The line a file is listed by: its first, without a heading's `#`. A file that opens with
 * frontmatter anyway — a shape models are trained on — is listed by its `description`, or by
 * the first line after it.
 */
async function firstLine(path: string): Promise<string> {
  const handle = await open(path, "r").catch(() => null);
  if (!handle) return "";
  try {
    const head = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(head, 0, HEAD_BYTES, 0);
    const lines = head
      .toString("utf8", 0, bytesRead)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines[0] === "---") {
      const said = lines.find((line) => line.startsWith("description:"));
      if (said) {
        return said
          .slice("description:".length)
          .trim()
          .replace(/^["']|["']$/g, "");
      }
      const end = lines.indexOf("---", 1);
      return end > 0 ? (lines[end + 1] ?? "").replace(/^#+\s*/, "") : "";
    }
    return (lines[0] ?? "").replace(/^#+\s*/, "");
  } finally {
    await handle.close();
  }
}
