---
name: interactive-page
description: "A page to read or to use, as one HTML file: a report, a memo, a comparison, a plan, meeting notes — written from a ready document with a title line, a contents list, chips for dates and status, checklists and sources — or a chart of numbers, a diagram of how something is built or flows, or a tool with controls that keep state. Not a canvas of design options (design) and not a deck (slides)."
license: Complete terms in LICENSE.txt
---

# Interactive Page

What reads better looked at than as a run of markdown. Every kind is one self-contained HTML
file in your folder under `artifacts/`: it opens with no network, so pictures and fonts sit
beside it, and its path is what you hand back. A few paragraphs stay markdown.

Pick by what they will do with it. `S=<skill dir>/scripts`

| They will | Kind | Start | Then |
|---|---|---|---|
| read it — a report, a memo, options compared, a plan, notes of a meeting | document | `node $S/page.mjs quick <name> --from report\|memo\|comparison\|plan\|notes` | the comment inside the file |
| read a page that fits none of those | quick page | `node $S/page.mjs quick <name>` | the comment inside the file |
| see numbers | chart, drawn into a document | `node $S/chart.mjs <page.html> <figure id> <data.csv>` | no arguments lists its options |
| see how something is built or flows | diagram | | `references/diagram.md` |
| use it — controls that keep state, a calculator | built page | `node $S/page.mjs new <name>` | `references/page.md` |

**Document.** Written by hand from a ready one, already styled: light and dark, phone-width,
print. The `--from` kinds are shapes, not subjects — a `report` leads with the answer and
what supports it, a `memo` is short and top-down, a `comparison` is the table and next to
no prose, a `plan` is a tracker with status and owners, `notes` are what was decided and who
does what. Each opens with a title and a line under it — an as-of date and who it is by,
as chips — and the file draws its own contents beside the page from the headings (nothing
to write for it) and turns a `.tabs` block into tabs. Headings, paragraphs, lists, tables and figures need no classes; the
comment inside the file lists the few that lay out the rest — a grid of cards, one big
number, a note, a chip, a checklist, a bar, a source list. A little inline `<script>` is
fine for a toggle or a sort. When a document compares things people choose partly by how
they look — places, stays, food, things to buy — each one gets a photo or two with a short
caption from the first version, downloaded into the page's folder from the pages you read.

**Chart.** A cited inline SVG with its rows. Never hand-write chart SVG. A report that stays a
`.md` takes a `mermaid` block, which the app draws; candlesticks and zoom need a built page.

**Diagram.** Drawn by the archify engine, not as a mermaid block: it checks the layout, so a
crossing edge or a clipped label never reaches the user. It is a page of its own; when a
document needs one, name both files as you hand back.

To look at a page before handing it back, `node $THURSDAY_SKILLS/browser/scripts/render.mjs
<page.html> --out <dir> --size 1024x1400` leaves a picture of it; a server of your own is
not needed.

A document wears a head — who made it, its name, Edit, a theme button, Export — and the
reader can edit it in place: opened in the app it saves back into the file, opened
elsewhere it keeps a copy. Write inside `<main>` only. A document that has to be sent or
edited as a Word or PDF file is an office document, which is another method's work.
