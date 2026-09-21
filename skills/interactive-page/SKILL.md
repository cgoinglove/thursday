---
name: interactive-page
description: "Diagrams, charts and pages people use: a quick page (a comparison, a short report laid out as one HTML file, written in seconds); a diagram of how something is built or flows (architecture, workflow, sequence, data flow, states) drawn by the archify engine; a chart of numbers in a report; a canvas of design options side by side, each with its picture and the values it is made of; a deck of slides to present or to explain something step by step; or an interactive page (controls, tabs, a calculator) as one self-contained HTML file."
license: Complete terms in LICENSE.txt
---

# Interactive Page

## Diagrams and charts

- A diagram — how something is built, how a process flows, calls in order, where data goes, the states it moves through — is drawn by the archify engine in `scripts/archify`, not as a mermaid block: it checks the layout, so a crossing edge or a clipped label never reaches the user. Read `references/diagram.md` first. It is a page of its own; when a report needs one, name both files as you hand back.
- A chart of numbers is drawn from a CSV into a quick page by `node <skill dir>/scripts/chart.mjs <page.html> <figure id> <data.csv>` — a cited inline SVG with its rows; with no arguments it lists its options. Never hand-write chart SVG. A report that stays a `.md` takes a `mermaid` block, which the app draws; candlesticks and zoom need the kit.

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

When the page recommends or compares things people choose partly by how they look — places,
stays, food, things to buy — give each one a photo or two of what it looks like, with a short
caption, from the first version: download them from the pages you read into the page's folder.

Take the kit below instead when the page is a tool — controls that keep state, a calculator,
charts that respond — and markdown when it is only a few paragraphs.

## A canvas

Ways something could look, to choose between — screens, a page, a poster — go side by side
on one canvas that pans and zooms: a board per option at its exact size, a note beside each
on what it is for and what it costs, and a picture of every board.

```bash
node <skill dir>/scripts/canvas.mjs new <name>                 # the canvas, in your artifacts folder
node <skill dir>/scripts/canvas.mjs shots <name> --size WxH    # every board as a picture beside it
```

`new` needs nothing of the machine. `shots` drives a browser, so load the browser skill and
have a page open before it; when that skill's `open` fails with a missing executable, its
Install section is what answers it. Two things decide whether a canvas works: **every board
is the same size**, because one `--size` shoots them all and a board that misses it comes
back named as wrong; and **a palette is never written into a board by hand** — the canvas
measures what each board really paints and copies it as text to build from. Read
`references/canvas.md` before the first board.

## A deck

Something told a step at a time — a talk, a pitch, an explanation someone follows slide by
slide — is a deck: slides of one exact size in one HTML file, shown one at a time and scaled
to the window, with what is said over each kept off the slide.

```bash
node <skill dir>/scripts/deck.mjs new <name> [--size WxH]    # the deck, in your artifacts folder (1920x1080)
node <skill dir>/scripts/deck.mjs shots <name>               # every slide as a picture beside it
```

Nothing on a slide reflows: it is laid out once, for its own size, and **clips whatever does
not fit** — so run `shots`, which refuses a slide that overflows by its number, and fix those.
`shots` drives a browser, as it does for a canvas. This is a deck to show on a screen, and it
prints one slide a page; a deck that has to be sent or edited as a PowerPoint file is an
office document, which is another method's work. Read `references/deck.md` before the first
slide.

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
folder on a port nobody else holds (`python3 -u -m http.server 0 --bind 127.0.0.1
--directory <dir> > <scratch>/serve.log &`, the port is in the log), `goto` it, and kill the
server after. Do it only
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