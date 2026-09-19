# A slide deck

Write the deck as a JSON outline; the script lays out every slide, fits its text, and writes a
PowerPoint file with real text, tables and editable charts, plus a PDF twin of the same slides.

```bash
$D deck <outline.json> [--out q3-review]
```

It prints the .pptx and .pdf paths, any text it had to shrink or that still does not fit, and
an overview picture of every slide: `look_at` it, fix what it names, run again (the same
`--out` replaces both files).

## The outline

```json
{
  "title": "Heat pumps in 2026",
  "footer": "Market brief · September 2026",
  "theme": "ink",
  "slides": [
    { "type": "title", "kicker": "Market brief", "title": "Heat pumps are winning the boiler market", "subtitle": "What changed, who buys, what it means", "byline": "Board meeting · 20 Sep 2026" },
    { "type": "bullets", "title": "Three forces pushed sales past gas boilers", "lead": "Each alone would have moved the market.", "bullets": ["**Subsidies doubled** in six markets", "Gas stayed 40% above 2019", ["Households compare running costs"], "Installers retrained"], "notes": "Say this first." }
  ]
}
```

Slide types and what each takes (`title` on all but `quote`; `lead` is one line under a title):

| type | takes |
|---|---|
| `title`, `closing` | `kicker`, `title`, `subtitle`, `byline` — on the dark cover colour |
| `section` | `number`, `title`, `subtitle` — a divider in the accent colour |
| `bullets` | `bullets` (strings; an array right after one holds its sub-points), `numbered: true`, `image` beside them |
| `two` | `left` and `right`, each `{ heading, bullets }` or `{ heading, text }` |
| `stats` | `stats`: 1–4 of `{ value, label, detail }` — big numbers |
| `chart` | `chart: { type, labels, series: [{ name, values }], unit, prefix, horizontal }` — `type` is `bar`, `line`, `pie` or `doughnut` — and `takeaway` and/or `bullets` beside it |
| `table` | `columns`, `rows` (arrays of cells), `highlight` (a row number) |
| `steps` | `steps`: 2–6 of `{ label, text }` — a process or a timeline |
| `cards` | `cards`: 2–6 of `{ title, text }` |
| `quote` | `quote`, `by` |
| `image` | `image` (a file), `fit` (`cover` or `contain`), and `caption` or `bullets` beside it |

Every slide takes `notes`, the speaker's words. `**bold**` works inside any text. Themes: `ink`
(blue), `sand` (warm), `forest` (green), `plum` (violet), `mono`; `accent` sets your own colour,
`font` another font every machine has (default Arial).

## What makes it good

- A title says the point of the slide as a sentence ("Sales recovered after the 2023 dip"), not
  its topic ("Sales").
- One idea a slide. At most five bullets, each under about twelve words; more is two slides.
- Numbers go in `stats`, `chart` or `table`, never in a sentence of bullets. A chart carries a
  `takeaway` that says what to see in it.
- Vary the types: a run of `bullets` slides reads as a document. A section divider every four or
  five slides in a long deck.
- A picture comes from a page you read — `node $THURSDAY_SKILLS/browser/scripts/webimage.mjs <page url> --out <dir>`
  saves the page's own picture and prints its credit line for the slide — or from an image model.
  Any format works; the script turns what PowerPoint cannot take into PNG.
- When the script says it shrank text, shorten it rather than accepting small type.

The PDF twin is what the app shows; PowerPoint and Keynote open the .pptx, where every text
box, table and chart stays editable.
