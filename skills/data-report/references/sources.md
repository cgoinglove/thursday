# Where the numbers are

Take a figure from whoever publishes it, not from an article quoting it. When two sources
disagree, the order of trust is: a filing or an official statistic; the company's own release or
call; an industry body's report; a research firm's estimate; news.

## What `fetch.mjs` reaches (no key)

| Source | For | Command |
|---|---|---|
| FRED | US economy, rates, markets; many OECD and BIS series for other countries | `fred <ID,…>` |
| World Bank | Every country, yearly: GDP, population, inflation, trade | `worldbank <ISO2,…> <INDICATOR>` |
| ECB reference rates, through frankfurter.dev | Exchange rates, about 30 currencies, business days since 1999 | `fx <BASE> <QUOTE,…>` |
| SEC XBRL | US-listed companies' reported figures, yearly or quarterly | `sec <TICKER> --find <word>`, then `sec <TICKER> <CONCEPT,…>` |
| Wikipedia pageviews | Public interest in a topic, monthly (a stand-in for search trends) | `pageviews <ARTICLE,…> [--wiki de]` |

The weather and an amount in another currency are a line each, not a series: `weather.mjs`
reads Open-Meteo's forecast, or its archive past the forecast's 16 days, and `fx.mjs` the ECB's
rates through frankfurter.dev, or ExchangeRate-API's open feed for a currency the ECB does not
quote.

**FRED's download names a series by its id alone.** What it measures, in what unit, how often and
whether seasonally adjusted is on its page (`https://fred.stlouisfed.org/series/<ID>`): read it
before a label, a chart title or a unit says so.

Ids worth knowing:

- FRED, US: `CPIAUCSL` consumer prices, `UNRATE` unemployment, `FEDFUNDS` policy rate, `DGS10`
  10-year Treasury, `MORTGAGE30US` 30-year mortgage, `DCOILWTICO` oil.
- FRED, markets, daily closes: `SP500` (the last ten years), `NASDAQCOM`, `DJIA`, `NIKKEI225`;
  `CBBTCUSD` and `CBETHUSD` Bitcoin and Ether in dollars.
- FRED, another country, by its two-letter code in the id: `IRLTLT01<CC>M156N` 10-year bond,
  `IRSTCI01<CC>M156N` overnight rate, `LRHUTTTT<CC>M156S` unemployment, `Q<CC>R628BIS` real house
  prices (quarterly, index 2010 = 100) — `IRLTLT01DEM156N` is Germany's. Not every country has
  every one; a country's monthly consumer prices are often missing, and then the yearly rate is
  World Bank `FP.CPI.TOTL.ZG` and the monthly index is on its statistics office's site.
- World Bank: `NY.GDP.MKTP.CD` GDP in dollars, `NY.GDP.MKTP.KD.ZG` real growth, `NY.GDP.PCAP.CD`
  GDP per person, `SP.POP.TOTL` population, `FP.CPI.TOTL.ZG` inflation.
- SEC concepts: revenue is `Revenues` for some companies and
  `RevenueFromContractWithCustomerExcludingAssessedTax` for others, and a company can switch —
  `--find` shows which one it uses now. Others: `OperatingIncomeLoss`, `NetIncomeLoss`,
  `EarningsPerShareDiluted`, `Assets`, `StockholdersEquity`. A fourth quarter is not filed on its
  own; the script works it out as the year less three quarters and says so in the file.

## What it does not reach

- **Share and fund prices** — no published API serves them without a key. Take the closes from
  the exchange's own page or a quote site's historical prices, which often offer a CSV download,
  one row a date, into a CSV with a `# source:` line, and say in the text where the prices came
  from. An index FRED carries comes from FRED.
- **A country's own statistics** — its central bank's and statistics office's APIs, and company
  filings outside the SEC, mostly need a free key the user signs up for. Without one, read the
  table on their site and write the rows into a CSV with a `# source:` line.
- **Prices in shops, rents, listings** — pages, not APIs: open them in the browser, one listing at
  a time, and record each with its link and the time you saw it.
- **Search trends** — Google Trends has no open API; Wikipedia pageviews or a site's own published
  counts stand in, and say that they do.
- **Market-size totals** — research firms publish the headline figure in a press release and sell
  the rest. Take the headline with its year and what it counts; never the paywalled detail
  quoted secondhand.

A source that does not answer twice in a row is down, not empty: say so and use another.
