import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { APP_DIR, DATA_DIR, PATHS } from "@/config";
import { botFolder, WORKSPACE } from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import type { Sandbox } from "@/lib/sandbox";
import { errorToString } from "@/lib/utils";
import {
  isSkillOff,
  parseFrontmatter,
  readSkillsOff,
  runsHere,
} from "./skills.query";
import type { SkillFrontmatter } from "./skills.schema";

/** Skills for the prompt, every skill at once, without failing the session over one bad file. */

const shipped = join(APP_DIR, PATHS.skills.default);
const seeds = join(APP_DIR, PATHS.skills.seeds);
const custom = join(DATA_DIR, PATHS.skills.custom);

/** One bot's own skills, inside its folder: listed to that bot and no other runtime. */
export const ownSkills = (bot: string) =>
  join(WORKSPACE, botFolder(bot), PATHS.skills.own);

/**
 * The skills a ready-made bot ships with (`seed-skills/<name>`), for the bot of that name: a
 * method only its trade needs, which every other bot would pay for on every step. Read where
 * it ships, so an update reaches it; a name with nothing there has none.
 */
export const seedSkills = (bot: string): string | null => {
  const key = bot.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]*$/.test(key) ? join(seeds, key) : null;
};

/**
 * Copies the app once made in a ready-made bot's folder and no longer ships there
 * (`seed-skills/retired.json`): one still byte for byte as shipped is not listed, so the bot
 * does not see an old copy beside what replaced it. One the user changed is theirs and stays.
 */
let retired: Promise<Map<string, Set<string>>> | undefined;
const readRetired = () =>
  (retired ??= readFile(join(seeds, "retired.json"), "utf8")
    .then((text) => {
      const { sha256 } = JSON.parse(text) as {
        sha256: Record<string, string[]>;
      };
      return new Map(
        Object.entries(sha256).map(([name, hashes]) => [name, new Set(hashes)]),
      );
    })
    .catch(() => new Map<string, Set<string>>()));

/**
 * Shipped first: a skill the app ships wins over any other of the same name, so a copy
 * of one kept in a bot's folder is never the one it opens. Then what its ready-made kit
 * ships (seedSkills), then the bot's own, so its copy of a workspace skill is the one it
 * opens.
 */
export const loadSkills = async (sandbox: Sandbox, bot?: string) => {
  const kit = bot ? seedSkills(bot) : null;
  return discoverSkills(
    sandbox,
    bot
      ? [shipped, ...(kit ? [kit] : []), ownSkills(bot), custom]
      : [shipped, custom],
    await readSkillsOff(),
    await readRetired(),
  );
};

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
}

/**
 * On a name collision the earlier directory wins; `off` are the names the user switched off,
 * and `retired` the copies of a skill the app no longer ships there (readRetired).
 */
export async function discoverSkills(
  sandbox: Sandbox,
  directories: string[],
  off: Set<string> = new Set(),
  retired: Map<string, Set<string>> = new Map(),
): Promise<SkillMetadata[]> {
  const skills: SkillMetadata[] = [];
  const seenNames = new Set<string>();

  for (const dir of directories) {
    let entries;
    try {
      entries = await sandbox.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // Skip directories that don't exist
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = `${dir}/${entry.name}`;
      const skillFile = `${skillDir}/SKILL.md`;

      let content: string;
      try {
        content = await sandbox.readFile(skillFile, "utf-8");
      } catch {
        continue; // A folder with no SKILL.md is not a skill
      }

      // Same parser as the settings screen; here a bad file is logged, not fatal
      let frontmatter: SkillFrontmatter;
      try {
        frontmatter = parseFrontmatter(content);
      } catch (cause) {
        logger.warn(
          `skill ${skillDir}: SKILL.md front matter did not load — ${errorToString(
            cause,
          )}`,
        );
        continue;
      }

      if (!runsHere(frontmatter)) continue;
      const stale = retired.get(frontmatter.name);
      if (
        stale?.has(createHash("sha256").update(content, "utf8").digest("hex"))
      )
        continue;
      if (seenNames.has(frontmatter.name)) continue;
      seenNames.add(frontmatter.name);

      // A skill switched off still claims its name, so a same-named custom skill cannot replace it
      if (isSkillOff(frontmatter, off)) continue;

      skills.push({
        name: frontmatter.name,
        description: frontmatter.description,
        path: skillDir,
      });
    }
  }
  return skills;
}
