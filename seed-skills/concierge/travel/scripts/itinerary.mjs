#!/usr/bin/env node
/**
 * The trip as one page: cover, flights, the stay, weather, day by day with a real
 * photo and a map link per stop, and the costs. Written from a small JSON file
 * (references/itinerary.md shows every field) into the bot's artifacts folder as one
 * HTML file with its pictures inside, so it opens offline and prints.
 *
 *   node itinerary.mjs <trip.json> [--name <file name>]
 *
 * A photo is `"wiki": "<Wikipedia title>"` (another language as "pt:Mosteiro dos Jerónimos"),
 * `"photo": "<web page url>"` (its own picture, through the browser skill's webimage.mjs),
 * or `"photo": "<local image path>"` (relative to the JSON file).
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, money, parseArgs } from "./lib.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u;
// Wikimedia turns away a user agent that does not say what the tool is and where it lives
const AGENT = "thursday-agent travel (https://github.com/cgoinglove/thursday)";

const opts = parseArgs();
const source = opts._[0] && resolve(opts._[0]);
if (!source) fail("usage: node itinerary.mjs <trip.json> [--name <file name>]");
if (!existsSync(source)) fail(`No such file: ${source}`);
let trip;
try {
  trip = JSON.parse(readFileSync(source, "utf8"));
} catch (error) {
  fail(`${source} is not valid JSON: ${error.message}`);
}
const name = String(
  opts.name ?? source.replace(/^.*\//, "").replace(/\.json$/, ""),
);
if (!NAME.test(name))
  fail(`"${name}" is not a file name: letters, numbers, - and _ only.`);
if (!trip.title) fail('The JSON needs a "title".');
if (!Array.isArray(trip.days) || !trip.days.length)
  fail('The JSON needs "days": [{ "date", "title", "stops": [...] }].');
trip.days.forEach((d, i) => {
  if (!Array.isArray(d.stops) || !d.stops.length)
    fail(`Day ${i + 1} has no "stops".`);
  d.stops.forEach((s, j) => {
    if (!s.name) fail(`Day ${i + 1}, stop ${j + 1} has no "name".`);
  });
});
// Every address the page links to, checked here so a typo costs no photo fetch
const ABSOLUTE = /^https?:\/\/[^/\s]+/;
for (const [url, where] of [
  ...(trip.flights?.link ? [[trip.flights.link, '"flights.link"']] : []),
  ...(trip.stay?.link ? [[trip.stay.link, '"stay.link"']] : []),
  ...trip.days.flatMap((d, i) =>
    d.stops.flatMap((s, j) =>
      s.link
        ? [[s.link, `Day ${i + 1}, stop ${j + 1} ("${s.name}") "link"`]]
        : [],
    ),
  ),
  ...(Array.isArray(trip.sources) ? trip.sources : []).flatMap((s, i) =>
    typeof s === "string" ? [] : [[s?.url, `"sources"[${i}] "url"`]],
  ),
])
  if (!ABSOLUTE.test(String(url ?? "")))
    fail(
      `${where} is "${url ?? ""}", not a full address: write it with https:// or leave it out.`,
    );

/** The app's workspace: the nearest folder above holding its fence and a `projects` folder. */
function findWorkspace() {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (
      existsSync(join(dir, "pnpm-workspace.yaml")) &&
      existsSync(join(dir, "projects"))
    )
      return dir;
    if (dir === dirname(dir)) return process.cwd();
  }
}
const WORKSPACE = findWorkspace();
const out = join(
  WORKSPACE,
  process.env.THURSDAY_ARTIFACTS || "artifacts",
  `${name}.html`,
);

