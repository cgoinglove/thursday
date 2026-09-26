// Where the CLIs the app ships with actually are. Plain JavaScript and no app
// imports: this runs from the published `bin`, on a machine that has neither a
// build nor a TypeScript loader.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);

/** The checkout, or the installed package. */
export const ROOT = resolve(import.meta.dirname, "..");

/**
 * Where the copy that runs in the background is installed (background.mjs). Beside the
 * default data folder, so everything the app keeps on the computer is under one folder.
 */
export const PROGRAM = join(homedir(), ".thursday", "app");

/** The one copy with the dev script beside it; the package ships no `scripts`. */
export const isCheckout = (root) =>
  existsSync(join(root, "scripts", "dev.mts"));

/**
 * What this person types to run the app, for a line that tells them to run it again. Only a
 * global install puts `thursday` on the PATH: said to someone who ran `npx`, it is a command
 * they do not have. npx names itself in npm_lifecycle_event and unpacks into its `_npx` cache,
 * and the copy that runs in the background was put there from one.
 */
export function thursdayCommand() {
  // Written into the background job by the command that started it, which knew
  if (process.env.THURSDAY_COMMAND?.trim())
    return process.env.THURSDAY_COMMAND.trim();
  if (
    process.env.npm_lifecycle_event === "npx" ||
    ROOT.includes(`${sep}_npx${sep}`) ||
    ROOT.startsWith(`${PROGRAM}${sep}`)
  )
    return "npx thursday-agent";
  if (isCheckout(ROOT)) return "pnpm start";
  return "thursday";
}

/** A browser that will not open is not a failure. */
export function openBrowser(url) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  spawn(command, args, { stdio: "ignore" }).on("error", () => {});
}

/**
 * The `playwright-cli` entry, resolved rather than guessed: pnpm keeps it under
 * `.pnpm`, npm hoists it, npx puts it in a temp tree. Null when it is not
 * installed at all (`--ignore-scripts`, a pruned image).
 */
export function playwrightCli() {
  try {
    return require.resolve("@playwright/cli/playwright-cli.js");
  } catch {
    return null;
  }
}

/**
 * Directories appended to the shell every bot runs in (workspace.ts TOOL_PATH).
 * The app's own `.bin` covers a checkout; the one beside the resolved package
 * covers an npm install, where the bin lands next to the hoisting root.
 * Missing directories cost nothing in a PATH.
 */
export function toolPath() {
  const dirs = [join(ROOT, "node_modules", ".bin")];
  const cli = playwrightCli();
  // <root>/node_modules/@playwright/cli/x.js -> <root>/node_modules/.bin
  if (cli) dirs.push(resolve(dirname(cli), "..", "..", ".bin"));
  return [...new Set(dirs)];
}
