---
name: data-report
description: "Answers and reports built on real numbers, taken from where they are published. Use it when the answer turns on numbers — a cost, a market size, a trend, a company, which to pick, buy or wait: it holds the form each question wants, and a script that fetches a published series into a CSV the app's chart script draws."
---

# Data report

## The form comes from the question

Pick one form and read only its file in `references/` before collecting anything: it says what to
collect, what the final text holds, and when a page earns its place.

| The question | Form |
|---|---|
| Anything else with numbers in it | `brief.md` |
| Which of these (products, plans, places, companies)? | `comparison.md` |
| How big is this market, how much could we sell? | `market-size.md` |
| How has X moved, and why? | `trend.md` |
| How is this company doing, how were its results? | `company.md` |
| Where is it cheapest to buy X right now? | `price-check.md` |
| Should I buy / sign / switch — or wait? | `decision.md` |

Every form opens with the answer and its two or three numbers; a reader who stops after the first
lines has what they asked for. A title says the finding ("Rent rose faster than pay"), not the topic.

## Numbers by script, not by hand

The skill's script is in `scripts/` of this skill's folder. `node` runs it; nothing to install.

```bash
S=<this skill's folder>/scripts
# A series into CSV, with its source written into the file. It prints the rows' shape and both ends.
node $S/fetch.mjs fred DGS10,MORTGAGE30US --from 2020 \
  --label "10-year Treasury,30-year mortgage" --out <scratch>/rates.csv
node $S/fetch.mjs yahoo 005930.KS,^KS11 --from 2025-01 --interval 1wk --label Samsung,KOSPI --out <scratch>/px.csv
```

A `--label` names the columns in the order you asked for them, so give one for every column or
none. `node $S/fetch.mjs` with no arguments lists every source and option.

`references/sources.md` says which source holds what, the series ids worth knowing, and what the
script cannot reach. A CSV you build from a page or a file you were given takes the same shape: a
`# source: <url>` line (and `# fetched: YYYY-MM-DD`) above a header row.

## A page: a document, with charts drawn into it

When the form calls for a page, it is a document: write it in Markdown in a file of your own and
put it, with the `artifact` skill's script — the first put makes it, styled, in your folder under
`artifacts/`. Never write chart SVG by hand: leave an empty `<figure id="…"></figure>` where each
chart goes in the Markdown, put the document, then fill every figure in one bash call. Both
scripts ship with the app:

```bash
node "$THURSDAY_SKILLS/artifact/scripts/document.mjs" put <page> <scratch>/<page>.md
C="$THURSDAY_SKILLS/interactive-page/scripts/chart.mjs"
node $C "$THURSDAY_ARTIFACTS/<page>.html" rates <scratch>/rates.csv \
  --title "Mortgage rates followed the 10-year down" --unit "%" --mark "2024-09=First Fed cut" --locale ko
node $C "$THURSDAY_ARTIFACTS/<page>.html" px <scratch>/px.csv --index --title "…"
```

Each figure carries its source link, the fetch date and the rows behind it with a CSV download, so
the page needs no separate data section. A line for dates, bars for categories (largest first,
`--highlight` the one that matters, named exactly as the row is); `--index` when series in different
units are compared; `--mark` for each dated event the text explains, inside the range drawn. Run it
again to replace a figure, and after every later put. `node $C` with no arguments lists every
option.

A table a form asks for — the comparison matrix, a results table, the driver rows — is a Markdown
table in the document, number columns aligned right (`---:`) and the best cell in each row in
`**bold**`. Never type a number into one by hand: paste what a script printed, or the figure from
the page you read, and keep its source in the row or under the table.
