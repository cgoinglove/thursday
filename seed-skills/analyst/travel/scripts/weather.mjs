#!/usr/bin/env node
/**
 * Weather for a place over the trip's days, one line a day. Within the forecast's reach
 * (16 days) it is the forecast; further out it is what the same days were like over the
 * last five years, which is what "what will it be like" can honestly get. Open-Meteo,
 * no key, no browser.
 *
 *   node weather.mjs "<place>[, <country code>]" <from YYYY-MM-DD> [<to YYYY-MM-DD>] [--f]
 *
 * "Fukuoka, JP" picks Japan's Fukuoka when a name exists in several countries. --f prints °F.
 */
import {
  addDays,
  day,
  fail,
  getJson,
  nightsBetween,
  parseArgs,
} from "./lib.mjs";

const REACH = 16;
const YEARS = 5;
/** WMO weather codes, as Open-Meteo returns them. */
const SKY = {
  0: "clear",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  56: "freezing drizzle",
  57: "freezing drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  77: "snow grains",
  80: "showers",
  81: "showers",
  82: "violent showers",
  85: "snow showers",
  86: "snow showers",
  95: "thunderstorm",
  96: "thunderstorm, hail",
  99: "thunderstorm, hail",
};

const opts = parseArgs();
const [where, fromArg, toArg] = opts._;
if (!where || !fromArg)
  fail(
    'usage: node weather.mjs "<place>[, <country code>]" <from YYYY-MM-DD> [<to YYYY-MM-DD>] [--f]',
  );
const from = day(fromArg, "The first day");
const to = toArg ? day(toArg, "The last day") : from;
if (to < from) fail("The last day is before the first.");
if (nightsBetween(from, to) > 30) fail("Ask for 31 days or fewer.");
const unit = opts.f ? "fahrenheit" : "celsius";
const deg = (v) => (v == null ? "?" : `${Math.round(v)}°`);

const [name, country] = where.split(",").map((s) => s.trim());
const found = await getJson(
  `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en`,
);
const places = (found.results ?? []).filter(
  (p) => !country || p.country_code?.toLowerCase() === country.toLowerCase(),
);
if (!places.length)
  fail(
    `No place called "${where}". Try the city's English name, or the nearest city, with its country code ("Gangneung, KR").`,
  );
const place = places.sort(
  (a, b) => (b.population ?? 0) - (a.population ?? 0),
)[0];
const at = `latitude=${place.latitude}&longitude=${place.longitude}&timezone=auto&temperature_unit=${unit}`;
console.log(
  `${place.name}, ${[place.admin1, place.country].filter(Boolean).join(", ")} (${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)}), ${place.timezone}`,
);

// Open-Meteo counts its reach from today in UTC
const today = new Date().toISOString().slice(0, 10);
const last = addDays(today, REACH - 1);
const weekday = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

if (from <= last && to >= today) {
  const end = to < last ? to : last;
  const start = from > today ? from : today;
  const f = await getJson(
    `https://api.open-meteo.com/v1/forecast?${at}&start_date=${start}&end_date=${end}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset`,
  );
  const d = f.daily;
  console.log(`Forecast (Open-Meteo), high/low, chance of rain:`);
  d.time.forEach((t, i) =>
    console.log(
      `${weekday(t)}  ${deg(d.temperature_2m_max[i])}/${deg(d.temperature_2m_min[i])}  rain ${d.precipitation_probability_max[i] ?? "?"}% ${d.precipitation_sum[i] ? `${d.precipitation_sum[i]}mm` : ""}  ${SKY[d.weather_code[i]] ?? `code ${d.weather_code[i]}`}  sun ${d.sunrise[i].slice(11)}–${d.sunset[i].slice(11)}`.replace(
        / {3,}/g,
        "  ",
      ),
    ),
  );
  if (to > last)
    console.log(
      `After ${weekday(last)} there is no forecast yet: run this again closer to the day.`,
    );
} else {
  // Same calendar days in each of the last YEARS years, from the archive in one request
  const year = Number(today.slice(0, 4));
  const span = nightsBetween(from, to);
  const md = from.slice(4);
  const lastYear = year - 1 + (`${year}${md}` < today ? 1 : 0);
  const first = `${lastYear - YEARS + 1}${md}`;
  const a = await getJson(
    `https://archive-api.open-meteo.com/v1/archive?${at}&start_date=${first}&end_date=${addDays(`${lastYear}${md}`, span)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum`,
  );
  const want = new Set();
  for (let y = lastYear - YEARS + 1; y <= lastYear; y++)
    for (let i = 0; i <= span; i++) want.add(addDays(`${y}${md}`, i));
  const rows = a.daily.time
    .map((t, i) => ({
      t,
      hi: a.daily.temperature_2m_max[i],
      lo: a.daily.temperature_2m_min[i],
      rain: a.daily.precipitation_sum[i],
    }))
    .filter((r) => want.has(r.t) && r.hi != null);
  if (!rows.length) fail("The archive returned no days for those dates.");
  const avg = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  const range = (k) =>
    `${deg(Math.min(...rows.map((r) => r[k])))}–${deg(Math.max(...rows.map((r) => r[k])))}`;
  const wet = rows.filter((r) => r.rain >= 1);
  console.log(
    `No forecast reaches ${weekday(from)} yet (it covers the next ${REACH} days). The same days in ${lastYear - YEARS + 1}–${lastYear} (Open-Meteo archive, ${rows.length} days):`,
  );
  console.log(
    `Highs ${deg(avg("hi"))} on average (${range("hi")}), lows ${deg(avg("lo"))} (${range("lo")}). Rain on ${wet.length} of ${rows.length} days${wet.length ? `, ${Math.round(wet.reduce((s, r) => s + r.rain, 0) / wet.length)} mm on a wet day` : ""}.`,
  );
}
