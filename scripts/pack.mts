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

// Before the build, not after: `next build` traces what is on disk, so a
// `dist/` left from the last release is what the next one would carry.
rmSync(DIST, { recursive: true, force: true });

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

cpSync(BUILD, DIST, { recursive: true });

/**
 * Next leaves these two out on purpose: a deployment usually puts them on a
 * CDN. This one serves itself, so they move in beside the server — replacing
 * whatever is at the path, because a checkout that has run `pnpm start` leaves
 * links to them in the standalone tree (bin/thursday.mjs), and a link pointing
 * out of the package is not a thing to publish.
 */
for (const [from, to] of [
  [join(ROOT, ".next", "static"), join(DIST, ".next", "static")],
  [join(ROOT, "public"), join(DIST, "public")],
] as const) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

/**
 * The tracer sweeps whole directories its fs analysis can resolve, so the
 * standalone tree arrives holding whatever sat beside it — the build's own
 * `.env` included, which is how real keys reach a registry. Filtered here and
 * not by `outputFileTracingExcludes`: excluding `dist/**` also cost the trace
 * next-server/app-route-turbo.runtime.prod.js, and every API route 500s without
 * it. The only hidden entry a published tree may carry is `.next`.
 */
const shipped = (entry: string) =>
  entry === ".next" || (!entry.startsWith(".") && entry !== "dist");

for (const entry of readdirSync(DIST)) {
  if (!shipped(entry))
    rmSync(join(DIST, entry), { recursive: true, force: true });
}

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

  /** The alias, and the sibling package it resolves to. */
  const lifted: { alias: string; target: string }[] = [];
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
      lifted.push({
        alias: name,
        target: scope.isDirectory() ? `${scope.name}/${target}` : target,
      });
    }
  }
  rmSync(from, { recursive: true, force: true });
  return lifted;
}

const externals = liftExternals();

/** Every package under a node_modules root, scopes flattened into their names. */
function packagesIn(root: string): string[] {
  return readdirSync(root)
    .filter((name) => !name.startsWith("."))
    .flatMap((name) =>
      name.startsWith("@")
        ? readdirSync(join(root, name)).map((rest) => `${name}/${rest}`)
        : [name],
    );
}

const manifestOf = (root: string, name: string) =>
  JSON.parse(readFileSync(join(root, name, "package.json"), "utf8"));

/**
 * A native package is built for one machine, and the machine that packs is not
 * the machine that installs: 0.1.0 was packed on CI and shipped the Linux libsql
 * and nothing else, so `npx` died before the first screen on a Mac. npm already
 * solves this — `os`/`cpu` on the platform package, `optionalDependencies` on
 * whatever reaches for it — but only for a dependency npm resolves itself.
 * Bundling walks around that solution, so these are declared instead and every
 * install picks its own binary. The platform packages are never named here:
 * naming one would pin the very thing that has to vary.
 */
function unbundlePlatform(): Record<string, string> {
  const root = join(DIST, "node_modules");
  const manifests = new Map(
    packagesIn(root).map((name) => [name, manifestOf(root, name)] as const),
  );

  // The napi shape: one package per platform, each named in the parent's
  // optionalDependencies and narrowed by os/cpu. Only the packing machine's own
  // is here, which is exactly the problem — it is not the installing machine's.
  const optional = new Set(
    [...manifests].flatMap(([, one]) =>
      Object.keys(one.optionalDependencies ?? {}),
    ),
  );
  const artifacts = new Set(
    [...manifests]
      .filter(([name, one]) => optional.has(name) && (one.os || one.cpu))
      .map(([name]) => name),
  );

  // The parent is what gets declared: npm reads its optionalDependencies and
  // installs the one artifact this machine can run. Naming an artifact here
  // instead would pin the very thing that has to vary.
  const declared: Record<string, string> = {};
  for (const [name, one] of manifests) {
    if (artifacts.has(name)) continue;
    const reaches = Object.keys({
      ...one.dependencies,
      ...one.optionalDependencies,
    }).some((dep) => artifacts.has(dep));
    if (reaches) declared[name] = one.version;
  }

  for (const name of [...artifacts, ...Object.keys(declared)]) {
    rmSync(join(root, name), { recursive: true, force: true });
  }
  return declared;
}

/**
 * What the trace put in `dist/node_modules`, with the versions actually there.
 * npm drops `node_modules` from a tarball unless the package says it is bundled,
 * and a bundled name has to be a declared dependency, so both lists come from
 * the same walk — a build that traces one more package needs no edit here.
 */
function bundled(): Record<string, string> {
  const root = join(DIST, "node_modules");
  return Object.fromEntries(
    packagesIn(root).map((name) => [name, manifestOf(root, name).version]),
  );
}

