"use server";

import { unzipSync } from "fflate";
import { z } from "zod";
import { SKILL_FILES } from "@/config";
import {
  deleteCustomSkill,
  parseFrontmatter,
  renderSkillMarkdown,
  setSkillOff,
  skillFolderName,
  writeCustomSkill,
  writeSkillFile,
} from "@/features/skills/skills.query";
import {
  SkillDraftSchema,
  SkillNameSchema,
  SkillSourceSchema,
  SkillUploadSchema,
} from "@/features/skills/skills.schema";
import { serverAction } from "@/lib/protocol/server-action";
import { publicError } from "@/lib/public-error";

/** name + description become the front matter; content is the body. */
export const createSkillAction = serverAction(async (draft: unknown) => {
  const { name, description, content } = SkillDraftSchema.parse(draft);
  const skill = await writeCustomSkill(
    name,
    new Map([
      ["SKILL.md", renderSkillMarkdown({ name, description }, content)],
    ]),
  );
  return skill;
});

/**
 * A lone `.md`, or a `.zip` / `.skill` archive containing a SKILL.md. The
 * folder holding SKILL.md becomes the skill root; the skill's folder is named
 * after the front matter name reduced to a path segment, not after the file.
 */
export const uploadSkillAction = serverAction(async (upload: unknown) => {
  const { fileName, base64 } = SkillUploadSchema.parse(upload);
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength > SKILL_FILES.uploadBytes) {
    publicError(
      `File is larger than ${Math.round(SKILL_FILES.uploadBytes / 1024 / 1024)} MB`,
    );
  }

  const lower = fileName.toLowerCase();
  const files = new Map<string, Uint8Array | string>();

  if (lower.endsWith(".md")) {
    files.set("SKILL.md", bytes);
  } else if (lower.endsWith(".zip") || lower.endsWith(".skill")) {
    let archive: Record<string, Uint8Array>;
    try {
      archive = unzipSync(new Uint8Array(bytes));
    } catch {
      publicError("The archive could not be opened");
    }

    // The shallowest SKILL.md marks the skill root
    const skillPath = Object.keys(archive)
      .filter((p) => !p.startsWith("__MACOSX/"))
      .filter((p) => p.split("/").pop() === "SKILL.md")
      .sort((a, b) => a.split("/").length - b.split("/").length)[0];
    if (!skillPath) publicError("The archive has no SKILL.md");

    const prefix = skillPath.slice(0, -"SKILL.md".length);
    for (const [path, data] of Object.entries(archive)) {
      if (!path.startsWith(prefix) || path.endsWith("/")) continue;
      if (path.startsWith("__MACOSX/")) continue;
      const rel = path.slice(prefix.length);
      if (rel.split("/").some((seg) => seg === ".." || seg === "")) continue;
      files.set(rel, data);
    }
  } else {
    publicError("Upload a .md, .zip or .skill file");
  }

  const skillMd = files.get("SKILL.md");
  const text =
    typeof skillMd === "string"
      ? skillMd
      : Buffer.from(skillMd as Uint8Array).toString("utf-8");
  const meta = parseFrontmatter(text);

  return writeCustomSkill(skillFolderName(meta.name), files);
});

export const deleteSkillAction = serverAction(async (dir: unknown) => {
  await deleteCustomSkill(SkillNameSchema.parse(dir));
});

/** One text file of a skill of the user's own, written back as it is on screen. */
export const writeSkillFileAction = serverAction(
  async (dir: unknown, path: unknown, content: unknown) => {
    await writeSkillFile(
      SkillNameSchema.parse(dir),
      z.string().trim().min(1).parse(path),
      z.string().parse(content),
    );
  },
);

/** Both sources. Switching off is kept in the user's config, never in the skill's files. */
export const setSkillDisabledAction = serverAction(
  async (source: unknown, dir: unknown, disabled: unknown) => {
    await setSkillOff(
      SkillSourceSchema.parse(source),
      SkillNameSchema.parse(dir),
      z.boolean().parse(disabled),
    );
  },
);
