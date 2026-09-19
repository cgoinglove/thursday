---
paths:
  - "scripts/pack.mts"
  - ".github/workflows/**"
  - "release-please-config.json"
  - ".release-please-manifest.json"
  - "CHANGELOG.md"
---

# Releasing

A release that goes out wrong stays out. `scripts/pack.mts` already gates lint, typecheck, build
and the files that must never ship (a `.env` once nearly did). Past those gates:

- Install the tarball into an empty folder and boot it: the endpoints, the static assets, markdown
  rendering.
- Check how each platform resolves the install with `npm install --os/--cpu/--libc`. A release built
  on Linux once carried a Linux-only native binary and did not boot on macOS.
- Both READMEs match what install, run and the data location actually do.
- Commit types are right: a `fix` written as `feat` bumps the wrong version.
- `CHANGELOG.md` is release-please's; it is never edited by hand.
