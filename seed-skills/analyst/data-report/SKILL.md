---
name: data-report
description: "Answers and reports built on real numbers: the form each kind of question wants (a brief, a comparison with a pick, a market size, a trend, a company snapshot, a price check, a buy-or-wait decision), scripts that fetch a published series into CSV with its source, and one that draws a CSV into a page as a cited chart."
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

The skill's scripts are in `scripts/` of this skill's folder. `node` runs them; nothing to install.

```bash
S=<this skill's folder>/scripts
# A series into CSV, with its source written into the file. It prints the rows' shape and both ends.
node $S/fetch.mjs fred DGS10,MORTGAGE30US --from 2020 --out <scratch>/rates.csv
node $S/fetch.mjs yahoo 005930.KS,^KS11 --from 2025-01 --interval 1wk --label Samsung,KOSPI --out <scratch>/px.csv
```

`references/sources.md` says which source holds what, the series ids worth knowing, and what the
scripts cannot reach. A CSV you build from a page or a file you were given takes the same shape: a
`# source: <url>` line (and `# fetched: YYYY-MM-DD`) above a header row.

## A page: the quick page, with charts drawn into it

When the form calls for a page, start it as a quick page from your Skills list (one styled HTML file
in your folder under `artifacts/`) and write its words by hand. It arrives styled: replace the title
and the lede line and write below them, and leave its `<head>` as it is. Never write chart SVG or a
data table by hand: leave an empty `<figure id="…"></figure>` where each chart goes, then fill every
one in one bash call. The chart script ships with the app:

```bash
C="$THURSDAY_SKILLS/interactive-page/scripts/chart.mjs"
node $C "$THURSDAY_ARTIFACTS/<page>.html" rates <scratch>/rates.csv \
  --title "Mortgage rates followed the 10-year down" --unit "%" --mark "2024-09=First Fed cut" --locale ko
node $C "$THURSDAY_ARTIFACTS/<page>.html" px <scratch>/px.csv --index --title "…"
```

Each figure carries its source link, the fetch date and the rows behind it with a CSV download, so
the page needs no separate data section. A line for dates, bars for categories (largest first,
`--highlight` the one that matters); `--index` when series in different units are compared;
`--mark` for each dated event the text explains. Run it again to replace a figure.
`node $C` with no arguments lists every option.
