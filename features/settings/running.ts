import { homedir } from "node:os";
import { sep } from "node:path";
import { DATA_DIR } from "@/config";

/**
 * Where this server runs, as the starter that spawned it said (bin/thursday.mjs): in the
 * background under launchd, in a terminal, from source with `pnpm dev`, or started by something
 * else. The app only says so and names the command; it never moves or stops itself.
 */
export type Running = {
  where: "background" | "terminal" | "source" | "elsewhere";
  /** Running in the background is macOS only for now (bin/background.mjs). */
  mac: boolean;
  /** What the person types to run it — `npx thursday-agent`, `thursday` or `pnpm start`. */
  command: string | null;
  /**
   * The line that moves this data folder to the background, `--home` included when it is not
   * the one the command finds by itself (bin/tools.mjs commandFor).
   */
  start: string | null;
  /** The data folder, the home folder written as `~`. */
  home: string;
};

export function readRunning(): Running {
  const said = process.env.THURSDAY_RUNS;
  const where =
    said === "background" || said === "terminal" || said === "elsewhere"
      ? said
      : // `pnpm dev` starts Next itself, with no starter to say
        process.env.NODE_ENV === "production"
        ? "elsewhere"
        : "source";
  const home = homedir();
  return {
    where,
    mac: process.platform === "darwin",
    command: process.env.THURSDAY_COMMAND?.trim() || null,
    start: process.env.THURSDAY_START?.trim() || null,
    home:
      DATA_DIR === home || DATA_DIR.startsWith(`${home}${sep}`)
        ? `~${DATA_DIR.slice(home.length)}`
        : DATA_DIR,
  };
}
