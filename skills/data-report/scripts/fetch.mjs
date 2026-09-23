#!/usr/bin/env node
// Fetches a published series into one CSV: a `date` column, one column per series, and
// `#` lines above the header naming where it came from, so the page drawn from it can
// cite the source (chart.mjs reads them). Node only, no keys.
//
//   node fetch.mjs fred <ID[,ID…]>                       FRED series (US and much of the OECD)
//   node fetch.mjs worldbank <ISO2[,ISO2…]> <INDICATOR>  World Bank, one column per country, yearly
//   node fetch.mjs yahoo <TICKER[,TICKER…]>              daily/weekly/monthly close (--interval 1d|1wk|1mo)
//   node fetch.mjs fx <BASE> <QUOTE[,QUOTE…]>            ECB rates via frankfurter.dev, business days
//   node fetch.mjs sec <TICKER> <CONCEPT[,CONCEPT…]>     US filers' reported figures (--quarterly)
//   node fetch.mjs sec <TICKER> --find <word>            which concepts a company reports
//   node fetch.mjs pageviews <ARTICLE[,ARTICLE…]>        Wikipedia monthly views (--wiki en|ko|…)
//
// Every command takes --out <file.csv> (required, except --find), --from and --to
// (YYYY, YYYY-MM or YYYY-MM-DD) and --label <name[,name…]> to rename the columns — one
// name per column, in the order you asked for them.
// Without --from: yahoo and fx start on 1 January last year, pageviews on 1 January the
// year before that and stop at the last whole month; fred, worldbank and sec give the
// whole published series.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

class Stop extends Error {}

/** The comment at the top of this file, which is its manual. */
const usage = () => {
  const lines = readFileSync(new URL(import.meta.url), "utf8")
    .split("\n")
    .slice(1);
  const end = lines.findIndex((line) => !line.startsWith("//"));
  return lines
    .slice(0, end)
    .map((line) => line.replace(/^\/\/ ?/, ""))
    .join("\n");
};

// The SEC turns away a user agent carrying a URL; Wikimedia asks for one that names the tool
const AGENT = "thursday-agent data-report";
const today = new Date().toISOString().slice(0, 10);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else positional.push(arg);
  }
  return { positional, flags };
}

const list = (value) =>
  String(value ?? "")
    .split(",")
    .map((one) => one.trim())
    .filter(Boolean);

/** YYYY, YYYY-MM or YYYY-MM-DD, padded to a full day at the start or end of the period. */
function day(value, end = false) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m)
    throw new Stop(
      `"${value}" is not a date: use YYYY, YYYY-MM or YYYY-MM-DD.`,
    );
  const [, y, mo, d] = m;
  if (d) return `${y}-${mo}-${d}`;
  if (mo) {
    if (!end) return `${y}-${mo}-01`;
    const last = new Date(Date.UTC(+y, +mo, 0)).getUTCDate();
    return `${y}-${mo}-${String(last).padStart(2, "0")}`;
  }
  return end ? `${y}-12-31` : `${y}-01-01`;
}

async function get(url, as = "json", headers = {}) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(45_000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return as === "json" ? await res.json() : await res.text();
    } catch (error) {
      last = error;
    }
  }
  throw new Stop(
    `${url} did not answer: ${last?.cause?.code ?? last?.message}`,
  );
}

/**
 * Joins series on their date: Map(name → Map(date → value)) → sorted rows. A Map, not an
 * object, so the columns keep the order they were asked for whatever the names are — an
 * object would move a name that reads as a number ("1984") to the front, and a --label
 * with it.
 */
function join(series) {
  const names = [...series.keys()];
  const dates = new Set();
  for (const values of series.values())
    for (const d of values.keys()) dates.add(d);
  const rows = [...dates]
    .sort()
    .map((date) => [
      date,
      ...names.map((name) => series.get(name).get(date) ?? ""),
    ]);
  return { names, rows };
}

function clip(rows, from, to) {
  return rows.filter(([date]) => {
    const full = day(date.length === 4 ? date : date.slice(0, 10));
    return (!from || full >= from) && (!to || full <= to);
  });
}

