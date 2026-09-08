// Where the CLIs the app ships with actually are. Plain JavaScript and no app
// imports: this runs from `postinstall` and from the published `bin`, on a
// machine that has neither a build nor a TypeScript loader.

import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);

/** The checkout, or the installed package. */
export const ROOT = resolve(import.meta.dirname, "..");

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
