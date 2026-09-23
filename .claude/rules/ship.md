---
checked: 2026-09-24
paths:
  - "bin/**"
  - ".github/**"
  - "scripts/{dev,reset,pack}.mts"
  - "{config,next.config,drizzle.config}.ts"
  - "instrumentation*.ts"
  - "{package,release-please-config,knip,biome}.json"
---

# Run, check and ship

One line, `npx thursday-agent`, boots the app on a stranger's machine, and checking a change never
touches anyone's data.

## Start here
- `config.ts` — the roots, paths, limits and tuning numbers.
- `bin/thursday.mjs` — `npx thursday-agent` and `pnpm start`: two roots, a port, the built server.
- `scripts/dev.mts` — `pnpm dev`: `next dev` on a free loopback port.
- `instrumentation-node.ts` — boot: migrate, sweep the last run, start routines and the phone.
- `next.config.ts` — standalone output, and the run-time files the trace is told about.
- `scripts/pack.mts` — builds `dist/`, the tree npm publishes, behind its gates.
- `.github/workflows/release.yml` — release-please's PR through to `npm publish` with provenance.

## How it fits
`config.ts` reads the roots from the environment once, at import, and is loaded by the server,
client screens, plain `node` (`pnpm dev`, `pnpm reset`) and the Next and drizzle configs. Boot runs
once per server process: `next dev` reloads code but not boot, so a new boot step waits for a
restart — say so to whoever runs the server.

## Rules
- `config.ts` imports nothing and uses only erasable TypeScript — plain `node` loads it for
  `pnpm dev` and `pnpm reset`, where an `@/` import or an `enum` fails before anything starts, and
  no CI step loads it that way.
- A file the server reads by path at run time is listed in `outputFileTracingIncludes` or copied by
  `pack.mts`, and goes in `REQUIRED` when an install cannot work without it — `pnpm dev` runs on
  the checkout, where every file is beside it, so a missing one shows only in a build.
- A change to `pack.mts`, `next.config.ts`, `bin/` or a dependency is tried as `npm pack ./dist`,
  installed in an empty folder, booted on an empty `--home` with a markdown page opened, and
  resolved per platform with `npm install --os/--cpu/--libc` — the checkout's `node_modules` hides
  what a tarball lacks.

## Check
`node scripts/pack.mts` runs the release gates and writes `dist/` without publishing;
`pnpm pack:check` repacks the last build, checking its files but not lint, types or the build;
`pnpm release` publishes and is never a check. A starter or boot change is served from the build,
which a running `next dev` does not block; `--home` keeps it off the checkout's own database:
`pnpm build && THURSDAY_SKIP_BROWSER=1 pnpm start --home "$(mktemp -d)" --port <n> --no-open`