const cur = String(trip.currency ?? "USD").toUpperCase();
const lang = String(trip.lang ?? "en");
const place = String(trip.place ?? "");
const L = {
  flights: "Getting there",
  stay: "Where you stay",
  weather: "Weather",
  days: "Day by day",
  costs: "What it costs",
  notes: "Before you go",
  total: "Total",
  perPerson: "per person",
  map: "Map",
  route: "The day's route in Google Maps",
  book: "Booking page",
  night: "night",
  nights: "nights",
  day: "Day",
  sources: "Sources",
  ...trip.labels,
};

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmtDay = (iso, withWeekday = true) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? ""))) return esc(iso);
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang, {
    ...(withWeekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};
const cost = (v) => (typeof v === "number" ? money(v, cur) : esc(v));
const mapsSearch = (q) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const mapQuery = (s) => s.map ?? [s.name, place].filter(Boolean).join(", ");

// ---- Photos, fetched once each and put inside the page

const photoJobs = new Map();
const missing = [];

/** A fetch that waits and tries again when told it asked too fast (Wikimedia's 429). */
async function polite(url, headers = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { "user-agent": AGENT, ...headers },
      signal: AbortSignal.timeout(30000),
    });
    if (res.status !== 429 || attempt === 3) return res;
    const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
    await new Promise((done) => setTimeout(done, Math.min(wait, 10) * 1000));
  }
}
async function getJson(url) {
  const res = await polite(url);
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).hostname}`);
  return res.json();
}
async function dataUri(url) {
  const res = await polite(url);
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).hostname}`);
  const type = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0];
  if (!type.startsWith("image/")) throw new Error(`${type} is not a picture`);
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}
const plain = (html) =>
  String(html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** A Wikipedia article's own lead picture, with who made it and its licence from Commons. */
async function fromWiki(title) {
  const [wiki, name] = /^[a-z]{2,3}:/.test(title)
    ? [title.slice(0, title.indexOf(":")), title.slice(title.indexOf(":") + 1)]
    : ["en", title];
  const api = `https://${wiki}.wikipedia.org/w/api.php?format=json&action=query&redirects=1`;
  const q = await getJson(
    `${api}&prop=pageimages|info&inprop=url&piprop=thumbnail|name&pithumbsize=960&titles=${encodeURIComponent(name)}`,
  );
  const page = Object.values(q.query?.pages ?? {})[0];
  if (!page || "missing" in page)
    throw new Error(`no ${wiki} Wikipedia article "${name}"`);
  if (!page.thumbnail) throw new Error(`"${name}" has no lead picture`);
  let credit = "Wikipedia";
  for (const host of ["commons.wikimedia.org", `${wiki}.wikipedia.org`]) {
    try {
      const m = await getJson(
        `https://${host}/w/api.php?format=json&action=query&prop=imageinfo&iiprop=extmetadata&titles=${encodeURIComponent(`File:${page.pageimage}`)}`,
      );
      const meta = Object.values(m.query?.pages ?? {})[0]?.imageinfo?.[0]
        ?.extmetadata;
      if (!meta) continue;
      credit = [
        plain(meta.Artist?.value).slice(0, 40),
        meta.LicenseShortName?.value,
      ]
        .filter(Boolean)
        .join(", ");
      break;
    } catch {}
  }
  return {
    src: await dataUri(page.thumbnail.source),
    credit,
    href: page.fullurl,
  };
}

/** A web page's own picture, through the shipped webimage script and this shell's browser. */
function fromPage(url) {
  const script = join(
    process.env.THURSDAY_SKILLS ?? "",
    "browser/scripts/webimage.mjs",
  );
  if (!process.env.THURSDAY_SKILLS || !existsSync(script))
    throw new Error("THURSDAY_SKILLS is not set: run this from a bot's shell");
  const dir = mkdtempSync(join(tmpdir(), "trip-photo-"));
  try {
    const said = execFileSync(process.execPath, [script, url, "--out", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const file = said.match(/^(\S+\.(?:jpg|png|webp|gif|avif))/m)?.[1];
    if (!file) throw new Error("no picture came back");
    const credit = said.match(/^Credit: (.+)$/m)?.[1] ?? url;
    return { src: fromFile(file).src, credit, href: url };
  } catch (error) {
    throw new Error(
      String(error.stderr || error.message)
        .trim()
        .split("\n")[0],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fromFile(path) {
  const file = resolve(dirname(source), path);
  if (!existsSync(file)) throw new Error(`no file ${file}`);
  const type =
    {
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".avif": "image/avif",
    }[extname(file).toLowerCase()] ?? "image/jpeg";
  return {
    src: `data:${type};base64,${readFileSync(file).toString("base64")}`,
    credit: "",
    href: "",
  };
}

/** Queue a picture for `thing` ({ wiki } or { photo }); the page reads it back after. */
function want(thing, label) {
  const key = thing.wiki
    ? `wiki:${thing.wiki}`
    : thing.photo
      ? `photo:${thing.photo}`
      : null;
  if (!key) return null;
  if (!photoJobs.has(key))
    photoJobs.set(key, {
      label,
      run: () =>
        thing.wiki
          ? fromWiki(thing.wiki)
          : /^https?:\/\//.test(thing.photo)
            ? fromPage(thing.photo)
            : fromFile(thing.photo),
    });
  return key;
}

const coverKey = trip.cover ? want(trip.cover, "cover") : null;
const stayKey = trip.stay ? want(trip.stay, trip.stay.name) : null;
const stopKeys = trip.days.map((d) => d.stops.map((s) => want(s, s.name)));

const photos = new Map();
// One at a time: Wikimedia answers a burst with 429
for (const [key, job] of photoJobs) {
  try {
    photos.set(key, await job.run());
  } catch (error) {
    missing.push(`${job.label}: ${error.message}`);
  }
}

const figure = (key, cls = "") => {
  const p = key && photos.get(key);
  if (!p) return "";
  const credit = p.credit
    ? `<figcaption>${p.href ? `<a href="${esc(p.href)}">${esc(p.credit)}</a>` : esc(p.credit)}</figcaption>`
    : "";
  return `<figure class="${cls}"><img src="${p.src}" alt="">${credit}</figure>`;
};

// ---- The page

const parts = [];
const cover = coverKey && photos.get(coverKey);
parts.push(
  `<header class="cover${cover ? "" : " plain"}">${cover ? `<img src="${cover.src}" alt="">` : ""}${
    cover?.credit
      ? `<div class="credit">${cover.href ? `<a href="${esc(cover.href)}">${esc(cover.credit)}</a>` : esc(cover.credit)}</div>`
      : ""
  }<div class="over"><h1>${esc(trip.title)}</h1>${trip.lede ? `<p class="lede">${esc(trip.lede)}</p>` : ""}</div></header>`,
);

const costs = Array.isArray(trip.costs) ? trip.costs : [];
const total = costs.reduce(
  (s, c) => s + (typeof c.amount === "number" ? c.amount : 0),
  0,
);
const people = Number(trip.travelers ?? 0);
const facts = [
  ...(trip.facts ?? []).map((f) => [f.value, f.label]),
  ...(costs.length
    ? [
        [
          money(total, cur),
          people > 1
            ? `${L.total} · ${money(total / people, cur)} ${L.perPerson}`
            : L.total,
          "total",
        ],
      ]
    : []),
];
if (facts.length)
  parts.push(
    `<section class="facts">${facts
      .map(
        ([v, l, cls]) =>
          `<div class="fact ${cls ?? ""}"><b class="num">${esc(v)}</b><span>${esc(l)}</span></div>`,
      )
      .join("")}</section>`,
  );

if (trip.flights?.legs?.length) {
  const f = trip.flights;
  const legs = f.legs
    .map(
      (
        g,
      ) => `<div class="leg"><div class="when"><b>${esc(g.label ?? "")}</b>${fmtDay(g.date)}</div>
<div class="hop"><div class="end"><b>${esc(g.dep)}</b><span>${esc(g.from)}</span></div><div class="line">${esc([g.duration, g.stops].filter(Boolean).join(" · "))}</div><div class="end"><b>${esc(g.arr)}</b><span>${esc(g.to)}</span></div></div>
<div class="who">${esc(g.airline ?? "")}${g.price != null ? `<br><span class="price">${cost(g.price)}</span>` : ""}</div></div>`,
    )
    .join("");
  const foot = [
    f.price != null
      ? `<span><span class="price">${cost(f.price)}</span>${f.priceNote ? ` <small>${esc(f.priceNote)}</small>` : ""}</span>`
      : "",
    f.link ? `<a href="${esc(f.link)}">${esc(L.book)}</a>` : "",
  ].filter(Boolean);
  parts.push(
    `<h2>${esc(L.flights)}</h2><section class="panel">${legs}${foot.length ? `<div class="panel-foot">${foot.join("")}</div>` : ""}</section>`,
  );
  if (f.note) parts.push(`<p class="muted">${esc(f.note)}</p>`);
}

if (trip.stay) {
  const s = trip.stay;
  const nights = Number(s.nights ?? 0);
  const line = [
    s.price != null
      ? `<span class="price">${cost(s.price)}</span> / ${esc(L.night)}`
      : "",
    nights && typeof s.price === "number"
      ? `${money(s.price * nights, cur)} · ${nights} ${esc(nights > 1 ? L.nights : L.night)}`
      : "",
    s.rating ? `★ ${esc(s.rating)}` : "",
  ].filter(Boolean);
  parts.push(
    `<h2>${esc(L.stay)}</h2><section class="panel stay${figure(stayKey) ? "" : " bare"}">${figure(stayKey)}<div class="body"><h3>${esc(s.name)}</h3>${
      s.area ? `<div class="muted">${esc(s.area)}</div>` : ""
    }<p>${line.join(" &nbsp;·&nbsp; ")}</p>${s.why ? `<p>${esc(s.why)}</p>` : ""}<p><a href="${esc(mapsSearch(mapQuery(s)))}">${esc(L.map)}</a>${
      s.link ? ` &nbsp; <a href="${esc(s.link)}">${esc(L.book)}</a>` : ""
    }</p></div></section>`,
  );
}

const withWeather = trip.days.filter((d) => d.weather);
if (withWeather.length || trip.climate) {
  parts.push(`<h2>${esc(L.weather)}</h2>`);
  if (trip.climate) parts.push(`<p>${esc(trip.climate)}</p>`);
  if (withWeather.length)
    parts.push(
      `<section class="weather">${withWeather.map((d) => `<div><b>${fmtDay(d.date)}</b>${esc(d.weather)}</div>`).join("")}</section>`,
    );
}

parts.push(`<h2>${esc(L.days)}</h2>`);
trip.days.forEach((d, i) => {
  const stops = d.stops
    .map((s, j) => {
      const pic = figure(stopKeys[i][j]);
      const links = [
        s.map !== false
          ? `<a href="${esc(mapsSearch(mapQuery(s)))}">${esc(L.map)}</a>`
          : "",
        s.link
          ? `<a href="${esc(s.link)}">${esc(s.linkText ?? new URL(s.link).hostname.replace(/^www\./, ""))}</a>`
          : "",
        s.cost != null ? `<span class="cost">${cost(s.cost)}</span>` : "",
      ].filter(Boolean);
      return `<li class="stop${pic ? "" : " bare"}"><time>${esc(s.time ?? "")}</time><div><h4>${esc(s.name)}</h4>${
        s.what ? `<p>${esc(s.what)}</p>` : ""
      }${s.tip ? `<div class="tip">${esc(s.tip)}</div>` : ""}${links.length ? `<div class="links">${links.join("")}</div>` : ""}</div>${pic}</li>`;
    })
    .join("");
  // One link opens every stop of the day in order, with transit between them
  const stopsOnMap = d.stops.filter((s) => s.map !== false).map(mapQuery);
  const route =
    stopsOnMap.length > 1
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(stopsOnMap[0])}&destination=${encodeURIComponent(stopsOnMap.at(-1))}${
          stopsOnMap.length > 2
            ? `&waypoints=${encodeURIComponent(stopsOnMap.slice(1, -1).slice(0, 8).join("|"))}`
            : ""
        }&travelmode=${d.travel ?? trip.travel ?? "transit"}`
      : null;
  parts.push(
    `<article class="panel day"><header><span class="n">${esc(L.day)} ${i + 1}</span><h3>${esc(d.title ?? "")}</h3><span class="meta">${fmtDay(d.date)}${
      d.weather ? ` · <span class="sky">${esc(d.weather)}</span>` : ""
    }</span></header><ol class="stops">${stops}</ol>${route ? `<footer><a href="${esc(route)}">${esc(L.route)}</a></footer>` : ""}</article>`,
  );
});

if (costs.length) {
  const rows = costs
    .map(
      (c) =>
        `<tr><td>${esc(c.item)}${c.note ? `<small>${esc(c.note)}</small>` : ""}</td><td class="num">${cost(c.amount)}</td></tr>`,
    )
    .join("");
  parts.push(
    `<h2>${esc(L.costs)}</h2><section class="panel"><table><tbody>${rows}<tr class="total"><td>${esc(L.total)}${
      people > 1
        ? `<small>${money(total / people, cur)} ${esc(L.perPerson)}</small>`
        : ""
    }</td><td class="num">${money(total, cur)}</td></tr></tbody></table>${trip.fx ? `<div class="fx">${esc(trip.fx)}</div>` : ""}</section>`,
  );
}

if (trip.notes?.length)
  parts.push(
    `<h2>${esc(L.notes)}</h2><section class="panel"><ul class="notes">${trip.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></section>`,
  );

if (trip.sources?.length)
  parts.push(
    `<p class="sources">${esc(L.sources)}: ${trip.sources
      .map((s) =>
        typeof s === "string"
          ? esc(s)
          : `<a href="${esc(s.url)}">${esc(s.label ?? new URL(s.url).hostname)}</a>`,
      )
      .join(" · ")}</p>`,
  );

const css = readFileSync(join(SKILL, "page", "itinerary.css"), "utf8").trim();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(trip.title)}</title>
<style>
${css}
</style>
</head>
<body>
<main>
${parts.join("\n")}
</main>
</body>
</html>
`,
);
const kb = Math.round(statSync(out).size / 1024);
console.log(
  `${relative(WORKSPACE, out)} (${kb} KB, ${photos.size} photo${photos.size === 1 ? "" : "s"} inside). One file that opens offline; hand back this path.`,
);
if (missing.length)
  console.log(
    `No photo for: ${missing.join("; ")}. Give those a "wiki" title that exists — a place abroad often has one only in its own language's Wikipedia ("pt:Mosteiro dos Jerónimos", "de:Kölner Dom") — or a "photo" page url, or leave them without one.`,
  );
if (!lang.startsWith("en") && !trip.labels)
  console.log(
    `The page is in "${lang}" but its own headings are English: add "labels" in that language (references/itinerary.md) and build again.`,
  );
