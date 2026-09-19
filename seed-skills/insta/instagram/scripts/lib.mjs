import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A script shipped with the app, by its path under the skills folder
 * ("browser/scripts/session.mjs" drives this shell's own browser session). A bot's
 * shell names that folder in THURSDAY_SKILLS.
 */
export async function shipped(path) {
  const root = process.env.THURSDAY_SKILLS;
  if (!root) {
    process.stderr.write(
      "THURSDAY_SKILLS is not set: run this from a bot's shell in the app.\n",
    );
    process.exit(1);
  }
  return import(pathToFileURL(join(root, path)).href);
}

/** Local time, minutes precision: what a person reads, and what `--since` takes. */
export const stamp = (ms) => {
  if (!ms) return "?";
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const oneLine = (text, max) => {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