/**
 * An external is never bundled, so it has to be on disk to require — and so does
 * everything it requires. The trace takes the package and stops there, and for
 * a package Next externals by default it can take less than that: shiki arrives
 * as a manifest with no code, @shikijs/core with no hast-util-to-html. A
 * checkout never notices, because Node walks up to the repo's own node_modules;
 * an `npx` install has nowhere to walk and 500s on the first markdown it draws.
 * So the closure is copied here, read off each manifest rather than listed in
 * next.config, where it would go stale on the next upgrade.
 */
function vendorClosure(names: string[]): void {
  const root = join(DIST, "node_modules");
  const seen = new Set<string>();
  const queue = [...names];

  for (let name = queue.shift(); name; name = queue.shift()) {
    if (seen.has(name)) continue;
    seen.add(name);

    const from = join(ROOT, "node_modules", name);
    if (!existsSync(join(from, "package.json"))) continue;

    // A manifest on its own is what the trace leaves behind; replace it.
    const to = join(root, name);
    if (!existsSync(join(to, "package.json")) || readdirSync(to).length <= 1) {
      rmSync(to, { recursive: true, force: true });
      cpSync(from, to, { recursive: true, dereference: true });
    }

    const manifest = JSON.parse(
      readFileSync(join(from, "package.json"), "utf8"),
    );
    queue.push(...Object.keys(manifest.dependencies ?? {}));
  }
}

vendorClosure(externals.map(({ target }) => target));

// A lifted alias that resolves to nothing is a server that boots and then dies
// on its first import; the build is the only place that can still catch it
const broken = externals.filter(
  ({ alias }) => !existsSync(join(DIST, "node_modules", alias, "package.json")),
);
if (broken.length)
  die(
    `External alias points at nothing: ${broken.map((one) => one.alias).join(", ")}`,
  );

/**
 * The same failure one step later: a package the trace copied as nothing but
 * its manifest. It resolves, so nothing catches it until the first import at
 * run time — which is what shiki did. `vendorClosure` has already tried to fix
 * it, so what reaches here is an external missing from the checkout's own
 * node_modules. A manifest nothing points at is debris; the prune below drops it.
 */
const hollow = externals.filter(
  ({ target }) => readdirSync(join(DIST, "node_modules", target)).length === 1,
);
if (hollow.length)
  die(`Traced without its code: ${hollow.map((one) => one.target).join(", ")}`);

/**
 * A folder under `node_modules` is not always a package. The trace follows a
 * sourcemap back into a package's own `src/`, so `@ai-sdk/anthropic` arrives as
 * two .ts files and no manifest — everything else about it was bundled into the
 * server chunks. Nothing can import that, npm cannot bundle it, and where the
 * name is also a declared dependency (@playwright/cli) it shadows the real
 * install. A manifest on its own is the same story from the other end: nft read
 * it for a version. Both are dropped here, so `bundled()` declares only what it
 * can actually bundle.
 */
function pruneOrphans(keep: Set<string>) {
  const root = join(DIST, "node_modules");

  for (const entry of readdirSync(root)) {
    if (entry.startsWith(".")) continue;
    const names = entry.startsWith("@")
      ? readdirSync(join(root, entry)).map((rest) => entry + "/" + rest)
      : [entry];

    for (const name of names) {
      if (keep.has(name)) continue;
      const inside = existsSync(join(root, name, "package.json"))
        ? readdirSync(join(root, name))
        : [];
      if (inside.length > 1) continue;
      rmSync(join(root, name), { recursive: true, force: true });
    }

    // A scope emptied by that is a directory npm would carry for nothing.
    if (entry.startsWith("@") && readdirSync(join(root, entry)).length === 0) {
      rmSync(join(root, entry), { recursive: true, force: true });
    }
  }
}

pruneOrphans(
  new Set(externals.flatMap(({ alias, target }) => [alias, target])),
);

const platform = unbundlePlatform();

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
        // Resolved per install, not per build (unbundlePlatform)
        ...platform,
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

/**
 * And what must never be there. A tarball on the registry is public and cannot
 * be unpublished after 72 hours, so this is checked rather than trusted: the
 * strip above is one edit away from letting a key through.
 */
const FORBIDDEN = [".env", ".env.local", ".npmrc", ".playwright-cli", "dist"];

const leaked = FORBIDDEN.filter((path) => existsSync(join(DIST, path)));
if (leaked.length) die(`Refusing to pack — ${leaked.join(", ")} in dist/`);

const size = spawnSync("du", ["-sh", DIST], { encoding: "utf8" })
  .stdout?.split("\t")[0]
  ?.trim();

console.log(
  `\n  \x1b[32m✓\x1b[0m ${pkg.name}@${pkg.version} — ${size ?? "?"} in dist/\n`,
);
