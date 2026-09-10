# Shipping

How this repo becomes an npm package, and how a release happens.

**Shipping** — `next build` writes a standalone server; `scripts/pack.mts` turns it into `dist/`, which
is what `npm publish` takes. Three things about npm shape the app: it deletes every folder named
`node_modules` from a tarball unless the package declares it bundled (so pnpm installs hoisted,
`pnpm-workspace.yaml`, and pack lifts Turbopack's `.next/node_modules` aliases one level up); it gates
install scripts, so the package has none — nothing may stand between `npx` and a running app, and what
an install used to fetch is fetched at boot instead (`workspace.ensureBrowser`), in the background; and
a published tree carries no source, so anything read by name at run time (skills, migrations) is named
in `outputFileTracingIncludes`, not left to the trace.

- Commit and pull-request titles are [conventional commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `feat!:`). Not a style preference:
  release-please reads them to decide the next version and write CHANGELOG.md, so a feature
  landing under `chore:` never ships. Never hand-edit `CHANGELOG.md`, `package.json`'s `version`
  or `.release-please-manifest.json` — a release is a merged Release PR, never a pushed tag.