const cell = (value) =>
  /[",\n]/.test(String(value))
    ? `"${String(value).replaceAll('"', '""')}"`
    : String(value);

// ── Sources ────────────────────────────────────────────────────────────────

/**
 * What a FRED series measures. The CSV download carries the id alone, so without this a
 * chart's legend reads `DGS10` and nothing says whether it is a percent or an index,
 * monthly or daily, seasonally adjusted or not. One call for every id; keyed by the id it
 * answers with, never by position.
 */
async function fredMeta(ids) {
  const found = new Map();
  // A FRED graph carries twelve lines and this endpoint is the graph's: it answers for the
  // first twelve ids and drops the rest, so it is asked in twelves
  for (let at = 0; at < ids.length; at += 12) {
    const batch = ids.slice(at, at + 12).map(encodeURIComponent);
    try {
      const data = await get(
        `https://fred.stlouisfed.org/graph/api/series/?id=${batch.join(",")}`,
      );
      for (const entry of data?.chart_series ?? [])
        for (const object of Object.values(entry.series_objects ?? {}))
          if (object?.series_id)
            found.set(object.series_id.toUpperCase(), object);
    } catch {
      // What a series measures is not the series: the numbers still arrive without it
    }
  }
  return found;
}

async function fred([ids], { from, to }) {
  if (!ids)
    throw new Stop(
      "Name the FRED series: fetch.mjs fred CPIAUCSL --out cpi.csv",
    );
  const series = new Map();
  const apis = [];
  for (const id of list(ids)) {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}${from ? `&cosd=${from}` : ""}${to ? `&coed=${to}` : ""}`;
    apis.push(url);
    // FRED refuses a browser's user agent on this endpoint; Node's own passes
    const text = await get(url, "text");
    if (!text || !text.startsWith("observation_date"))
      throw new Stop(
        `FRED has no series "${id}". Find the id on https://fred.stlouisfed.org (search, then the id after /series/).`,
      );
    const values = new Map();
    for (const line of text.trim().split("\n").slice(1)) {
      const [date, value] = line.split(",");
      values.set(date, value === "." ? "" : (value ?? "").trim());
    }
    series.set(id, values);
  }
  const ids_ = list(ids);
  const meta = await fredMeta(ids_);
  const unknown = ids_.filter((id) => !meta.has(id.toUpperCase()));
  if (unknown.length)
    console.error(
      `FRED did not say what ${unknown.join(", ")} measures. Read the series page before drawing it: https://fred.stlouisfed.org/series/${unknown[0]}`,
    );
  return {
    series,
    title: ids_
      .map((id) => {
        const one = meta.get(id.toUpperCase());
        if (!one) return id;
        const said = [one.frequency, one.season].filter(Boolean).join(", ");
        return `${one.title} [${id}]${said ? `, ${said.toLowerCase()}` : ""}`;
      })
      .join("; "),
    unit: [
      ...new Set(
        ids_
          .map((id) => meta.get(id.toUpperCase())?.units_short)
          .filter(Boolean),
      ),
    ].join(", "),
    source: ids_
      .map((id) => `https://fred.stlouisfed.org/series/${id}`)
      .join(" "),
    api: apis.join(" "),
  };
}

