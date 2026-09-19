import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appEvents } from "@/app/api/events/app-event.server";
import { DATA_DIR, PATHS } from "@/config";
import { WORKSPACE } from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import { type SignIn, siteOf } from "./signins.schema";

/**
 * The vault: one file per site under the data folder, outside the workspace the bots work
 * in, so no bot comes across another's session among its files. It is a place, not a lock —
 * a bot's shell is not confined — and what it buys is that a session reaches a browser only
 * through the app, which asks the list below first. A file holds the record and the
 * browser's storage state together, so signing out is removing one file.
 */
// Dot-prefixed like the workspace, so in a checkout it never reads as part of the app
const VAULT = join(DATA_DIR, PATHS.signIns);

type Kept = SignIn & { state: unknown };

const fileOf = (site: string) =>
  join(VAULT, `${encodeURIComponent(siteOf(site))}.json`);

const changed = () => appEvents.emit({ type: "signins" });

async function read(site: string): Promise<Kept | null> {
  try {
    return JSON.parse(await readFile(fileOf(site), "utf8")) as Kept;
  } catch {
    return null;
  }
}

async function write(kept: Kept) {
  await mkdir(VAULT, { recursive: true });
  // Owner-only: the session signs in as them
  await writeFile(fileOf(kept.site), JSON.stringify(kept), { mode: 0o600 });
  changed();
}

const record = ({ state: _state, ...signIn }: Kept): SignIn => signIn;

export async function listSignIns(): Promise<SignIn[]> {
  const names = await readdir(VAULT).catch(() => [] as string[]);
  const all = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map((name) => read(decodeURIComponent(name.slice(0, -5)))),
  );
  return all
    .flatMap((kept) => (kept ? [record(kept)] : []))
    .sort((a, b) => a.site.localeCompare(b.site));
}

/** Keeps what `bot`'s browser holds for `site`. The bot that kept it may borrow it; whoever could before still can. */
export async function keepSignIn(input: {
  site: string;
  account: string;
  bot: string;
  state: unknown;
}): Promise<SignIn> {
  const site = siteOf(input.site);
  const before = await read(site);
  const kept: Kept = {
    site,
    account: input.account.trim() || site,
    bots: [...new Set([...(before?.bots ?? []), input.bot])],
    asking: (before?.asking ?? []).filter((bot) => bot !== input.bot),
    keptAt: new Date().toISOString(),
    usedAt: before?.usedAt ?? null,
    state: input.state,
  };
  await write(kept);
  return record(kept);
}

/**
 * What `bot` gets when it asks for `site`: the state when it may borrow it, else why not —
 * nothing is kept, or the user has not let this bot in, which is noted so the screen can
 * offer the one tap.
 */
export async function borrowSignIn(
  site: string,
  bot: string,
): Promise<
  | { kind: "state"; signIn: SignIn; state: unknown }
  | { kind: "none"; kept: string[] }
  | { kind: "ask"; signIn: SignIn }
> {
  const kept = await read(site);
  if (!kept)
    return { kind: "none", kept: (await listSignIns()).map((one) => one.site) };
  if (!kept.bots.includes(bot)) {
    if (!kept.asking.includes(bot))
      await write({ ...kept, asking: [...kept.asking, bot] });
    return { kind: "ask", signIn: record(kept) };
  }
  const used = { ...kept, usedAt: new Date().toISOString() };
  await write(used);
  return { kind: "state", signIn: record(used), state: kept.state };
}

/** The user's say on one bot: let in, or not any more. Only the screen calls this. */
export async function setSignInBot(site: string, bot: string, on: boolean) {
  const kept = await read(site);
  if (!kept) return;
  await write({
    ...kept,
    bots: on
      ? [...new Set([...kept.bots, bot])]
      : kept.bots.filter((one) => one !== bot),
    asking: kept.asking.filter((one) => one !== bot),
  });
}

/** Signs out as far as the app can: what is kept goes. The site may still list the session. */
export async function removeSignIn(site: string) {
  await rm(fileOf(site), { force: true });
  changed();
}

/**
 * Sessions bots kept in their own folders before the vault (`bots/<name>/.auth/*.json`, as
 * the browser skill used to say) are taken in under the file's name and removed from the
 * workspace, where every bot's shell could read them. Once, at boot; nothing to do after.
 */
export async function adoptKeptSessions(): Promise<void> {
  const root = join(WORKSPACE, PATHS.bots);
  for (const bot of await readdir(root).catch(() => [] as string[])) {
    const folder = join(root, bot, ".auth");
    for (const name of await readdir(folder).catch(() => [] as string[])) {
      if (!name.endsWith(".json")) continue;
      const path = join(folder, name);
      try {
        const state = JSON.parse(await readFile(path, "utf8")) as unknown;
        const site = name.slice(0, -5);
        const account = (
          await readFile(join(folder, "account.txt"), "utf8").catch(() => "")
        ).trim();
        await keepSignIn({ site, account, bot, state });
        await rm(path);
        logger.info(`sign-ins: took in ${bot}'s ${site}`);
      } catch (cause) {
        logger.warn(`sign-ins: could not take in ${path}`, cause);
      }
    }
  }
}
