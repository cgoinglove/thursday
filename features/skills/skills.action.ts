"use server";

import { unzipSync } from "fflate";
import { z } from "zod";
import {
  deleteCustomSkill,
  parseFrontmatter,
  renderSkillMarkdown,
  setSkillDisabled,
  writeCustomSkill,
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

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * A lone `.md`, or a `.zip` / `.skill` archive containing a SKILL.md. The
 * folder holding SKILL.md becomes the skill root; the skill's folder is named
 * after the front matter name, not the file.
 */
export const uploadSkillAction = serverAction(async (upload: unknown) => {
  const { fileName, base64 } = SkillUploadSchema.parse(upload);
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    publicError("File is larger than 20 MB");
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

  return writeCustomSkill(meta.name, files);
});

export const deleteSkillAction = serverAction(async (dir: unknown) => {
  await deleteCustomSkill(SkillNameSchema.parse(dir));
});

/** Both sources. Disabling writes to the skill's SKILL.md; default skills can only be disabled. */
export const setSkillDisabledAction = serverAction(
  async (source: unknown, dir: unknown, disabled: unknown) => {
    await setSkillDisabled(
      SkillSourceSchema.parse(source),
      SkillNameSchema.parse(dir),
      z.boolean().parse(disabled),
    );
  },
);
