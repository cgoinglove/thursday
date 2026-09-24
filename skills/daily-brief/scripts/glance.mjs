#!/usr/bin/env node
/**
 * What a brief shows at a glance, fetched rather than typed: the day's weather for a place
 * (Open-Meteo), the last close and daily move of markets (FRED's published series: indices,
 * coins, rates, oil) and currency pairs (the ECB's reference rates, through frankfurter.dev).
 * No key for any. Writes --out for page.mjs and prints one line each.
 *
 *   node glance.mjs --out glance.json [--weather "<place>"] [--markets "<label>:<id>,…"]
 *     [--lang en] [--units c|f]
 *
 * A market is a FRED series id (SP500, NASDAQCOM, DJIA, NIKKEI225, CBBTCUSD, DGS10) or a
 * pair of currency codes (EUR/USD); "<label>:" before it names it on the page.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { get, list, parseArgs, run, Stop } from "./lib.mjs";

const USAGE =
  'usage: node glance.mjs --out glance.json [--weather "Lisbon"] [--markets "S&P 500:SP500,EUR/USD,Bitcoin:CBBTCUSD"] [--lang en] [--units c|f]';

// Days asked for, so a weekend and a holiday still leave two closes to compare
const LOOKBACK_DAYS = 14;

// WMO weather codes, folded into the few a picture tells apart
const SKY = [
  [[0], "clear"],
  [[1, 2], "partly"],
  [[3], "cloudy"],
  [[45, 48], "fog"],
  [[51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82], "rain"],
  [[71, 73, 75, 77, 85, 86], "snow"],
  [[95, 96, 99], "storm"],
];
const skyOf = (code) =>
  SKY.find(([codes]) => codes.includes(code))?.[1] ?? "cloudy";

async function json(url) {
  const res = await get(url, { headers: { accept: "application/json" } });
  if (!res.ok)
    throw new Error(`${url.split("?")[0]} answered ${res.status || res.error}`);
  return res.json();
}

async function weather(place, lang, units) {
  const found = await json(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=${lang}`,
  );
  const at = found.results?.[0];
  if (!at)
    throw new Error(
      `Open-Meteo knows no place called "${place}": try the city's name in English`,
    );
  const f = await json(
    `https://api.open-meteo.com/v1/forecast?latitude=${at.latitude}&longitude=${at.longitude}` +
      "&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code" +
      `&timezone=auto&forecast_days=1${units === "f" ? "&temperature_unit=fahrenheit" : ""}`,
  );
  return {
    place: at.name,
    region: [at.admin1, at.country].filter(Boolean).join(", "),
    unit: units === "f" ? "°F" : "°C",
    now: Math.round(f.current.temperature_2m),
    high: Math.round(f.daily.temperature_2m_max[0]),
    low: Math.round(f.daily.temperature_2m_min[0]),
    rain: f.daily.precipitation_probability_max[0] ?? null,
    sky: skyOf(f.daily.weather_code[0]),
    skyNow: skyOf(f.current.weather_code),
  };
}

const daysAgo = (n) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** The last two closes of a series, oldest first, as [date, value] pairs. */
const lastTwo = (rows) => {
  const two = rows.filter(([, v]) => Number.isFinite(v)).slice(-2);
  if (two.length < 2) throw new Error("fewer than two closes in two weeks");
  return two;
};

/** A pair's last two ECB reference rates: units of the quote for one of the base. */
async function pair(base, quote) {
  const data = await json(
    `https://api.frankfurter.dev/v1/${daysAgo(LOOKBACK_DAYS)}..?base=${base}&symbols=${quote}`,
  );
  return {
    rows: lastTwo(
      Object.entries(data.rates ?? {}).map(([date, r]) => [date, r[quote]]),
    ),
    currency: quote,
    source: "ECB via frankfurter.dev",
  };
}

/** A FRED series' last two observations, from the CSV its own page offers for download. */
async function fred(id) {
  const res = await get(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${daysAgo(LOOKBACK_DAYS)}`,
  );
  const text = res.ok ? await res.text() : "";
  if (!text.startsWith("observation_date"))
    throw new Error(
      res.status === 404
        ? `FRED has no series "${id}": find its id on fred.stlouisfed.org`
        : `FRED answered ${res.status || res.error}`,
    );
  return {
    rows: lastTwo(
      text
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => line.split(","))
        .map(([date, v]) => [date, v === "." || !v ? Number.NaN : Number(v)]),
    ),
    currency: "",
    source: "FRED",
  };
}

// A market as the glance took it before: a Yahoo symbol, said plainly rather than looked up
const NOT_AN_ID =
  "is not a FRED series id or a currency pair. The glance reads FRED and the ECB, not Yahoo: ^GSPC is SP500, ^IXIC NASDAQCOM, ^DJI DJIA, ^N225 NIKKEI225, BTC-USD CBBTCUSD, ETH-USD CBETHUSD, ^TNX DGS10, EURUSD=X EUR/USD. An index FRED does not carry, or one company's shares, has no place in the glance";

/** A market's last close and its move on the one before. */
async function market(spec) {
  const at = spec.indexOf(":");
  const [label, id] =
    at > 0
      ? [spec.slice(0, at).trim(), spec.slice(at + 1).trim()]
      : [null, spec];
  const currencies = id.toUpperCase().match(/^([A-Z]{3})\/([A-Z]{3})$/);
  if (!currencies && !/^[A-Za-z0-9_]+$/.test(id))
    throw new Error(`"${id}" ${NOT_AN_ID}`);
  const got = currencies
    ? await pair(currencies[1], currencies[2])
    : await fred(id.toUpperCase());
  const [[, prev], [date, price]] = got.rows;
  return {
    label: label ?? id,
    symbol: id,
    price,
    change: price - prev,
    pct: ((price - prev) / prev) * 100,
    currency: got.currency,
    at: date,
    source: got.source,
  };
}

run(async () => {
  const opts = parseArgs();
  if (!opts.out || (!opts.weather && !opts.markets)) throw new Stop(USAGE);
  const lang = String(opts.lang ?? "en");
  const units = String(opts.units ?? "c").toLowerCase();
  const failed = [];
  const safe = (p, what) =>
    p.catch((error) => {
      failed.push(`${what}: ${error.message}`);
      return null;
    });
  const [sky, markets] = await Promise.all([
    opts.weather
      ? safe(weather(String(opts.weather), lang, units), "weather")
      : null,
    Promise.all(list(opts.markets).map((m) => safe(market(m), m))),
  ]);
  const glance = { weather: sky, markets: markets.filter(Boolean) };
  const out = resolve(String(opts.out));
  writeFileSync(out, JSON.stringify(glance, null, 1));
  if (sky)
    console.log(
      `${sky.place}: ${sky.now}${sky.unit} now, ${sky.low}–${sky.high}${sky.unit}, ${sky.sky}, rain ${sky.rain ?? "?"}%`,
    );
  for (const m of glance.markets)
    console.log(
      `${m.label} (${m.symbol}): ${m.price.toLocaleString("en-US", { maximumFractionDigits: 4 })}${m.currency ? ` ${m.currency}` : ""}, ${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(2)}% on the close before, as of the close on ${m.at} (${m.source})`,
    );
  for (const f of failed) console.log(`Not fetched — ${f}`);
  console.log(out);
  if (!sky && !glance.markets.length)
    throw new Stop("Nothing came back for the glance.");
});
