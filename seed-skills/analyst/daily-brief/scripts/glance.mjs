#!/usr/bin/env node
/**
 * What a brief shows at a glance, fetched rather than typed: the day's weather for a
 * place (Open-Meteo) and the last price and daily move of markets, currencies and coins
 * (Yahoo Finance). No key for either. Writes --out for page.mjs and prints one line each.
 *
 *   node glance.mjs --out glance.json [--weather "<place>"] [--markets "<label>:<symbol>,…"]
 *     [--lang en] [--units c|f]
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { get, list, parseArgs, run, Stop } from "./lib.mjs";

const USAGE =
  'usage: node glance.mjs --out glance.json [--weather "Lisbon"] [--markets "S&P 500:^GSPC,EUR/USD:EURUSD=X,BTC-USD"] [--lang en] [--units c|f]';

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

// Yahoo answers a browser's user agent without its cookies with 429; an honest one passes
const HEADERS = {
  accept: "application/json",
  "user-agent": "thursday-agent daily-brief",
};

async function json(url) {
  const res = await get(url, { headers: HEADERS });
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

/**
 * A market's last price and daily move. The chart address is the one finance.yahoo.com
 * draws its own pages from, not a published API: it takes no key, and it can rate-limit,
 * change shape or go away without notice. Yahoo's own word for a symbol it does not know
 * comes back in `chart.error`, which is why the body is read whatever the status is.
 */
async function market(spec) {
  const at = spec.indexOf(":");
  const [label, symbol] =
    at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [null, spec];
  const res = await get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
    { headers: HEADERS },
  );
  const body = res.json ? await res.json().catch(() => null) : null;
  const said = body?.chart?.error;
  if (said)
    throw new Error(
      `Yahoo Finance answers "${said.description ?? said.code}" for ${symbol}: look the symbol up on finance.yahoo.com`,
    );
  const r = body?.chart?.result?.[0];
  if (!r)
    throw new Error(
      `no numbers for ${symbol}: Yahoo's chart endpoint answered ${res.status || res.error} and it is the site's own, not a published API — it rate-limits and changes without notice. Leave the markets out today, or take them from somewhere else`,
    );
  const closes = (r.indicators?.quote?.[0]?.close ?? []).filter(
    (c) => c != null,
  );
  const price = r.meta.regularMarketPrice ?? closes.at(-1);
  const prev = closes.length > 1 ? closes.at(-2) : r.meta.chartPreviousClose;
  return {
    label: label ?? r.meta.shortName ?? symbol,
    symbol,
    price,
    change: price - prev,
    pct: ((price - prev) / prev) * 100,
    currency: r.meta.currency ?? "",
    at: new Date(r.meta.regularMarketTime * 1000).toISOString(),
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
      `${m.label} (${m.symbol}): ${m.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${m.currency}, ${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(2)}% on the day before, as of ${m.at.slice(0, 16)}Z`,
    );
  for (const f of failed) console.log(`Not fetched — ${f}`);
  console.log(out);
  if (!sky && !glance.markets.length)
    throw new Stop("Nothing came back for the glance.");
});
