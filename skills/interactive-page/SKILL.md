---
name: interactive-page
description: "Diagrams, charts and pages people use: a quick page (a comparison, a short report laid out as one HTML file, written in seconds); a diagram of how something is built or flows (architecture, workflow, sequence, data flow, states) drawn by the archify engine; a chart of numbers in a report; or an interactive page (controls, tabs, a calculator) as one self-contained HTML file."
license: Complete terms in LICENSE.txt
---

# Interactive Page

## Diagrams and charts

- A diagram — how something is built, how a process flows, calls in order, where data goes, the states it moves through — is drawn by the archify engine in `scripts/archify`, not as a mermaid block: it checks the layout, so a crossing edge or a clipped label never reaches the user. Read `references/diagram.md` first. It is a page of its own; when a report needs one, name both files as you hand back.
- A chart of numbers in a report is a `mermaid` block in the `.md`, which the app draws. Candlesticks, hover and zoom need a page.

## A quick page

An answer that reads better laid out than as a run of markdown — options side by side, a
table with the numbers that matter pulled out, a short report with a picture or two — is a
quick page: one HTML file, no kit, no build, ready in the time it takes to write it.

1. `node <skill dir>/scripts/page.mjs quick <name>` writes `<name>.html` in your folder under
   `artifacts/`, already styled (light and dark, phone-width, print), and prints its path.
2. Write its body in plain HTML. Headings, paragraphs, lists, tables and figures need no
   classes; the comment inside the file lists the few that lay out the rest — a grid of
   cards, one big number, a note, a tag, a bar. A little inline `<script>` is fine for a
   toggle or a sort. Nothing comes from the network: pictures sit beside the file.
3. Hand back that path.

Take the kit below instead when the page is a tool — controls that keep state, a calculator,
charts that respond — and markdown when it is only a few paragraphs.

## A page

Every page is built on one kit: React 18, TypeScript, Tailwind CSS 3, shadcn/ui
(its components are in the kit's `src/components/ui`), recharts for charts and
react-markdown with remark-gfm for text. It is installed once in the workspace and
shared by every page after it. The script is in this skill's directory (the path
you were handed when you loaded it) and finds the workspace wherever you run it:

1. `node <skill dir>/scripts/page.mjs new <name>` starts the page in
   `projects/.page-kit/pages/<name>/`. The first page ever installs the kit, a
   minute or two; after that it is instant.
2. Write the page in its `src/App.tsx`, with more files beside it as it grows.
   Shared parts import as `@/components/ui/…` and `@/lib/utils`.
3. `node <skill dir>/scripts/page.mjs build <name>` makes one self-contained file,
   copies it to `<name>.html` in your folder under `artifacts/` and prints that
   path: the one you hand back. The user opens it from the thread row; the source
   is not named in the report. It opens with no network, so nothing comes from a
   CDN: fonts and images go in the page's folder and are imported.
4. To change a page later, from any job: edit its folder and build again, and the
   same file is replaced. `new` refuses a name already taken.

A library the kit lacks: `node <skill dir>/scripts/page.mjs add <package>`, and
every page can import it from then on. Keep what one page needs in its own
folder rather than in the kit's `src/`: an app update replaces those shared files.

To look at it yourself, the `browser` skill: it refuses `file:` URLs, so serve the
folder first (`python3 -m http.server 48800 --bind 127.0.0.1 --directory <dir> &`),
`goto http://127.0.0.1:48800/<name>.html`, and kill the server after. Do it only
when asked or when something looks wrong: testing upfront adds latency between
the request and the finished file.

## Design

The page is a tool someone opens to use, and what it looks like comes from the
job it was built for — a rate calculator, a reading list and a test report
should not arrive as the same page in three colors. Before the first component,
settle four things in a line each: the palette (4-6 values), the type, the
layout, and the one element the page exists for. Skipping that is how a page
gets built out of defaults.

**Type carries a hard constraint here.** The bundle opens from disk with no
network, so a font fetched from a CDN falls back silently to whatever the
machine has. Embed the file in the bundle, or build on the system stack and
spend the personality on weight, size and spacing instead. Set a real scale, and
keep body text under about 80 characters a line.

**Spend the boldness once.** One element carries the page — the number, the
chart, the control the whole thing exists for — and everything around it stays
quiet. Structure is not decoration: a border, a divider, a numbered marker each
claim something about the content, so number a list only when it is a sequence.
Cut what claims nothing.

Some looks are defaults rather than decisions, and they turn up whatever the
page is about: everything chopped into identical rounded cards under the same
soft shadow, a tracked-out capital label above every heading, meta lines joined
with middle dots, an arrow glued to the end of button text, a gradient standing
in for a background, one centered column all the way down. None of them are
wrong — they are what gets produced when nothing was chosen. If the user asked
for one of them, that settles it: their words win over this list.

Motion answers an action — opening, expanding, confirming — and shows what
changed. Entrance animations on every section are the default look. Honor
`prefers-reduced-motion`.

Words are design too. A control says what it does ("Save changes", not
"Submit") and keeps that name wherever it appears, so a button that says Publish
leaves a message that says Published. An empty state says what to do next, and
an error says what happened and how to fix it, without apologizing.

Build to the floor without announcing it: usable down to a phone, focus visible
on the keyboard, contrast that holds.

## Reference

- **shadcn/ui components**: https://ui.shadcn.com/docs/components