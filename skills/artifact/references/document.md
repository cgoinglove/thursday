# A document

A document is one page to read, written in Markdown and put into a file that is already styled
for reading: light and dark, phone-width, print, a contents list drawn beside it from the
headings, and a head that lets the reader edit it in the app. You never write its HTML.

```bash
node <skill dir>/scripts/document.mjs put <name> <file.md>     # makes the document the first time
node <skill dir>/scripts/document.mjs get <name|path> <file>   # the body as it stands, to change
node <skill dir>/scripts/document.mjs shots <name|path>        # only when asked how it looks
```

## Pick its shape

The outlines in `templates/document/` are shapes, not subjects. Copy the one whose shape fits into
a file of your own, keep its order, replace every line:

| Outline | For | Its shape |
|---|---|---|
| `report.md` | a finding and what it rests on | the answer first, the numbers under it, the evidence, what it means, what to do, sources |
| `memo.md` | a decision someone has to make | the ask in one sentence, why now, the options with what each costs, next |
| `comparison.md` | which one of several | the table is the document, the pick first, one line on why, sources |
| `plan.md` | where work stands | a tracker of pieces, who and when; this week; risks with their fallback |
| `notes.md` | what a meeting settled | decided, actions with an owner and a date, open questions, next |

A page that fits none starts from nothing: a `# ` title, then the page.

## What Markdown carries here

- **The first `# ` heading is its title** — the tab and the head read it. The paragraph under it is
  the lede, read first and alone: the answer in a sentence or two.
- **The line over and under the title** comes from front matter at the very top, all optional,
  in the language the document is written in — `kicker:` the word over the title, `date:`, `by:`
  (several split by commas), `status:` with `tone:` good, warn or bad:

  ```
  ---
  kicker: Report
  date: As of 24 September 2026
  by: Analyst
  ---
  # Rent rose faster than pay
  ```
- **Numbers that carry the finding** go in a ` ```stats ` block, one card a line:
  `42% | of renters moved in two years`.
- **A table** is a Markdown table; a column aligned right (`---:`) is read as numbers.
- **A note set apart** is a GitHub alert: `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!CAUTION]`.
  A plain `>` stays a quotation.
- **A checklist** is `- [ ]` and `- [x]`; the reader ticks it in the page.
- **Where a claim comes from** is a footnote: `the claim.[^rent]` in the text and
  `[^rent]: The index, [its page](url)` on a line of its own anywhere. They are numbered in the
  order cited and gathered at the end, and the reader sees one by pointing at its number.
- **A table's columns sort** by a press on their heading while it is read; write the rows in
  the order that answers the question.
- **A picture** alone in its paragraph, `![What it shows](photo.jpg)`, becomes a picture with that
  caption. It sits beside the document's file, saved there from the page it came from.
- **HTML inside the Markdown passes through** for what Markdown lacks: a chip
  (`<span class="chip who">Sam</span>`, `.date`, `.status.good`), a `<details>` to fold, tabs
  (`<div class="tabs"><section data-tab="Name">…</section></div>`).
- **A comment** (`<!-- … -->`) is dropped: the outlines' guidance never reaches the page.

## Photos, numbers, diagrams

- **Things people choose partly by how they look** — places, stays, food, things to buy — each
  get a photo or two from the first version, with a short caption, saved beside the file from the
  pages you read (`webimage.mjs`, SKILL.md). A comparison of stays with no photos is half an
  answer.
- **A chart of numbers**: leave `<figure id="rent"></figure>` in the Markdown where it goes, put
  the document, then draw it:
  `node $THURSDAY_SKILLS/artifact/scripts/chart.mjs <the document's file> rent <data.csv>`
  (no arguments lists its options). Put again later and the figure is empty: draw it again.
  Never write chart SVG by hand.
- **How something is built or flows** is a diagram, a page of its own (`references/diagram.md`);
  name both files when you hand them back.
- **A Word file** — when they need a .docx to send or submit — is the document as it is, edits
  and all: `node $THURSDAY_SKILLS/artifact/scripts/document.mjs docx <name>` writes `<name>.docx`
  beside the page. Run it after the last `put` or chart, and hand back both paths. The reader has
  the same in the page's Export.

## Changing it

Nobody edited it since your last `put`: change your Markdown and put it again. The reader may
have — in the app, or a teammate by hand — so when `put` refuses, `get` the body (it comes as the
page's HTML, with their edits), make your change in that file, and put that file. Never write the
document's file itself.
