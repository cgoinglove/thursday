import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// Nothing here writes, but the imports resolve the data folder: keep it off anyone's own
const home = await mkdtemp(join(tmpdir(), "thursday-skill-files-"));
process.env.THURSDAY_HOME = home;
after(() => rm(home, { recursive: true, force: true }));

const { APP_DIR, PATHS, SKILL_FILES_LISTED } = await import("../config.ts");
const { createSandBox } = await import("../lib/sandbox.ts");
const { discoverSkills } = await import(
  "../features/skills/skills.discover.ts"
);
const { createSkillTools } = await import(
  "../features/ai/tools/skills.tool.ts"
);
const { TOOL_NAMES } = await import("../features/ai/tools/tool-name.ts");

const sandbox = createSandBox({
  workingDirectory: home,
  spill: { dir: "spill", max: 8000, head: 5500, tail: 1500 },
});

test("a folder's files come shallowest first, by name, relative, and counted", async () => {
  const root = join(home, "tree");
  for (const path of [
    "z.md",
    "SKILL.md",
    "scripts/run.mjs",
    "references/b.md",
    "references/a.md",
    "scripts/engine/deep/one.mjs",
    "scripts/engine/two.mjs",
    ".hidden/secret.md",
    "node_modules/pkg/index.js",
  ]) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), "");
  }

  assert.deepEqual(await sandbox.listFiles(root), {
    files: [
      "SKILL.md",
      "z.md",
      "references/a.md",
      "references/b.md",
      "scripts/run.mjs",
      "scripts/engine/two.mjs",
      "scripts/engine/deep/one.mjs",
    ],
    total: 7,
  });
  // Cut, the list keeps the top and still says how many there are
  assert.deepEqual(await sandbox.listFiles(root, { limit: 3 }), {
    files: ["SKILL.md", "z.md", "references/a.md"],
    total: 7,
  });
  assert.deepEqual(await sandbox.listFiles(join(root, "missing")), {
    files: [],
    total: 0,
  });
});

/** What a bot gets from `load_skill`, for a bot holding these skill folders. */
async function load(folders: string[], name: string) {
  const skills = await discoverSkills(sandbox, folders);
  const tool = createSkillTools({ skills, sandbox })[TOOL_NAMES.load_skill];
  const result = await tool.execute?.(
    { name },
    { messages: [], toolCallId: "test", context: {} },
  );
  return result as {
    skillDirectory: string;
    files: string[];
    more?: string;
    content: string;
  };
}

const shipped = join(APP_DIR, PATHS.skills.default);
const folders = async (dir: string) =>
  (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
/** The files directly inside one of a skill's folders: what its SKILL.md points a bot at. */
const direct = async (skill: string, folder: string) =>
  (await readdir(join(skill, folder), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => `${folder}/${entry.name}`);

test("a bot is shown each shipped skill's references and scripts", async () => {
  for (const dir of await folders(shipped)) {
    const skill = join(shipped, dir);
    if (!(await direct(skill, ".")).includes("./SKILL.md")) continue;
    const { name } = (await discoverSkills(sandbox, [shipped])).find(
      (one) => one.path === skill,
    ) ?? { name: null };
    // Not listed on this machine (a macOS-only skill elsewhere): nothing to load
    if (!name) continue;

    const given = await load([shipped], name);
    assert.equal(given.skillDirectory, skill, `${name}: the folder it names`);
    assert.ok(given.content.length > 0, `${name}: instructions`);
    assert.ok(
      given.files.includes(join(skill, "SKILL.md")),
      `${name}: lists SKILL.md`,
    );
    // Each file is the path that opens it: a bare name was read as a path from the
    // workspace and the first read of a skill's own file failed in 3 jobs out of 3
    assert.ok(
      given.files.every((path) => path.startsWith(`${skill}/`)),
      `${name}: every path opens from the skill's folder`,
    );
    for (const folder of ["references", "scripts"])
      for (const path of await direct(skill, folder))
        assert.ok(
          given.files.includes(join(skill, path)),
          `${name}: ${path} is missing from the list a bot gets`,
        );

    const { total } = await sandbox.listFiles(skill, { limit: 1 });
    assert.equal(
      given.files.length,
      Math.min(total, SKILL_FILES_LISTED),
      `${name}: as many as the cap allows`,
    );
    assert.equal(
      given.more !== undefined,
      total > SKILL_FILES_LISTED,
      `${name}: a cut list says so`,
    );
  }
});
