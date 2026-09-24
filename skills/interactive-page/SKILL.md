---
name: interactive-page
description: "Builds a page or small app someone uses, as one offline HTML file. Use it for a tool, a calculator, a tracker, a React app, numbers to explore or a diagram; a page only read is a document (artifact)."
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
| use a small tool — a calculator, a converter, a checklist that remembers | a page | one HTML file you write whole: its HTML, a `<style>` and a `<script>` inside it |
| use an app — screens, state that builds up, forms, charts that respond | an app | `node <skill dir>/scripts/app.mjs new <name>`, write it in React, `build` it — `references/page.md` |
| see numbers, or explore them | a chart | `node <skill dir>/scripts/chart.mjs <page.html> <figure id> <data.csv>` draws a cited chart into the page (no arguments lists its options). Never hand-write chart SVG |
| see how something is built or flows | a diagram | `references/diagram.md` — the archify engine lays it out and checks it |

Pick the smallest that does the job: a page for one screen of controls, an app when there is
more than one screen or state to keep. The app is React, TypeScript, Tailwind and shadcn/ui on a
kit installed once in the workspace (the first app takes a minute or two and the network), built
into one file. Either way it is one file, readable on a phone, working without the network, and
designed for its job: avoid excessive centered layouts, purple gradients, uniform rounded
corners and the Inter font. It has no head from the app and no Edit: a page someone reads and
edits is a document.
