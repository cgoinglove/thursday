import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { APP_DIR, APP_NAME, DATA_DIR, PATHS } from "@/config";

/**
 * The app's guide for the person using it (`guide/`), which Thursday reads when an
 * answer depends on how the app works. Everything the code knows about it is in this
 * file. Five places reach it and nothing else may: boot installs it
 * (instrumentation-node), the call's backend prompt carries `guideLine`
 * (prompts/thursday.prompt), a bot's carries `botGuideLine` (prompts/bot.prompt),
 * scripts/pack ships the folder, and one assertion in scripts/live-session.test checks
 * the line. Removing the feature is this file, those five, the folder, and its lines in
 * AGENTS.md.
 */

/** Ships with the app. */
const SOURCE = join(APP_DIR, "guide");

/**
 * Inside the workspace, because the shell the call holds is rooted there and nothing
 * about the app's own folder is put in front of a model; a dot folder, so the
 * Workspace screen and file walks skip it.
 */
const FOLDER = ".guide";

/**
 * Copies this build's guide into the workspace, replacing what is there: the copy
 * always matches the build, and a bot that edited it changes nothing for long.
 */
export async function installGuide(): Promise<void> {
  if (!existsSync(SOURCE)) return;
  const to = join(DATA_DIR, PATHS.workspace, FOLDER);
  await rm(to, { recursive: true, force: true });
  await cp(SOURCE, to, { recursive: true });
}

/** What the call's backend is told about it, under its This computer chapter. */
export const guideLine = (): string =>
  `How ${APP_NAME} works for the person using it — its screens, its settings, what it connects to, what to do when something stops — is written under \`${FOLDER}/\` here, \`index.md\` first. Read it whenever an answer depends on how the app works: what can be asked for, where something is changed, a wish that needs a setting switched on, something that stopped or was refused. Answer from it rather than from what you assume.`;

/** What a bot is told about it: that it is there, for the rare job that is about the app. */
export const botGuideLine = (): string =>
  `How ${APP_NAME} itself works for the user — its screens and settings — is written under \`${FOLDER}/\` here, \`index.md\` first; read it only when the job is about the app.`;