async function worldbank([countries, indicator], { from, to }) {
  if (!countries || !indicator)
    throw new Stop(
      "Name countries and an indicator: fetch.mjs worldbank KR,JP NY.GDP.MKTP.CD --out gdp.csv",
    );
  const wanted = list(countries);
  const codes = wanted.join(";");
  const years =
    from || to
      ? `&date=${(from ?? "1960").slice(0, 4)}:${(to ?? today).slice(0, 4)}`
      : "";
  const api = `https://api.worldbank.org/v2/country/${codes}/indicator/${indicator}?format=json&per_page=20000${years}`;
  const data = await get(api);
  if (!Array.isArray(data) || !Array.isArray(data[1]))
    throw new Stop(
      `The World Bank answered no rows for ${codes} / ${indicator}: ${JSON.stringify(data?.[0]?.message ?? data).slice(0, 200)}`,
    );
  // The rows arrive in the API's own country order, so the columns are built in the order
  // they were asked for: a --label binds by position
  const found = new Map();
  let title = indicator;
  for (const row of data[1]) {
    title = row.indicator?.value ?? title;
    const code = (row.country?.id ?? row.countryiso3code ?? "").toUpperCase();
    let country = found.get(code);
    if (!country) {
      country = {
        name: row.country?.value ?? row.countryiso3code,
        values: new Map(),
      };
      found.set(code, country);
      if (row.countryiso3code)
        found.set(row.countryiso3code.toUpperCase(), country);
    }
    if (row.value !== null) country.values.set(row.date, String(row.value));
  }
  const series = new Map();
  for (const code of wanted) {
    const country = found.get(code.toUpperCase());
    if (!country)
      throw new Stop(
        `The World Bank answered no rows for "${code}". Name each country by its code, ISO2 or ISO3: https://api.worldbank.org/v2/country?format=json&per_page=400`,
      );
    if (!country.values.size)
      throw new Stop(
        `The World Bank publishes no ${indicator} for ${country.name} over these years. Drop that country, widen --from/--to, or take its figure from its own statistics office.`,
      );
    series.set(country.name, country.values);
  }
  return {
    series,
    title,
    source: `https://data.worldbank.org/indicator/${indicator}?locations=${wanted.join("-")}`,
    api,
  };
}

async function yahoo([tickers], { from, to, flags }) {
  if (!tickers)
    throw new Stop(
      "Name the ticker: fetch.mjs yahoo AAPL,005930.KS --out prices.csv",
    );
  const interval = flags.interval ?? "1d";
  if (!["1d", "1wk", "1mo"].includes(interval))
    throw new Stop(
      `--interval "${interval}" is not one of Yahoo's: 1d, 1wk or 1mo.`,
    );
  const start = Math.floor(
    Date.parse(from ?? day(String(new Date().getUTCFullYear() - 1))) / 1000,
  );
  const end = Math.floor(
    (to ? Date.parse(to) + 86_400_000 : Date.now()) / 1000,
  );
  const series = new Map();
  const names = [];
  const apis = [];
  const units = new Set();
  for (const ticker of list(tickers)) {
    const api = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=${interval}&events=split,div`;
    apis.push(api);
    let data;
    try {
      data = await get(api);
    } catch (error) {
      // This endpoint is Yahoo's own chart, not a published API: it blocks and rate-limits
      // without notice, which is not the same as the ticker being wrong
      throw new Stop(
        `Yahoo's unofficial endpoint refused this; it is not a published API and can block or rate-limit at any time. ${error.message}\nTake the closes from the exchange's own page or the company's IR page and write them into a CSV (references/sources.md).`,
      );
    }
    const result = data?.chart?.result?.[0];
    if (!result?.timestamp)
      throw new Stop(
        `Yahoo has no prices for "${ticker}" (${data?.chart?.error?.description ?? "no rows"}). A Korean listing ends in .KS (KOSPI) or .KQ (KOSDAQ); an index starts with ^.`,
      );
    const meta = result.meta;
    const close =
      result.indicators.adjclose?.[0]?.adjclose ??
      result.indicators.quote[0].close;
    const values = new Map();
    result.timestamp.forEach((t, i) => {
      if (close[i] === null || close[i] === undefined) return;
      const date = new Date((t + (meta.gmtoffset ?? 0)) * 1000)
        .toISOString()
        .slice(0, 10);
      values.set(date, String(+close[i].toFixed(4)));
    });
    series.set(ticker, values);
    names.push(`${ticker} (${meta.longName ?? meta.shortName ?? ticker})`);
    if (meta.currency) units.add(meta.currency);
  }
  return {
    series,
    title: `${names.join(", ")}, ${interval === "1d" ? "daily" : interval === "1wk" ? "weekly" : "monthly"} close adjusted for splits and dividends`,
    unit: [...units].join(", "),
    source: list(tickers)
      .map(
        (t) =>
          `https://finance.yahoo.com/quote/${encodeURIComponent(t)}/history`,
      )
      .join(" "),
    api: apis.join(" "),
  };
}

