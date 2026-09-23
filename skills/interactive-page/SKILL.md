---
name: interactive-page
description: "A page someone uses, as one HTML file: a tool, a calculator, a tracker, numbers to explore, a diagram of how something is built or flows. Use it when the result is meant to be used rather than only read. Not a document, deck, canvas or picture book (artifact)."
license: Complete terms in LICENSE.txt
---

# Interactive page

A result meant to be used, not just read: controls, tabs, a chart to explore, a calculator, a
map of how something works. One self-contained HTML file in your folder under `artifacts/`
(`$THURSDAY_ARTIFACTS`): it opens with no network, so its script and styles are inside it and
its pictures sit beside it, and its path is what you hand back. A result only read is a
document — the `artifact` skill.

| They will | Kind | How |
|---|---|---|
| use a small tool — a calculator, a converter, a tracker, a checklist that remembers | a page | one HTML file you write whole: its HTML, a `<style>` and a `<script>` inside it |
| see numbers, or explore them | a chart | `node <skill dir>/scripts/chart.mjs <page.html> <figure id> <data.csv>` draws a cited chart into the page (no arguments lists its options). Never hand-write chart SVG |
| see how something is built or flows | a diagram | `references/diagram.md` — the archify engine lays it out and checks it |

A page you write whole is yours to shape; keep it one file, readable on a phone, and working
without the network. It has no head from the app and no Edit: a page someone reads and edits is
a document.
