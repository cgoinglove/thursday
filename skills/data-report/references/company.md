# Company snapshot

How a company is doing, or how its latest results went, in the terms investors and employees use.

## Collect

- The latest quarter and the same quarter a year earlier: revenue, operating income, net income,
  margin; the full-year figures for context. From the company's own filing or results release —
  a US filer through `fetch.mjs sec`, a Korean one from its DART filing or IR page.
- What management said it expects next (guidance), in their words, with the date.
- Consensus estimates, only from a page that shows them, with that page's name and date; the
  beat or miss is actual against that.
- The share price reaction: `fetch.mjs yahoo`, the close before the release against the close
  after, and against the market index over the same days.
- Valuation when asked: price ÷ earnings per share over the last four quarters, with both inputs.

## Final text

The headline in one sentence (grew or shrank, by how much, beat or missed), the one number
behind the reaction, and what to watch next quarter.

## Page

1. Title: the result as a finding. Lede: the headline and its cause.
2. A results table: this quarter, a year ago, change; estimates beside it when you have them.
3. Revenue and operating income by quarter, two years (`--quarterly`), as a line or bars.
4. The price around the release against the index (`--index`), marked at the release.
5. Three things to watch, each with the level that would matter.

## Example (illustrative numbers)

> **Northwind grew 18% but guided below what the market expected**
>
> | (₩ billion) | Q2 2026 | Q2 2025 | Change |
> |---|---|---|---|
> | Revenue | 1,240 | 1,051 | +18% |
> | Operating income | 161 | 147 | +10% |
> | Operating margin | 13.0% | 14.0% | −1.0 pt |
>
> Shares fell 6.2% the day after (index −0.4%): Q3 revenue guidance of ₩1,260–1,290 billion sat
> under the ₩1,330 billion consensus (brokerage summary on a finance portal, 2026-07-28).
