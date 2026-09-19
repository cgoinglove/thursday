import { cp } from "node:fs/promises";
import { join } from "node:path";
import { APP_DIR, DATA_DIR, PATHS } from "@/config";
import { botFolder, WORKSPACE } from "@/features/workspace/workspace";
import { logger } from "@/lib/logger";
import type { Sandbox } from "@/lib/sandbox";
import { errorToString } from "@/lib/utils";
import { parseFrontmatter, runsHere } from "./skills.query";
import type { SkillFrontmatter } from "./skills.schema";

/** Skills for the prompt, every skill at once, without failing the session over one bad file. */

const shipped = join(APP_DIR, PATHS.skills.default);
const custom = join(DATA_DIR, PATHS.skills.custom);

/** One bot's own skills, inside its folder: listed to that bot and no other runtime. */
export const ownSkills = (bot: string) =>
  join(WORKSPACE, botFolder(bot), PATHS.skills.own);

/**
 * Shipped first: a skill the app ships wins over any other of the same name. A bot's
 * own come next, so its copy of a workspace skill is the one it opens.
 */
export const loadSkills = (sandbox: Sandbox, bot?: string) =>
  discoverSkills(
    sandbox,
    bot ? [shipped, ownSkills(bot), custom] : [shipped, custom],
  );

/**
 * Copies a seed's kit (config PATHS.skills.seeds) into the bot made from it. A seed
 * without one has nothing to copy; a skill already in the bot's folder is kept.
 */
export async function giveSeedSkills(seed: string, bot: string) {
  const kit = join(APP_DIR, PATHS.skills.seeds, seed.toLowerCase());
  await cp(kit, ownSkills(bot), {
    recursive: true,
    force: false,
  }).catch((cause: NodeJS.ErrnoException) => {
    if (cause.code !== "ENOENT") throw cause;
  });
}

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
}

/** On a name collision the earlier directory wins. */
export async function discoverSkills(
  sandbox: Sandbox,
  directories: string[],
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
      if (seenNames.has(frontmatter.name)) continue;
      seenNames.add(frontmatter.name);

      // A disabled skill still claims its name, so a same-named custom skill cannot replace it
      if (frontmatter.disabled) continue;

      skills.push({
        name: frontmatter.name,
        description: frontmatter.description,
        path: skillDir,
      });
    }
  }
  return skills;
}
