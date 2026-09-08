#!/usr/bin/env node
// Builds `dist/` — the tree npm publishes. It is not this checkout: the
// standalone build already carries the dependencies it traced, so the published
// manifest declares almost none and an install downloads them once, not twice.
// Run by `pnpm release`; `pnpm pack:check` shows what a publish would carry.
// No `@/` alias: Node does not read tsconfig paths.

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
/** What `output: "standalone"` writes (next.config.ts). */
const BUILD = join(ROOT, ".next", "standalone");
/** What gets published. `npm publish dist`, never the checkout. */
const DIST = join(ROOT, "dist");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const die = (message: string): never => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

if (process.argv.includes("--refuse-root")) {
  die("Publish the packed tree, not the checkout — run: pnpm release");
}

/**
 * The same gates CI runs, in the order that fails fastest. `next build` type
 * checks on its own, but nothing else lints — without this, a local
 * `pnpm release` would publish what a pull request could not merge.
 */
if (!process.argv.includes("--no-build")) {
  for (const [what, argv] of [
    ["lint", ["biome", "check"]],
    // `PageProps` and `LayoutProps` are generated, not written: without this
    // step tsc fails on a clean checkout and passes on a machine that has built
    ["types", ["next", "typegen"]],
    ["typecheck", ["tsc", "--noEmit"]],
    ["build", ["next", "build"]],
  ] as const) {
    const done = spawnSync("npx", argv, { cwd: ROOT, stdio: "inherit" });
    if (done.status !== 0) die(`${what} failed — nothing was packed`);
  }
}

if (!existsSync(join(BUILD, "server.js"))) {
  die('No standalone server — is `output: "standalone"` still in next.config?');
}

rmSync(DIST, { recursive: true, force: true });
cpSync(BUILD, DIST, { recursive: true });

/**
 * Next leaves these two out on purpose: a deployment usually puts them on a
 * CDN. This one serves itself, so they move in beside the server.
 */
cpSync(join(ROOT, ".next", "static"), join(DIST, ".next", "static"), {
  recursive: true,
});
cpSync(join(ROOT, "public"), join(DIST, "public"), { recursive: true });

for (const file of ["bin", "README.md", "LICENSE"]) {
  const from = join(ROOT, file);
  if (existsSync(from)) cpSync(from, join(DIST, file), { recursive: true });
}

/**
 * Turbopack gives every server-external package a hashed alias and points it at
 * the real one through `.next/node_modules` — a folder npm deletes from every
 * tarball, at any depth. The same symlink one level up survives, because npm
 * keeps (and dereferences) what a bundled dependency holds.
 */
function liftExternals() {
  const from = join(DIST, ".next", "node_modules");
  if (!existsSync(from)) return [];

  const lifted: string[] = [];
  for (const scope of readdirSync(from, { withFileTypes: true })) {
    const names = scope.isDirectory()
      ? readdirSync(join(from, scope.name)).map((n) => `${scope.name}/${n}`)
      : [scope.name];

    for (const name of names) {
      // The alias and its target are siblings once here, so the link holds no
      // `..` — npm's tar refuses an entry that points outside the package
      const target = name
        .split("/")
        .at(-1)
        ?.replace(/-[0-9a-f]{8,}$/, "");
      if (!target) continue;
      const link = join(DIST, "node_modules", name);
      rmSync(link, { recursive: true, force: true });
      symlinkSync(target, link, "dir");
      lifted.push(name);
    }
  }
  rmSync(from, { recursive: true, force: true });
  return lifted;
}

const externals = liftExternals();

/**
 * What the trace put in `dist/node_modules`, with the versions actually there.
 * npm drops `node_modules` from a tarball unless the package says it is bundled,
 * and a bundled name has to be a declared dependency, so both lists come from
 * the same walk — a build that traces one more package needs no edit here.
 */
function bundled(): Record<string, string> {
  const root = join(DIST, "node_modules");
  const names = readdirSync(root)
    .filter((name) => !name.startsWith("."))
    .flatMap((name) =>
      name.startsWith("@")
        ? readdirSync(join(root, name)).map((rest) => `${name}/${rest}`)
        : [name],
    );

  return Object.fromEntries(
    names.map((name) => [
      name,
      JSON.parse(readFileSync(join(root, name, "package.json"), "utf8"))
        .version,
    ]),
  );
}

const vendored = bundled();

/**
 * The published manifest. Everything the app imports is bundled above; the one
 * declared dependency is the tool bots reach for through a shell, which nothing
 * imports and so nothing traced (workspace.ts TOOL_PATH).
 */
writeFileSync(
  join(DIST, "package.json"),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      license: pkg.license,
      keywords: pkg.keywords,
      homepage: pkg.homepage,
      repository: pkg.repository,
      bugs: pkg.bugs,
      bin: pkg.bin,
      engines: pkg.engines,
      // No install script: nothing here may hold up an install. The browser is
      // fetched in the background once the server is up (workspace.ensureBrowser).
      dependencies: {
        ...vendored,
        "@playwright/cli": pkg.dependencies["@playwright/cli"],
      },
      bundleDependencies: Object.keys(vendored),
      publishConfig: pkg.publishConfig,
    },
    null,
    2,
  )}\n`,
);

/** What must be there for a fresh machine to boot (config.ts APP_DIR). */
const REQUIRED = [
  "server.js",
  "bin/thursday.mjs",
  ".next/static",
  "database/migrations",
  "skills/browser/references",
];

const missing = REQUIRED.filter((path) => !existsSync(join(DIST, path)));
if (missing.length) die(`Missing from the build: ${missing.join(", ")}`);

// A lifted alias that resolves to nothing is a server that boots and then dies
// on its first import; the build is the only place that can still catch it
const broken = externals.filter(
  (name) => !existsSync(join(DIST, "node_modules", name, "package.json")),
);
if (broken.length)
  die(`External alias points at nothing: ${broken.join(", ")}`);

const size = spawnSync("du", ["-sh", DIST], { encoding: "utf8" })
  .stdout?.split("\t")[0]
  ?.trim();

console.log(
  `\n  \x1b[32m✓\x1b[0m ${pkg.name}@${pkg.version} — ${size ?? "?"} in dist/\n`,
);
