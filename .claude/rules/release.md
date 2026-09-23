---
paths:
  - "scripts/pack.mts"
  - ".github/workflows/**"
  - "release-please-config.json"
  - ".release-please-manifest.json"
  - "CHANGELOG.md"
  - "package.json"
  - "next.config.ts"
---

# Releasing

A release that goes out wrong stays out.

- **How one goes out.** release-please keeps a Release PR open with the next version and its
  changelog; merging it tags the commit, and `release.yml` runs `scripts/pack.mts` and publishes
  `dist/` with npm trusted publishing and `--provenance` — no stored token. Running the workflow by
  hand publishes again from main when the publish after a tag failed. `pnpm release` is the manual
  path.
- **The version comes from commit subjects.** Every subject on main is `type(scope): subject`
  (`pr-title.yml` checks a PR's title: lowercase, no full stop, a scope names a feature folder) and
  becomes a changelog line. A `fix` written as `feat` bumps the wrong version. `CHANGELOG.md` is
  release-please's and never edited by hand.
- **What `pack.mts` gates**: typegen, lint, typecheck and build; the files a fresh machine needs to
  boot (`REQUIRED`); the files that must never ship (`.env` and the like); and broken external
  aliases. It runs no test suite and no knip — CI does, on every push, not the release job.
  `pnpm pack:check` skips the build and every gate with it.
- **A file read at run time ships only if it is listed**: in `pack.mts` `REQUIRED` when a boot needs
  it, and in `next.config` `outputFileTracingIncludes` for the standalone server.
- Past those gates, by hand:
  - Install the tarball into an empty folder and boot it: the endpoints, the static assets, markdown
    rendering.
  - Check how each platform resolves the install with `npm install --os/--cpu/--libc`: a native binary
    built on one platform must not be the only one shipped.
  - Both READMEs match what install, run and the data location actually do.
