# Where the numbers are

Take a figure from whoever publishes it, not from an article quoting it. When two sources
disagree, the order of trust is: a filing or an official statistic; the company's own release or
call; an industry body's report; a research firm's estimate; news.

## What `fetch.mjs` reaches (no key)

| Source | For | Command |
|---|---|---|
| FRED | US economy, rates, markets; many OECD and BIS series for other countries | `fred <ID,…>` |
| World Bank | Every country, yearly: GDP, population, inflation, trade | `worldbank <ISO2,…> <INDICATOR>` |
| Yahoo Finance | Stocks, ETFs, indices, crypto, futures; any exchange | `yahoo <TICKER,…> [--interval 1d\|1wk\|1mo]` |
| ECB reference rates | Exchange rates, about 30 currencies, since 1999 | `fx <BASE> <QUOTE,…>` |
| SEC XBRL | US-listed companies' reported figures, yearly or quarterly | `sec <TICKER> --find <word>`, then `sec <TICKER> <CONCEPT,…>` |
| Wikipedia pageviews | Public interest in a topic, monthly (a stand-in for search trends) | `pageviews <ARTICLE,…> [--wiki ko]` |

Ids worth knowing, all checked to be current:

- FRED, US: `CPIAUCSL` consumer prices, `UNRATE` unemployment, `FEDFUNDS` policy rate, `DGS10`
  10-year Treasury, `MORTGAGE30US` 30-year mortgage, `SP500`, `NASDAQCOM`, `DCOILWTICO` oil.
- FRED, Korea: `IRSTCI01KRM156N` overnight rate, `IRLTLT01KRM156N` 10-year bond,
  `LRHUTTTTKRM156S` unemployment, `DEXKOUS` won per dollar (daily), `QSKR628BIS` house prices.
  Korea's monthly consumer prices are no longer on FRED; the yearly rate is World Bank
  `FP.CPI.TOTL.ZG`, the monthly index is on the Bank of Korea and KOSIS sites.
- World Bank: `NY.GDP.MKTP.CD` GDP in dollars, `NY.GDP.MKTP.KD.ZG` real growth, `NY.GDP.PCAP.CD`
  GDP per person, `SP.POP.TOTL` population, `FP.CPI.TOTL.ZG` inflation.
- Yahoo tickers: Korean listings end in `.KS` (KOSPI) or `.KQ` (KOSDAQ), Tokyo `.T`, Hong Kong
  `.HK`; indices start with `^` (`^GSPC`, `^IXIC`, `^KS11`, `^N225`); `BTC-USD`; `KRW=X` is won per
  dollar.
- SEC concepts: revenue is `Revenues` for some companies and
  `RevenueFromContractWithCustomerExcludingAssessedTax` for others, and a company can switch —
  `--find` shows which one it uses now. Others: `OperatingIncomeLoss`, `NetIncomeLoss`,
  `EarningsPerShareDiluted`, `Assets`, `StockholdersEquity`. A fourth quarter is not filed on its
  own; the script works it out as the year less three quarters and says so in the file.

## What it does not reach

- **Korean official statistics** — the Bank of Korea (ECOS) and KOSIS APIs, and company filings
  through OpenDART, need a free key the user signs up for. Without one, read the table on the
  site (ecos.bok.or.kr, kosis.kr, dart.fss.or.kr) and write the rows into a CSV with a `# source:`
  line.
- **Prices in shops, rents, listings** — pages, not APIs: open them in the browser, one listing at
  a time, and record each with its link and the time you saw it.
- **Search trends** — Google Trends has no open API; Wikipedia pageviews or a site's own published
  counts stand in, and say that they do.
- **Market-size totals** — research firms publish the headline figure in a press release and sell
  the rest. Take the headline with its year and what it counts; never the paywalled detail
  quoted secondhand.

A source that does not answer twice in a row is down, not empty: say so and use another.