async function fx([base, quotes], { from, to }) {
  if (!base || !quotes)
    throw new Stop(
      "Name the currencies: fetch.mjs fx USD KRW,JPY --out fx.csv",
    );
  const baseCode = base.toUpperCase();
  const wanted = list(quotes).map((q) => q.toUpperCase());
  const start = from ?? day(String(new Date().getUTCFullYear() - 1));
  const api = `https://api.frankfurter.dev/v1/${start}..${to ?? ""}?base=${baseCode}&symbols=${wanted.join(",")}`;
  const data = await get(api);
  if (!data?.rates)
    throw new Stop(
      `No rates for ${base} → ${quotes}. Only the ECB's ~30 currencies are here: https://api.frankfurter.dev/v1/currencies`,
    );
  // Each day's rates arrive keyed by currency, in the API's own order, so the columns are
  // built in the order they were asked for: a --label binds by position
  const series = new Map();
  for (const quote of wanted) series.set(`${baseCode}/${quote}`, new Map());
  for (const [date, rates] of Object.entries(data.rates))
    for (const [quote, rate] of Object.entries(rates))
      series.get(`${baseCode}/${quote.toUpperCase()}`)?.set(date, String(rate));
  for (const quote of wanted)
    if (!series.get(`${baseCode}/${quote}`).size)
      throw new Stop(
        quote === baseCode
          ? `${baseCode}/${quote} is a currency against itself; drop it from the quotes.`
          : `No ${baseCode}/${quote} rate came back. The ECB publishes about 30 currencies: https://api.frankfurter.dev/v1/currencies`,
      );
  return {
    series,
    title: `${wanted
      .map((q) => `${baseCode}/${q}`)
      .join(
        ", ",
      )}, ECB reference rate (units of the quote per one ${baseCode})`,
    // The rates are the ECB's; the path to them is frankfurter.dev, and the figure credits both
    source:
      "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html https://frankfurter.dev",
    api,
  };
}

async function secCompany(ticker) {
  const headers = { "User-Agent": AGENT };
  if (/^\d+$/.test(ticker))
    return { cik: ticker.padStart(10, "0"), name: ticker, headers };
  const map = await get(
    "https://www.sec.gov/files/company_tickers.json",
    "json",
    headers,
  );
  const hit = Object.values(map ?? {}).find(
    (c) => c.ticker.toUpperCase() === ticker.toUpperCase(),
  );
  if (!hit)
    throw new Stop(
      `"${ticker}" is not a US filer's ticker on the SEC's list. Pass its CIK instead, or take the figures from its own filings.`,
    );
  return {
    cik: String(hit.cik_str).padStart(10, "0"),
    name: hit.title,
    headers,
  };
}

/** How long a reported figure covers, in days. A balance is an instant and has no start. */
const spanDays = (row) =>
  row.start ? (Date.parse(row.end) - Date.parse(row.start)) / 86_400_000 : 0;

/** The latest figure a company stated in an annual report, flow or balance alike. */
const lastAnnual = (rows) =>
  rows
    .filter(
      (row) =>
        /^(10-K|20-F|40-F)/.test(row.form ?? "") &&
        (!row.start || (spanDays(row) >= 350 && spanDays(row) <= 380)),
    )
    .reduce(
      (best, row) =>
        !best ||
        row.end > best.end ||
        (row.end === best.end && row.filed > best.filed)
          ? row
          : best,
      null,
    );

