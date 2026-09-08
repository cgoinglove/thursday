import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const OPENER: Partial<
  Record<NodeJS.Platform, (path: string) => [file: string, args: string[]]>
> = {
  darwin: (path) => ["open", [path]],
  win32: (path) => ["cmd.exe", ["/c", "start", "", path]],
  linux: (path) => ["xdg-open", [path]],
};

export async function revealPath(path: string): Promise<void> {
  await access(path);

  const open = OPENER[process.platform]?.(path);
  if (!open) {
    throw new Error(`Opening files is not wired up on ${process.platform}.`);
  }

  const [file, args] = open;
  await promisify(execFile)(file, args, { windowsHide: true });
}
