import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { APP_DIR, PATHS, REACH } from "@/config";
import { extensionOf } from "@/features/workspace/file-kind";
import { openWorkspace } from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import { PromiseChain } from "@/lib/utils";
import type { OutgoingFile } from "./channel";

/**
 * What a page looks like, for a chat that opens no HTML: pictures of it, sent with it. A
 * deck's slides and a canvas's boards are one picture each, at their own size; any other
 * page is read from the top, a phone's screen at a time. They are drawn by the renderer the
 * bots shoot with (skills/browser render.mjs), in a headless browser of their own that
 * keeps nothing and is closed once they are drawn.
 */

const RENDER = join(
  APP_DIR,
  PATHS.skills.default,
  "browser",
  "scripts",
  "render.mjs",
);

/**
 * The screen a page is read on: a phone's width at twice its pixels, so the words are
 * sharp on the phone that shows them. A desktop browser at that size rather than an
 * emulated phone, so a page lays out by its width alone.
 */
const PHONE = { viewport: { width: 412, height: 839 }, deviceScaleFactor: 2 };

/** One drawing at a time: they share one browser session, which each closes when done. */
const inTurn = PromiseChain();

/** Pictures of the file at `full` when it is a page; none for anything else, or when none can be drawn. */
export function picturesOf(full: string): Promise<OutgoingFile[]> {
  if (!["html", "htm"].includes(extensionOf(full))) return Promise.resolve([]);
  return inTurn(() => draw(full)).catch((cause) => {
    logger.warn(`reach: no pictures of ${basename(full)}`, cause);
    return [];
  });
}

async function draw(full: string): Promise<OutgoingFile[]> {
  const out = await mkdtemp(join(tmpdir(), "thursday-pictures-"));
  const config = join(out, "browser.json");
  await writeFile(
    config,
    JSON.stringify({ browser: { contextOptions: PHONE } }),
  );
  // Paths go in as variables, never spelled into the command: a file's name is a bot's choice
  const env = {
    PLAYWRIGHT_CLI_SESSION: "reach-pictures",
    PLAYWRIGHT_MCP_BROWSER: "chromium",
    PLAYWRIGHT_MCP_ISOLATED: "true",
    PLAYWRIGHT_MCP_CONFIG: config,
    RENDER,
    PAGE: full,
    OUT: out,
    NAME: basename(full, extname(full)),
  };
  const sandbox = await openWorkspace();
  try {
    const drawn = await sandbox.exec(
      `node "$RENDER" "$PAGE" --out "$OUT" --name "$NAME" --shot --most ${REACH.pictures}`,
      { env, timeoutMs: REACH.drawMs },
    );
    if (drawn.exitCode !== 0)
      throw new Error(drawn.stderr.trim().split("\n").at(-1) || "no pictures");
    const names = (await readdir(out))
      .filter((name) => name.endsWith(".png"))
      .sort();
    return await Promise.all(
      names.map(async (name) => ({
        bytes: await readFile(join(out, name)),
        name,
        picture: true,
      })),
    );
  } finally {
    await sandbox
      .exec("playwright-cli close", { env, timeoutMs: 15_000 })
      .catch(() => {});
    await rm(out, { recursive: true, force: true });
  }
}