async function sec([ticker, concepts], { from, to, flags }) {
  if (!ticker)
    throw new Stop(
      "Name the company: fetch.mjs sec AAPL Revenues --out revenue.csv",
    );
  const { cik, name, headers } = await secCompany(ticker);
  if (flags.find) {
    const facts = await get(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
      "json",
      headers,
    );
    if (!facts?.facts)
      throw new Stop(
        `The SEC holds no XBRL facts for ${name} (CIK ${cik}) — a company that files on paper, or under a form without them, has none. Read the figures off its filings: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`,
      );
    const word = String(flags.find).toLowerCase();
    const hits = [];
    let searched = 0;
    for (const [taxonomy, group] of Object.entries(facts.facts))
      for (const [concept, fact] of Object.entries(group)) {
        searched++;
        if (!`${concept} ${fact.label}`.toLowerCase().includes(word)) continue;
        // The SEC's own `frame` dates a balance as CY2024Q4I, so matching CY2024 would
        // leave out assets and equity; the annual report is what flows and balances share
        const latest = lastAnnual(Object.values(fact.units).flat());
        if (latest)
          hits.push(
            `${taxonomy === "us-gaap" ? "" : `${taxonomy}:`}${concept} — ${fact.label}; latest ${latest.end} ${latest.val}`,
          );
      }
    hits.sort((a, b) => b.localeCompare(a));
    console.log(
      hits.length
        ? hits.join("\n")
        : `None of the ${searched} concepts ${name} reports mentions "${flags.find}". Try one word of the SEC's own wording: revenue, income, assets, equity, shares.`,
    );
    return null;
  }
  if (!concepts)
    throw new Stop(
      `Name the concept, or look for it: fetch.mjs sec ${ticker} --find revenue`,
    );
  const quarterly = Boolean(flags.quarterly);
  const derived = new Set();
  const series = new Map();
  const apis = [];
  const units = new Set();
  for (const full of list(concepts)) {
    const [taxonomy, concept] = full.includes(":")
      ? full.split(":")
      : ["us-gaap", full];
    const api = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${concept}.json`;
    apis.push(api);
    const data = await get(api, "json", headers);
    if (!data)
      throw new Stop(
        `${name} reports no "${full}". Look for the one it uses: fetch.mjs sec ${ticker} --find <word>`,
      );
    const [unit, rows] = Object.entries(data.units)[0];
    units.add(unit);
    // A period is a year or a quarter by its length, not by the filing's own labels; a later
    // filing's figure for the same period wins, since it carries any restatement
    const values = new Map();
    const filed = new Map();
    for (const row of rows) {
      if (!/^(10-K|10-Q|20-F|40-F)/.test(row.form ?? "")) continue;
      if (row.start) {
        const days = spanDays(row);
        if (quarterly ? days < 80 || days > 100 : days < 350 || days > 380)
          continue;
      } else if (!quarterly && row.fp !== "FY") continue;
      if ((filed.get(row.end) ?? "") > row.filed) continue;
      filed.set(row.end, row.filed);
      values.set(row.end, String(row.val));
    }
    // An annual report states the year, not its last quarter: that quarter is the year
    // less the three before it
    if (quarterly)
      for (const year of rows) {
        if (!year.start || !/^(10-K|20-F|40-F)/.test(year.form ?? "")) continue;
        const days = spanDays(year);
        if (days < 350 || days > 380 || values.has(year.end)) continue;
        const inside = [...values.entries()].filter(
          ([end]) => end > year.start && end < year.end,
        );
        if (inside.length !== 3) continue;
        values.set(
          year.end,
          String(year.val - inside.reduce((sum, [, v]) => sum + Number(v), 0)),
        );
        if ((!from || year.end >= from) && (!to || year.end <= to))
          derived.add(year.end);
      }
    series.set(concept, values);
  }
  return {
    series,
    title: `${name}, ${list(concepts).join(", ")} as reported to the SEC, ${quarterly ? "quarterly" : "fiscal years"} (dated by period end)`,
    unit: [...units].join(", "),
    note: derived.size
      ? `The quarters ending ${[...derived].sort().join(", ")} are the year less its first three quarters`
      : null,
    source: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K`,
    api: apis.join(" "),
  };
}

