# archify

The diagram engine behind `../../references/diagram.md`: a typed JSON spec in,
one checked, offline HTML page out.

Copied from [tt-a1i/archify](https://github.com/tt-a1i/archify) — its `archify/`
folder at `d15010a` (v2.17.0-dev.1) — under its MIT license (`LICENSE`).
`assets/template.html` embeds JetBrains Mono under the SIL Open Font License
(`assets/JetBrainsMono-OFL.txt`).

What this copy leaves out, and why:

- Tests, the rendered example pages, generator tooling and the update check.
  Nothing here runs them, and the update check reaches the network.
- Brand marks. `renderers/shared/generated-brand-marks.mjs` is an empty table,
  because third-party logos carry their own licenses and trademark terms.
- Languages other than English. The viewer's zh-CN strings
  (`renderers/shared/i18n.mjs`) and the scenario guide's Chinese copy
  (`recipes/scenarios.mjs`) are removed; a requested language resolves to
  English.

Lint skips this folder (`biome.json`), so it stays byte-for-byte upstream apart
from those cuts. To update, copy the upstream folder over this one, make the same
three cuts, and check that `node bin/archify.mjs doctor` reports ready and every
example passes `validate --quality showcase`.
