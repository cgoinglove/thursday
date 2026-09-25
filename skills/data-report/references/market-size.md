# Market size

How big a market is and how much of it is reachable: TAM, SAM, SOM, each with its arithmetic in
the open, so a reader can follow every number back to the input it came from.

## Collect

- A published total, when one exists: who measured it, for which year, what it counts (sales or
  spending, which countries, which products). Two publishers usually disagree; take both.
- Bottom-up inputs, each with its source: how many buyers (a census, a registry, a company's
  own count), what share of them buy, how often, at what price.
- Growth: the series itself (`fetch.mjs`), or the publisher's rate with its years.

## The arithmetic

Build it both ways and show both:

- **Top-down**: published total × the share that fits the question (region, segment) = SAM.
- **Bottom-up**: buyers × share who buy × purchases a year × price = SAM.

Each is a table of drivers, one row each: the value, its unit, its source. The result is a range
(low and high inputs), never one point. When the two ways differ by more than about 2×, say which
input is most likely wrong. SOM is SAM × a share you state and justify (what the leader holds,
what a new entrant took in its first years), never a share picked to look good.

## Final text

SAM as a range in one currency and year, the SOM that follows from the share you assumed, and the
input the answer depends on most.

## Page

Title: the size as a finding. Then the two driver tables, a bar chart of TAM / SAM / SOM, the
growth series as a line when there is one, and the assumptions the answer rests on, each with the
figure used. The page is a document and does not compute: the numbers are the ones worked out
here, stated.

## Example (illustrative numbers)

> **Home coffee subscriptions here: €170–255 million a year (2025)**
>
> | Bottom-up driver | Value | Source |
> |---|---|---|
> | Households | 22.3 M | Statistics office, 2025 |
> | Buy beans online at least monthly | 4–6% | Industry survey, 2024 (n = 3,000) |
> | Orders a year | 10 | same survey |
> | Average order | €19 | median of 12 shops' listings, checked 2026-09 |
> | **SAM** | **€170–255 million** | 22.3 M × 4–6% × 10 × €19 |
>
> Top-down: €1.9 billion coffee retail (market report, 2025) × 12% online bean share = €228 million.
> SOM at 2% of SAM (what the third-largest shop holds): €3.4–5.1 million.