async function pageviews([articles], { from, to, flags }) {
  if (!articles)
    throw new Stop(
      "Name the article: fetch.mjs pageviews Bitcoin,Ethereum --out interest.csv",
    );
  const wiki = flags.wiki ?? "en";
  const start = (
    from ?? day(String(new Date().getUTCFullYear() - 2))
  ).replaceAll("-", "");
  // A month still under way reads as a fall; it ends at the last whole month
  const lastWhole = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 0),
  )
    .toISOString()
    .slice(0, 10);
  const end = (to && to < lastWhole ? to : lastWhole).replaceAll("-", "");
  const series = new Map();
  const apis = [];
  for (const article of list(articles)) {
    const title = article.replaceAll(" ", "_");
    const api = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${wiki}.wikipedia/all-access/user/${encodeURIComponent(title)}/monthly/${start}/${end}`;
    apis.push(api);
    const data = await get(api, "json", { "User-Agent": AGENT });
    if (!data?.items)
      throw new Stop(
        `${wiki}.wikipedia has no article "${article}" (the exact page title, as in its URL).`,
      );
    series.set(
      article,
      new Map(
        data.items.map((item) => [
          `${item.timestamp.slice(0, 4)}-${item.timestamp.slice(4, 6)}`,
          String(item.views),
        ]),
      ),
    );
  }
  return {
    series,
    title: `Monthly views of ${list(articles).join(", ")} on ${wiki}.wikipedia, people only — a measure of interest`,
    source: `https://pageviews.wmcloud.org/?project=${wiki}.wikipedia.org&pages=${list(
      articles,
    )
      .map((a) => encodeURIComponent(a.replaceAll(" ", "_")))
      .join("|")}`,
    api: apis.join(" "),
  };
}

const SOURCES = { fred, worldbank, yahoo, fx, sec, pageviews };

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const source = SOURCES[command];
  if (!source) throw new Stop(usage());
  // Asked for before the network, so a forgotten --out costs no request
  if (typeof flags.out !== "string" && !(command === "sec" && flags.find))
    throw new Stop("Say where the CSV goes: --out <file.csv>");
  const from = day(flags.from);
  const to = day(flags.to, true);
  const got = await source(positional, { from, to, flags });
  if (!got) return;

  const { names, rows: all } = join(got.series);
  const rows = clip(all, from, to);
  if (!rows.length)
    throw new Stop(
      `No rows between ${from ?? "the start"} and ${to ?? "today"}; the source has ${all.length ? `${all[0][0]} → ${all.at(-1)[0]}` : "none"}. A series that stops is discontinued: look for its successor.`,
    );
  // Columns come back in the order they were asked for, so a label binds to what it names
  const labels = list(flags.label);
  if (labels.length && labels.length !== names.length)
    throw new Stop(
      `--label gives ${labels.length} name(s) for ${names.length} column(s) (${names.join(", ")}). Name every column, in the order you asked for them.`,
    );
  const header = ["date", ...names.map((name, i) => labels[i] ?? name)];

  const lines = [
    `# title: ${got.title}`,
    ...(got.unit ? [`# unit: ${got.unit}`] : []),
    ...(got.note ? [`# note: ${got.note}`] : []),
    `# source: ${got.source}`,
    `# api: ${got.api}`,
    `# fetched: ${today}`,
    header.map(cell).join(","),
    ...rows.map((row) => row.map(cell).join(",")),
  ];
  mkdirSync(dirname(flags.out), { recursive: true });
  writeFileSync(flags.out, `${lines.join("\n")}\n`);

  // What the model needs to go on without opening the file: its shape and both ends
  const missing = rows.reduce(
    (n, row) => n + row.slice(1).filter((v) => v === "").length,
    0,
  );
  const summary = [
    `Wrote ${flags.out}: ${rows.length} rows × ${names.length} series, ${rows[0][0]} → ${rows.at(-1)[0]}${missing ? `, ${missing} empty cells (no value published)` : ""}.`,
    `${got.title}${got.unit ? ` [${got.unit}]` : ""}`,
    ...(got.note ? [`Note: ${got.note}`] : []),
    `first: ${header
      .slice(1)
      .map(
        (h, i) => `${h}=${rows.find((r) => r[i + 1] !== "")?.[i + 1] ?? "—"}`,
      )
      .join(", ")}`,
    `last:  ${header
      .slice(1)
      .map(
        (h, i) =>
          `${h}=${rows.findLast((r) => r[i + 1] !== "")?.[i + 1] ?? "—"} (${rows.findLast((r) => r[i + 1] !== "")?.[0] ?? "—"})`,
      )
      .join(", ")}`,
  ];
  console.log(summary.join("\n"));
}

main().catch((error) => {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exitCode = 1;
});
