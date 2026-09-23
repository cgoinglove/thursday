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
const custom = join(DATA_DIR, PATHS.skills.custom);

/** One bot's own skills, inside its folder: listed to that bot and no other runtime. */
export const ownSkills = (bot: string) =>
  join(WORKSPACE, botFolder(bot), PATHS.skills.own);

/**
 * Shipped first: a skill the app ships wins over any other of the same name, so a copy
 * of one kept in a bot's folder is never the one it opens. A bot's own come next, so its
 * copy of a workspace skill is the one it opens.
 */
export const loadSkills = async (sandbox: Sandbox, bot?: string) =>
  discoverSkills(
    sandbox,
    bot ? [shipped, ownSkills(bot), custom] : [shipped, custom],
    await readSkillsOff(),
  );

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
}

/** On a name collision the earlier directory wins; `off` are the names the user switched off. */
export async function discoverSkills(
  sandbox: Sandbox,
  directories: string[],
  off: Set<string> = new Set(),
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
