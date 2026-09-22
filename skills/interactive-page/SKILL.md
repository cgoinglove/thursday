---
name: interactive-page
description: "A result someone opens and looks at, as one HTML file. A page to read — a comparison, a short report, options with their photos; a diagram of how something is built or flows; a chart of numbers; a canvas of design options side by side; a deck of slides; or a tool with controls that keep state."
license: Complete terms in LICENSE.txt
---

# Interactive Page

What reads better looked at than as a run of markdown. Every kind is one self-contained HTML
file in your folder under `artifacts/`: it opens with no network, so pictures and fonts sit
beside it, and its path is what you hand back. A few paragraphs stay markdown.

Pick by what they will do with it. `S=<skill dir>/scripts`

| They will | Kind | Start | Then |
|---|---|---|---|
| read it — options compared, a short report, the numbers that matter pulled out | quick page | `node $S/page.mjs quick <name>` | the comment inside the file |
| see numbers | chart, drawn into a quick page | `node $S/chart.mjs <page.html> <figure id> <data.csv>` | no arguments lists its options |
| see how something is built or flows | diagram | | `references/diagram.md` |
| choose between ways it could look | canvas | `node $S/canvas.mjs new <name>` | `references/canvas.md` |
| follow it a step at a time | deck | `node $S/deck.mjs new <name> [--size WxH]` | `references/deck.md` |
| use it — controls that keep state, a calculator | built page | `node $S/page.mjs new <name>` | `references/page.md` |

**Quick page.** Written by hand, already styled: light and dark, phone-width, print. Headings,
paragraphs, lists, tables and figures need no classes; the comment inside the file lists the
few that lay out the rest — a grid of cards, one big number, a note, a tag, a bar. A little
inline `<script>` is fine for a toggle or a sort. When it compares things people choose partly
by how they look — places, stays, food, things to buy — each one gets a photo or two with a
short caption from the first version, downloaded into the page's folder from the pages you
read.

**Chart.** A cited inline SVG with its rows. Never hand-write chart SVG. A report that stays a
`.md` takes a `mermaid` block, which the app draws; candlesticks and zoom need a built page.

**Diagram.** Drawn by the archify engine, not as a mermaid block: it checks the layout, so a
crossing edge or a clipped label never reaches the user. It is a page of its own; when a
report needs one, name both files as you hand back.

**Canvas and deck.** Parts of one exact size in one file: a board per option with a note on
what it is for and what it costs, or a slide per step with what is said over it kept off the
slide. A deck starts from a ready slide in `deck/slides/` — cover, statement, cards, number,
table, quote, image, close — copied in and reworded; every style is inline, so the values stay
readable by whatever reads the slides next. `node $S/canvas.mjs shots <name> --size WxH` and
`node $S/deck.mjs shots <name>` leave a picture of each beside the file and refuse, by name,
one that overflows. `shots` drives a
browser: the job's own when one is open, else a headless one it opens. A deck here is shown on a screen and prints a slide a page;
one that has to be sent or edited as a PowerPoint file is an office document, which is another
method's work.
