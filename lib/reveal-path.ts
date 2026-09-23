import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

type Command = (path: string) => [file: string, args: string[]];

/** The program this computer uses for a file; for a folder, its file manager. */
const OPENER: Partial<Record<NodeJS.Platform, Command>> = {
  darwin: (path) => ["open", [path]],
  win32: (path) => ["cmd.exe", ["/c", "start", "", path]],
  linux: (path) => ["xdg-open", [path]],
};

/** The file manager with the file picked in its folder. Linux has no one way to pick it, so its folder opens. */
const REVEALER: Partial<Record<NodeJS.Platform, Command>> = {
  darwin: (path) => ["open", ["-R", path]],
  win32: (path) => ["explorer.exe", [`/select,${path}`]],
  linux: (path) => ["xdg-open", [dirname(path)]],
};

/** Opens a file in the program this computer uses for it, or a folder in the file manager. */
export async function openPath(path: string): Promise<void> {
  await access(path);
  await run(OPENER, path);
}

/** Shows a file picked in its folder, in the file manager; a folder simply opens. */
export async function revealPath(path: string): Promise<void> {
  const info = await stat(path);
  await run(info.isDirectory() ? OPENER : REVEALER, path);
}

async function run(commands: typeof OPENER, path: string): Promise<void> {
  const command = commands[process.platform]?.(path);
  if (!command) {
    throw new Error(`Opening files is not wired up on ${process.platform}.`);
  }
  const [file, args] = command;
  await promisify(execFile)(file, args, { windowsHide: true }).catch(
    (cause) => {
      // explorer.exe exits with 1 even when it did what it was asked
      if (file !== "explorer.exe") throw cause;
    },
  );
}
