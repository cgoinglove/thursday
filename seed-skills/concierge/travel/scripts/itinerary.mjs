#!/usr/bin/env node
/**
 * The trip as one page a traveller wants to open: photos first, what it costs and what is
 * still to book always in view, the route at a glance, what to do before leaving, then day by
 * day — each place with its pictures, what to do there, what to watch for and its price, each
 * move between places a line of its own — and more places, the costs, what to know before
 * going and the notes. Written from a small JSON file (references/itinerary.md shows every
 * field) into the bot's artifacts folder as one HTML file with its pictures inside, so it opens
 * offline and prints. Every picture opens large, one after another. It wears the artifact
 * skill's shell, as every page a bot makes does: the maker's face and name in its head and at
 * its end, the app's type, the maker's colour as its one accent.
 *
 *   node itinerary.mjs <trip.json> [--name <file name>]
 *
 * A photo is `"wiki": "<Wikipedia title>"` (another language as "pt:Mosteiro dos Jerónimos"),
 * `"photo": "<web page url>"` (its own picture, through the browser skill's webimage.mjs),
 * or `"photo": "<local image path>"` (relative to the JSON file). A stop with a `wiki` title
 * also gets a few more of the place's own pictures from its Wikimedia Commons category.
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { fail, money, parseArgs } from "./lib.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u;
// Wikimedia turns away a user agent that does not say what the tool is and where it lives
const AGENT =
  "thursday-agent travel (https://github.com/cgoinglove/thursday-agent)";
/** More pictures of a place from its Commons category, beside its lead picture. */
const GALLERY = 3;
/**
 * Pictures on one page at most: each is carried inside the file (a 500px picture is about
 * 70 KB, a third more as base64), so a long trip with a gallery at every stop would pass
 * what a phone or a chat takes — 58 pictures, the leads at 960px, came to 12 MB. Past it,
 * stops keep their lead picture and the build says which went without.
 */
const MOST_PHOTOS = 60;

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

// ---- The JSON, checked before a single picture is fetched

if (!trip.title) fail('The JSON needs a "title".');
if (!Array.isArray(trip.days) || !trip.days.length)
  fail('The JSON needs "days": [{ "date", "title", "stops": [...] }].');
// A section given in the wrong shape would be left off the page without a word
for (const field of [
  "more",
  "before",
  "route",
  "musts",
  "stays",
  "costs",
  "facts",
])
  if (trip[field] != null && !Array.isArray(trip[field]))
    fail(`"${field}" is a list: [{ ... }, { ... }].`);
const hasPicture = (p) => Boolean(p?.wiki || p?.photo);
trip.days.forEach((d, i) => {
  if (!Array.isArray(d.stops) || !d.stops.length)
    fail(`Day ${i + 1} has no "stops".`);
  if (d.cover != null && !hasPicture(d.cover))
    fail(`Day ${i + 1} "cover" needs a "wiki" or a "photo".`);
  d.stops.forEach((s, j) => {
    const at = `Day ${i + 1}, stop ${j + 1}`;
    if (!s.name) fail(`${at} has no "name".`);
    if (s.photos != null) {
      if (!Array.isArray(s.photos) || s.photos.length > 4)
        fail(
          `${at} ("${s.name}") "photos" is a list of at most four, beside the stop's own photo.`,
        );
      s.photos.forEach((p, k) => {
        if (!hasPicture(p))
          fail(`${at} ("${s.name}") photos[${k}] needs a "wiki" or a "photo".`);
      });
    }
    if (s.see != null && (!Array.isArray(s.see) || s.see.length > 4))
      fail(
        `${at} ("${s.name}") "see" is a list of at most four things to do there.`,
      );
    if (s.book != null && s.book !== true && typeof s.book !== "string")
      fail(
        `${at} ("${s.name}") "book" is true or a few words on what to book.`,
      );
  });
});
const more = trip.more ?? [];
more.forEach((m, i) => {
  if (!m?.name) fail(`more[${i}] has no "name".`);
});
const route = trip.route ?? [];
route.forEach((r, i) => {
  if (!r?.place) fail(`route[${i}] has no "place".`);
});
const musts = trip.musts ?? [];
musts.forEach((m, i) => {
  if (!m?.title) fail(`musts[${i}] has no "title".`);
});
const stays = trip.stays ?? (trip.stay ? [trip.stay] : []);
stays.forEach((s, i) => {
  if (!s?.name) fail(`stays[${i}] has no "name".`);
});
// The icons "before" and "musts" may carry
const ICONS = [
  "entry",
  "money",
  "tipping",
  "power",
  "transit",
  "emergency",
  "health",
  "internet",
  "flight",
  "ticket",
  "food",
  "stay",
];
for (const [list, field] of [
  [trip.before ?? [], "before"],
  [musts, "musts"],
])
  list.forEach((b, i) => {
    if (b.icon != null && !ICONS.includes(b.icon))
      fail(
        `${field}[${i}] "icon" is "${b.icon}": one of ${ICONS.join(", ")}, or leave it out.`,
      );
  });
const before = trip.before ?? [];
before.forEach((b, i) => {
  if (!b?.label || !b?.text) fail(`before[${i}] needs a "label" and a "text".`);
});
// The costs are added up, so a price is a number, the one you read; a price still to find is
// `pending`, said as such, never a guess or a range
const COST_KINDS = ["flight", "stay", "food", "ticket", "transport", "other"];
const costs = trip.costs ?? [];
costs.forEach((c, i) => {
  if (!c?.item) fail(`costs[${i}] has no "item".`);
  if (c.kind != null && !COST_KINDS.includes(c.kind))
    fail(
      `costs[${i}] "kind" is "${c.kind}": one of ${COST_KINDS.join(", ")}, or leave it out.`,
    );
  if (c.pending === true) {
    if (c.amount != null)
      fail(
        `costs[${i}] is "pending" and has an "amount": a price you read is a number without "pending"; one still to find has no amount.`,
      );
    return;
  }
  if (typeof c.amount !== "number" || !Number.isFinite(c.amount))
    fail(
      `costs[${i}].amount is ${JSON.stringify(c.amount)}: the costs are added up, so each is a number in the trip's currency, the price you read. A price you could not read is "pending": true, with no amount.`,
    );
});
// Every address the page links to, checked here so a typo costs no photo fetch
const ABSOLUTE = /^https?:\/\/[^/\s]+/;
for (const [url, where] of [
  ...(trip.flights?.link ? [[trip.flights.link, '"flights.link"']] : []),
  ...stays.flatMap((s, i) =>
    s.link ? [[s.link, `stays[${i}] ("${s.name}") "link"`]] : [],
  ),
  ...trip.days.flatMap((d, i) =>
    d.stops.flatMap((s, j) =>
      s.link
        ? [[s.link, `Day ${i + 1}, stop ${j + 1} ("${s.name}") "link"`]]
        : [],
    ),
  ),
  ...more.flatMap((m, i) =>
    m.link ? [[m.link, `more[${i}] ("${m.name}") "link"`]] : [],
  ),
  ...musts.flatMap((m, i) =>
    m.link ? [[m.link, `musts[${i}] ("${m.title}") "link"`]] : [],
  ),
  ...costs.flatMap((c, i) =>
    c.link ? [[c.link, `costs[${i}] ("${c.item}") "link"`]] : [],
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
// From the workspace or whole: joined, a whole path landed nested inside the workspace
const out = join(
  resolve(WORKSPACE, process.env.THURSDAY_ARTIFACTS || "artifacts"),
  `${name}.html`,
);

const cur = trip.currency ? String(trip.currency).toUpperCase() : null;
const lang = String(trip.lang ?? "en");
// Built without them, a page in another language came out with "Day by day" and "Before you go" on it,
// and the warning printed after the build was passed over
if (!lang.startsWith("en") && !trip.labels)
  fail(
    `The page is in "${lang}" but its own headings would be English: add "labels" in that language (references/itinerary.md) and build again.`,
  );
const place = String(trip.place ?? "");
const L = {
  way: "The way",
  musts: "To do before you go",
  flights: "Getting there",
  stay: "Where you stay",
  weather: "Weather",
  days: "Day by day",
  more: "More places",
  costs: "What it costs",
  before: "Good to know",
  notes: "Notes",
  bookAhead: "Book ahead",
  tip: "Tip",
  total: "Total",
  known: "settled so far",
  pending: "price to check",
  perPerson: "per person",
  map: "Map",
  route: "The day's route in Google Maps",
  book: "Booking page",
  night: "night",
  nights: "nights",
  day: "Day {n}",
  photos: "{n} photos",
  people: "{n} people",
  close: "Close",
  previous: "Previous",
  next: "Next",
  sources: "Sources",
  ...trip.labels,
};
/** A label with a number in it: "{n}" where the language puts it, else the number after it. */
const counted = (label, n) =>
  String(label).includes("{n}")
    ? String(label).replace("{n}", n)
    : `${label} ${n}`;
/** A number of nights as the language says it: "3 nights", or "{n}박" → "3박". */
const nightsOf = (n) => {
  const label = n === 1 ? L.night : L.nights;
  return String(label).includes("{n}")
    ? String(label).replace("{n}", n)
    : `${n} ${label}`;
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
/** An amount in the trip's currency. The JSON names it: a price with none would be read as whatever the reader thinks in. */
const inCurrency = (amount) => {
  if (!cur)
    fail(
      'The trip has prices but no "currency": add the one they are in (an ISO code such as "EUR") and build again.',
    );
  return money(amount, cur, lang);
};
const cost = (v) => (typeof v === "number" ? inCurrency(v) : esc(v));
const mapsSearch = (q) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const mapQuery = (s) =>
  s.map ?? [s.name ?? s.place, place].filter(Boolean).join(", ");
const hostOf = (url) => new URL(url).hostname.replace(/^www\./, "");

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
/**
 * A file's credit as words: its markup and any stylesheet inside it taken out — a Commons
 * "Artist" field can carry a template's whole `<style>` block, which came out as the credit.
 */
const plain = (html) =>
  String(html ?? "")
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\.mw-parser-output[^{]*\{[^}]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
/** Who made a Commons file and under what licence, from its metadata. */
const creditFrom = (meta) =>
  [plain(meta?.Artist?.value).slice(0, 40), meta?.LicenseShortName?.value]
    .filter(Boolean)
    .join(", ") || "Wikimedia Commons";

const wikiOf = (title) =>
  /^[a-z]{2,3}:/.test(title)
    ? [title.slice(0, title.indexOf(":")), title.slice(title.indexOf(":") + 1)]
    : ["en", title];

/**
 * A Wikipedia article's own lead picture, with who made it and, where its file says, its licence.
 * `pilicense=any`: the lead picture the article shows, not only a freely licensed one — the
 * default (`free`) returns none for an article led by a non-free image, and the stop then shows
 * without its photo.
 */
async function fromWiki(title, width) {
  const [wiki, name] = wikiOf(title);
  const api = `https://${wiki}.wikipedia.org/w/api.php?format=json&action=query&redirects=1`;
  const q = await getJson(
    `${api}&prop=pageimages|info&inprop=url&piprop=thumbnail|name&pithumbsize=${width}&pilicense=any&titles=${encodeURIComponent(name)}`,
  );
  const page = Object.values(q.query?.pages ?? {})[0];
  if (!page || "missing" in page)
    throw new Error(`no ${wiki} Wikipedia article "${name}"`);
  if (!page.thumbnail) throw new Error(`"${name}" has no lead picture`);
  // A drawing leads some articles — a region's logo, a map — and is no photo of the place
  if (/\.svg$/i.test(page.pageimage ?? ""))
    throw new Error(
      `"${name}" is led by a drawing (${page.pageimage}), not a photo`,
    );
  let credit = "Wikipedia";
  for (const host of ["commons.wikimedia.org", `${wiki}.wikipedia.org`]) {
    try {
      const m = await getJson(
        `https://${host}/w/api.php?format=json&action=query&prop=imageinfo&iiprop=extmetadata&titles=${encodeURIComponent(`File:${page.pageimage}`)}`,
      );
      const meta = Object.values(m.query?.pages ?? {})[0]?.imageinfo?.[0]
        ?.extmetadata;
      if (!meta) continue;
      credit = creditFrom(meta);
      break;
    } catch {}
  }
  return {
    src: await dataUri(page.thumbnail.source),
    credit,
    href: page.fullurl,
    file: page.pageimage,
  };
}

/**
 * More pictures of the place an article is about, from the Commons category its Wikidata item
 * names (P373) — pictures filed under that place by the people who took them. An article's own
 * pictures were tried first and mixed in other places: the castle's article showed other
 * castles. Photographs only, big enough to be worth opening, the largest first.
 */
async function galleryOf(title, skip, count) {
  const [wiki, name] = wikiOf(title);
  const q = await getJson(
    `https://${wiki}.wikipedia.org/w/api.php?format=json&action=query&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=${encodeURIComponent(name)}`,
  );
  const item = Object.values(q.query?.pages ?? {})[0]?.pageprops?.wikibase_item;
  if (!item) return [];
  const claims = await getJson(
    `https://www.wikidata.org/w/api.php?format=json&action=wbgetclaims&property=P373&entity=${item}`,
  );
  const category = claims.claims?.P373?.[0]?.mainsnak?.datavalue?.value;
  if (!category) return [];
  const files = await getJson(
    `https://commons.wikimedia.org/w/api.php?format=json&action=query&generator=categorymembers&gcmtype=file&gcmlimit=40&gcmtitle=${encodeURIComponent(`Category:${category}`)}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=500`,
  );
  const found = Object.values(files.query?.pages ?? {})
    .map((p) => ({ title: p.title, info: p.imageinfo?.[0] }))
    .filter(
      ({ title, info }) =>
        info?.mime === "image/jpeg" &&
        info.width >= 1200 &&
        info.height >= 700 &&
        info.width / info.height < 2.2 &&
        title.replace(/^File:/, "").replace(/ /g, "_") !==
          String(skip ?? "").replace(/ /g, "_"),
    )
    .sort((a, b) => b.info.width * b.info.height - a.info.width * a.info.height)
    .slice(0, count);
  const got = [];
  for (const { info } of found) {
    try {
      got.push({
        src: await dataUri(info.thumburl),
        credit: creditFrom(info.extmetadata),
        href: info.descriptionurl,
      });
    } catch {}
  }
  return got;
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
    const said = execFileSync(
      process.execPath,
      [script, url, "--out", dir, "--json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const { files, credit } = JSON.parse(said.trim().split("\n").at(-1));
    if (!files?.length) throw new Error("no picture came back");
    return { src: fromFile(files[0].path).src, credit, href: url };
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

/**
 * Queue a picture for `thing` ({ wiki } or { photo }); the page reads it back after. A
 * Wikipedia picture comes `width` wide: one shown across the page at 960, one in a gallery at
 * 500, a quarter of the bytes. Wikimedia serves its own steps of width and rounds any other up
 * (640 came back 960).
 */
function want(thing, label, width = 960) {
  if (!hasPicture(thing)) return null;
  const key = thing.wiki
    ? `wiki:${width}:${thing.wiki}`
    : `photo:${thing.photo}`;
  if (!photoJobs.has(key))
    photoJobs.set(key, {
      label,
      run: () =>
        thing.wiki
          ? fromWiki(thing.wiki, width)
          : /^https?:\/\//.test(thing.photo)
            ? fromPage(thing.photo)
            : fromFile(thing.photo),
    });
  return key;
}

const coverKey = want(trip.cover, "cover");
const stayKeys = stays.map((s) => want(s, s.name, 500));
const routeKeys = route.map((r) => want(r, r.place, 500));
// A stop's picture opens a gallery beside its words, half the page wide: 500px is enough
const stopKeys = trip.days.map((d) =>
  d.stops.map((s) => (s.move ? null : want(s, s.name, 500))),
);
const dayKeys = trip.days.map((d, i) => want(d.cover, `Day ${i + 1} cover`));
const extraKeys = trip.days.map((d) =>
  d.stops.map((s) =>
    (s.move ? [] : (s.photos ?? [])).map((p) => ({
      key: want(p, p.caption ?? s.name, 500),
      caption: p.caption,
    })),
  ),
);
const moreKeys = more.map((m) => want(m, m.name, 500));

const photos = new Map();
// One at a time: Wikimedia answers a burst with 429
for (const [key, job] of photoJobs) {
  try {
    photos.set(key, await job.run());
  } catch (error) {
    missing.push(`${job.label}: ${error.message}`);
  }
}
// Then the galleries, a stop at a time, while the page has room for them
const galleries = trip.days.map((d) => d.stops.map(() => []));
const noRoom = [];
let shownCount = photos.size;
for (const [i, d] of trip.days.entries())
  for (const [j, s] of d.stops.entries()) {
    if (!s.wiki || s.gallery === false || s.move) continue;
    if (shownCount + GALLERY > MOST_PHOTOS) {
      noRoom.push(s.name);
      continue;
    }
    try {
      galleries[i][j] = await galleryOf(
        s.wiki,
        photos.get(stopKeys[i][j])?.file,
        GALLERY,
      );
      shownCount += galleries[i][j].length;
    } catch (error) {
      missing.push(`${s.name}'s gallery: ${error.message}`);
    }
  }

// ---- Pieces of the page

const ICON = {
  entry:
    '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17h8"/>',
  money:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  tipping:
    '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  power: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8ZM12 18v4"/>',
  transit:
    '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M8 21l2-4M16 21l-2-4"/>',
  emergency:
    '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>',
  health:
    '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  internet:
    '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 19.5h.01"/>',
  flight:
    '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  ticket:
    '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
  food: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  stay: '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M2 18h20"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  long: '<path d="M6 2h12M6 22h12M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert:
    '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};
const icon = (name) =>
  `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] ?? ICON.info}</svg>`;

/** Who made a picture, linked to where it came from. */
const creditOf = (p) =>
  p.credit
    ? p.href
      ? `<a href="${esc(p.href)}">${esc(p.credit)}</a>`
      : esc(p.credit)
    : "";
/** A number for each picture, so a picture shown twice is carried once (`borrow`). */
const ids = new Map();
const idOf = (p) => {
  if (!ids.has(p)) ids.set(p, `p${ids.size + 1}`);
  return ids.get(p);
};
/**
 * A picture as the page shows it. Every one opens large (the viewer below): `data-caption` and
 * `data-credit` are what the viewer shows under it. A picture shown a second time carries none
 * of its own: the page's script gives it the first one's, so the hero, which repeats the stops'
 * pictures, adds nothing to the file. Not lazy: the page is printed and drawn whole (a PDF, the
 * pictures a phone gets), and a lazy picture below the fold came out blank there.
 */
const carried = new Set();
const figure = (p, alt, caption = "") => {
  if (!p) return "";
  const first = !carried.has(p);
  carried.add(p);
  return `<figure class="ph"><img ${first ? `src="${p.src}" ` : ""}data-p="${idOf(p)}" alt="${esc(alt)}" data-caption="${esc(caption || alt)}" data-credit="${esc(p.credit ?? "")}">${p.credit ? `<figcaption>${creditOf(p)}</figcaption>` : ""}</figure>`;
};
/** Several pictures of one thing: the first large, the rest beside it, all swiped on a phone. */
const gallery = (list, alt) => {
  const shown = list.filter((x) => x.p);
  if (!shown.length) return "";
  return `<div class="gallery n${Math.min(shown.length, 3)}" data-count="${shown.length}">${shown
    .map((x) => figure(x.p, alt, x.caption))
    .join(
      "",
    )}${shown.length > 3 ? `<span class="more-n" aria-hidden="true">+${shown.length - 3}</span>` : ""}</div>`;
};
const button = (href, text, primary = false) =>
  `<a class="btn${primary ? " primary" : ""}" href="${esc(href)}">${esc(text)}</a>`;

const parts = [];

// The hero: the cover and the first pictures of the days, one large and four small
const heroPics = [
  photos.get(coverKey),
  ...trip.days.flatMap((d, i) =>
    d.stops
      .map((_, j) => photos.get(stopKeys[i][j]))
      .filter(Boolean)
      .slice(0, 1),
  ),
  ...trip.days.flatMap((d, i) =>
    d.stops
      .map((_, j) => photos.get(stopKeys[i][j]))
      .filter(Boolean)
      .slice(1, 2),
  ),
]
  .filter(Boolean)
  // The same file fetched at two widths (a cover and a stop) is one picture
  .filter(
    (p, i, all) =>
      all.findIndex((q) => (q.file ?? q.src) === (p.file ?? p.src)) === i,
  )
  .slice(0, 5);
// Its button counts the pictures the viewer shows, known once the whole page is laid out
const ALL_COUNT = "\u0000all-count\u0000";
if (heroPics.length)
  parts.push(
    `<div class="hero n${heroPics.length}">${heroPics
      .map((p) => figure(p, trip.title))
      .join("")}${ALL_COUNT}</div>`,
  );

// The way: places in order, the nights in each, and how to get from one to the next
const way = route.length
  ? `<section class="way-sec"><h2>${esc(L.way)}</h2><ol class="way">${route
      .map((r, i) => {
        const p = photos.get(routeKeys[i]);
        return `<li class="city">${p ? `<img src="${p.src}" alt="">` : '<span class="noimg"></span>'}<b>${esc(r.place)}</b><span class="num">${esc([r.nights != null ? nightsOf(r.nights) : "", r.dates].filter(Boolean).join(" · "))}</span></li>${
          r.next && i < route.length - 1
            ? `<li class="hop" aria-label="${esc(r.next)}">${icon("transit")}<span>${esc(r.next)}</span></li>`
            : ""
        }`;
      })
      .join("")}</ol></section>`
  : "";

// The head: the title, the facts and the way, and beside them the money
const people = Number(trip.travelers ?? 0);
const known = costs.filter((c) => !c.pending);
const pendingCosts = costs.filter((c) => c.pending);
const total = known.reduce((s, c) => s + c.amount, 0);
const facts = (trip.facts ?? []).map(
  (f) =>
    `<div class="fact"><b class="num">${esc(f.value)}</b><span>${esc(f.label)}</span></div>`,
);
const byKind = COST_KINDS.map((kind) => ({
  kind,
  sum: known
    .filter((c) => (c.kind ?? "other") === kind)
    .reduce((s, c) => s + c.amount, 0),
})).filter((k) => k.sum > 0);
const moneyCard = costs.length
  ? `<aside class="money" aria-label="${esc(L.costs)}"><h2>${esc(L.costs)}${people > 1 ? ` · ${esc(counted(L.people, people))}` : ""}</h2><div class="total">${
      known.length
        ? `<b class="num">${inCurrency(total)}</b><span>${esc(pendingCosts.length ? L.known : L.total)}</span>`
        : `<b class="todo">${esc(L.pending)}</b>`
    }</div>${
      people > 1 && known.length
        ? `<div class="each num">${inCurrency(total / people)} ${esc(L.perPerson)}</div>`
        : ""
    }${
      byKind.length > 1
        ? `<div class="bar" aria-hidden="true">${byKind.map((k) => `<i class="k-${k.kind}" style="flex:${k.sum}"></i>`).join("")}</div>`
        : ""
    }<ul class="rows">${costs
      .map(
        (c) =>
          `<li><i class="dot k-${c.pending ? "pending" : (c.kind ?? "other")}"></i><span>${esc(c.item)}${c.note ? `<small>${esc(c.note)}</small>` : ""}</span>${
            c.pending
              ? c.link
                ? `<a class="todo" href="${esc(c.link)}">${esc(L.pending)}</a>`
                : `<span class="todo">${esc(L.pending)}</span>`
              : `<span class="v num">${inCurrency(c.amount)}</span>`
          }</li>`,
      )
      .join(
        "",
      )}</ul>${trip.fx ? `<p class="fx">${esc(trip.fx)}</p>` : ""}</aside>`
  : "";
parts.push(
  `<div class="head"><div class="intro"><h1>${esc(trip.title)}</h1>${trip.lede ? `<p class="lede">${esc(trip.lede)}</p>` : ""}${facts.length ? `<div class="facts">${facts.join("")}</div>` : ""}${way}</div>${moneyCard}</div>`,
);

// What to do before leaving, each by when
if (musts.length)
  parts.push(
    `<section class="block"><h2>${esc(L.musts)}</h2><div class="musts">${musts
      .map(
        (m) =>
          `<div class="must"><span class="ico">${icon(m.icon ?? "ticket")}</span><div><b>${esc(m.title)}</b>${m.text ? `<p>${esc(m.text)}</p>` : ""}${
            m.when || m.link
              ? `<div class="must-foot">${m.when ? `<span class="when">${esc(m.when)}</span>` : ""}${m.link ? `<a href="${esc(m.link)}">${esc(m.linkText ?? hostOf(m.link))}</a>` : ""}</div>`
              : ""
          }</div></div>`,
      )
      .join("")}</div></section>`,
  );

// Getting there: a leg reads like a line of a boarding pass
if (trip.flights?.legs?.length) {
  const f = trip.flights;
  const legs = f.legs
    .map(
      (
        g,
      ) => `<div class="leg"><div class="when"><b>${esc(g.label ?? "")}</b>${fmtDay(g.date)}</div>
<div class="hop2"><div class="end"><b>${esc(g.dep ?? "—")}</b><span>${esc(g.from)}</span></div><div class="line">${esc([g.duration, g.stops].filter(Boolean).join(" · "))}</div><div class="end"><b>${esc(g.arr ?? "—")}</b><span>${esc(g.to)}</span></div></div>
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
    `<section class="block"><h2>${esc(L.flights)}</h2><div class="panel">${legs}${foot.length ? `<div class="panel-foot">${foot.join("")}</div>` : ""}</div>${f.note ? `<p class="muted">${esc(f.note)}</p>` : ""}</section>`,
  );
}

// Where you stay: each a card, its picture over its words
if (stays.length)
  parts.push(
    `<section class="block"><h2>${esc(L.stay)}</h2><div class="cards">${stays
      .map((s, i) => {
        const nights = Number(s.nights ?? 0);
        const line = [
          s.price != null
            ? `<b class="num">${cost(s.price)}</b> / ${esc(L.night)}`
            : "",
          nights && typeof s.price === "number"
            ? `${inCurrency(s.price * nights)} · ${esc(nightsOf(nights))}`
            : nights
              ? esc(nightsOf(nights))
              : "",
          s.rating ? `★ ${esc(s.rating)}` : "",
        ].filter(Boolean);
        return `<article class="card">${figure(photos.get(stayKeys[i]), s.name)}<div class="body">${s.area ? `<span class="kind">${esc(s.area)}</span>` : ""}<h3>${esc(s.name)}</h3>${line.length ? `<p class="line">${line.join(" · ")}</p>` : ""}${s.why ? `<p>${esc(s.why)}</p>` : ""}<div class="actions">${s.link ? button(s.link, L.book, true) : ""}<a class="btn" href="${esc(mapsSearch(mapQuery(s)))}">${esc(L.map)}</a></div></div></article>`;
      })
      .join("")}</div></section>`,
  );

// Weather: what the days are like, a pill each
const withWeather = trip.days.filter((d) => d.weather);
if (withWeather.length || trip.climate)
  parts.push(
    `<section class="block"><h2>${esc(L.weather)}</h2>${trip.climate ? `<p class="muted">${esc(trip.climate)}</p>` : ""}${
      withWeather.length
        ? `<div class="weather">${withWeather.map((d) => `<span class="pill"><b>${fmtDay(d.date, false)}</b> ${esc(d.weather)}</span>`).join("")}</div>`
        : ""
    }</section>`,
  );

// Day by day: a strip to jump by, then each day as its own chapter
const dayLabel = (i) => counted(L.day, i + 1);
parts.push(
  `<nav class="daynav" aria-label="${esc(L.days)}">${trip.days
    .map(
      (d, i) =>
        `<a href="#day-${i + 1}"><b>${esc(dayLabel(i))}</b><span>${fmtDay(d.date, false)}</span></a>`,
    )
    .join("")}</nav>`,
);
trip.days.forEach((d, i) => {
  const stops = d.stops
    .map((s, j) => {
      const said = [s.time, s.duration].filter(Boolean).join(" · ");
      if (s.move)
        return `<li class="move">${icon("transit")}<span>${s.time ? `<b class="num">${esc(s.time)}</b> ` : ""}<b>${esc(s.name)}</b>${s.what ? ` · ${esc(s.what)}` : ""}</span></li>`;
      const pics = gallery(
        [
          { p: photos.get(stopKeys[i][j]) },
          ...extraKeys[i][j].map((x) => ({
            p: photos.get(x.key),
            caption: x.caption,
          })),
          ...galleries[i][j].map((p) => ({ p })),
        ],
        s.name,
      );
      const price =
        s.cost != null
          ? `<div class="price"><b class="num">${cost(s.cost)}</b>${s.costNote ? `<span>${esc(s.costNote)}</span>` : ""}</div>`
          : "";
      const chips = [
        s.hours
          ? `<span class="chip">${icon("clock")}${esc(s.hours)}</span>`
          : "",
        s.book
          ? `<span class="chip book">${icon("ticket")}${esc(s.book === true ? L.bookAhead : s.book)}</span>`
          : "",
      ].filter(Boolean);
      const actions = [
        s.link ? button(s.link, s.linkText ?? hostOf(s.link), true) : "",
        s.map !== false
          ? `<a class="btn map" href="${esc(mapsSearch(mapQuery(s)))}">${esc(L.map)}</a>`
          : "",
      ].filter(Boolean);
      return `<li class="place${pics ? "" : " bare"}">${pics}<div class="pbody"><div class="ptop"><div>${said ? `<div class="ptime num">${esc(said)}</div>` : ""}<h4>${esc(s.name)}</h4></div>${price}</div>${
        s.what ? `<p class="why">${esc(s.what)}</p>` : ""
      }${
        s.see?.length
          ? `<ul class="see">${s.see.map((x) => `<li>${icon("check")}<span>${esc(x)}</span></li>`).join("")}</ul>`
          : ""
      }${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}${
        s.watch
          ? `<p class="watch">${icon("alert")}<span>${esc(s.watch)}</span></p>`
          : ""
      }${s.tip ? `<p class="tip"><b>${esc(L.tip)}</b> ${esc(s.tip)}</p>` : ""}${actions.length ? `<div class="actions">${actions.join("")}</div>` : ""}</div></li>`;
    })
    .join("");
  // One link opens every stop of the day in order, with transit between them
  const stopsOnMap = d.stops
    .filter((s) => s.map !== false && !s.move)
    .map(mapQuery);
  const dayRoute =
    stopsOnMap.length > 1
      ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(stopsOnMap[0])}&destination=${encodeURIComponent(stopsOnMap.at(-1))}${
          stopsOnMap.length > 2
            ? `&waypoints=${encodeURIComponent(stopsOnMap.slice(1, -1).slice(0, 8).join("|"))}`
            : ""
        }&travelmode=${d.travel ?? trip.travel ?? "transit"}`
      : null;
  const cover = photos.get(dayKeys[i]);
  parts.push(
    `<article class="day" id="day-${i + 1}"><header><div><div class="k">${esc(dayLabel(i))} · ${fmtDay(d.date)}</div><h3>${esc(d.title ?? "")}</h3></div>${
      d.weather ? `<span class="pill">${esc(d.weather)}</span>` : ""
    }</header>${d.lede ? `<p class="dayline">${esc(d.lede)}</p>` : ""}${cover ? `<div class="daycover">${figure(cover, d.title ?? "")}</div>` : ""}<ol class="stops">${stops}</ol>${
      dayRoute
        ? `<footer><a href="${esc(dayRoute)}">${esc(L.route)}</a></footer>`
        : ""
    }</article>`,
  );
});

// Places beside the plan, for a day that runs short: a card each, its picture over its words
if (more.length)
  parts.push(
    `<section class="block"><h2>${esc(L.more)}</h2><div class="cards">${more
      .map((m, i) => {
        const actions = [
          m.link ? button(m.link, m.linkText ?? hostOf(m.link), true) : "",
          m.map !== false
            ? `<a class="btn" href="${esc(mapsSearch(mapQuery(m)))}">${esc(L.map)}</a>`
            : "",
        ].filter(Boolean);
        return `<article class="card">${figure(photos.get(moreKeys[i]), m.name)}<div class="body">${
          m.tag ? `<span class="kind">${esc(m.tag)}</span>` : ""
        }<h3>${esc(m.name)}</h3>${m.what ? `<p>${esc(m.what)}</p>` : ""}${
          m.near ? `<p class="near">${esc(m.near)}</p>` : ""
        }${actions.length ? `<div class="actions">${actions.join("")}</div>` : ""}</div></article>`;
      })
      .join("")}</div></section>`,
  );

// The costs in full: what each is, the total in weight
if (costs.length)
  parts.push(
    `<section class="block"><h2>${esc(L.costs)}</h2><table><tbody>${costs
      .map(
        (c) =>
          `<tr><td>${esc(c.item)}${c.note ? `<small>${esc(c.note)}</small>` : ""}</td><td class="num">${c.pending ? `<span class="todo">${esc(L.pending)}</span>` : cost(c.amount)}</td></tr>`,
      )
      .join(
        "",
      )}<tr class="total"><td>${esc(pendingCosts.length ? L.known : L.total)}${
      people > 1 && known.length
        ? `<small>${inCurrency(total / people)} ${esc(L.perPerson)}</small>`
        : ""
    }</td><td class="num">${known.length ? inCurrency(total) : `<span class="todo">${esc(L.pending)}</span>`}</td></tr></tbody></table></section>`,
  );

// Good to know: what to know as properties, and what to book as a list to tick
const toBook = trip.days.flatMap((d) =>
  d.stops
    .filter((s) => s.book)
    .map(
      (s) =>
        `<li><label><input type="checkbox"><span>${esc(s.name)}</span><small>${[
          fmtDay(d.date),
          typeof s.book === "string" ? esc(s.book) : "",
        ]
          .filter(Boolean)
          .join(" · ")}</small></label></li>`,
    ),
);
if (before.length || toBook.length)
  parts.push(
    `<section class="block"><h2>${esc(L.before)}</h2>${
      before.length
        ? `<dl class="props">${before
            .map(
              (b) =>
                `<div><dt>${icon(b.icon ?? "info")}${esc(b.label)}</dt><dd>${esc(b.text)}</dd></div>`,
            )
            .join("")}</dl>`
        : ""
    }${
      toBook.length
        ? `<h3 class="sub">${esc(L.bookAhead)}</h3><ul class="to-book">${toBook.join("")}</ul>`
        : ""
    }</section>`,
  );

// The notes — what was checked and when, what could not be — folded until wanted
if (trip.notes?.length)
  parts.push(
    `<details class="notes"><summary>${esc(L.notes)} <span class="num">${trip.notes.length}</span></summary><ul>${trip.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>`,
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

// The viewer every picture opens in: large, one after another, with who made it
const viewer = `<div class="viewer" hidden role="dialog" aria-modal="true" aria-label="${esc(trip.title)}"><button type="button" class="v-close" aria-label="${esc(L.close)}">×</button><button type="button" class="v-prev" aria-label="${esc(L.previous)}">‹</button><figure><img alt=""><figcaption><b></b><span class="v-credit"></span><span class="v-n num"></span></figcaption></figure><button type="button" class="v-next" aria-label="${esc(L.next)}">›</button></div>`;
const viewerJs = `(() => {
  // A picture shown twice is carried once: the second takes the first's
  for (const img of document.querySelectorAll("img[data-p]:not([src])")) {
    const same = document.querySelector('img[data-p="' + img.dataset.p + '"][src]');
    if (same) img.src = same.src;
  }
  const box = document.querySelector(".viewer");
  if (!box) return;
  const img = box.querySelector("img");
  const cap = box.querySelector("figcaption b");
  const credit = box.querySelector(".v-credit");
  const n = box.querySelector(".v-n");
  let list = [];
  let at = 0;
  let back = null;
  const show = (i) => {
    at = (i + list.length) % list.length;
    const one = list[at];
    img.src = one.src;
    img.alt = one.dataset.caption || "";
    cap.textContent = one.dataset.caption || "";
    credit.textContent = one.dataset.credit || "";
    n.textContent = list.length > 1 ? at + 1 + " / " + list.length : "";
  };
  const open = (pics, i) => {
    list = pics;
    back = document.activeElement;
    box.hidden = false;
    document.documentElement.classList.add("viewing");
    show(i);
    box.querySelector(".v-close").focus();
  };
  const close = () => {
    box.hidden = true;
    document.documentElement.classList.remove("viewing");
    back?.focus?.();
  };
  const pics = (el) => [...el.querySelectorAll(".ph img")];
  document.addEventListener("click", (e) => {
    const all = e.target.closest("[data-all]");
    if (all) {
      // Every picture once: the hero repeats the stops'
      const seen = new Set();
      const every = pics(document.querySelector("main")).filter((img) =>
        seen.has(img.dataset.p) ? false : seen.add(img.dataset.p),
      );
      return open(every, 0);
    }
    const shot = e.target.closest(".ph img");
    if (!shot || box.contains(shot)) return;
    const group = shot.closest(".gallery, .hero") ?? shot.closest(".ph");
    const inGroup = pics(group);
    open(inGroup.length ? inGroup : [shot], Math.max(0, inGroup.indexOf(shot)));
  });
  box.querySelector(".v-close").addEventListener("click", close);
  box.querySelector(".v-prev").addEventListener("click", () => show(at - 1));
  box.querySelector(".v-next").addEventListener("click", () => show(at + 1));
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
  document.addEventListener("keydown", (e) => {
    if (box.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft") show(at - 1);
    else if (e.key === "ArrowRight") show(at + 1);
  });
  // A swipe across the picture turns it
  let x0 = null;
  box.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) show(at + (dx < 0 ? 1 : -1));
    x0 = null;
  });
  // The day strip marks the day being read
  const links = [...document.querySelectorAll(".daynav a")];
  const days = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
  if ("IntersectionObserver" in window && days.length) {
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries)
        if (e.isIntersecting)
          for (const a of links)
            if (a.hash === "#" + e.target.id) a.setAttribute("aria-current", "true");
            else a.removeAttribute("aria-current");
    }, { rootMargin: "-35% 0px -60% 0px" });
    days.forEach((d) => seen.observe(d));
  }
})();`;

// Every picture the viewer shows, once: a figure's, each file counted once
const allCount = new Set(ids.values()).size;
const body = parts
  .join("\n")
  .replace(
    ALL_COUNT,
    allCount > heroPics.length
      ? `<button type="button" class="all" data-all>${esc(counted(L.photos, allCount))}</button>`
      : "",
  );
const css = readFileSync(join(SKILL, "page", "itinerary.css"), "utf8").trim();
// The shell every page a bot makes wears: its head, type, theme and the maker's name
const wearAt = join(
  process.env.THURSDAY_SKILLS ?? "",
  "artifact/runtime/shell/wear.mjs",
);
if (!process.env.THURSDAY_SKILLS || !existsSync(wearAt))
  fail("THURSDAY_SKILLS is not set: run this from a bot's shell in the app.");
const { wear, pageHead } = await import(pathToFileURL(wearAt).href);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  wear(`<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
{{shell.meta}}
<meta name="print" content="pdf">
<title>${esc(trip.title)}</title>
<script>
// shell.theme
</script>
<style>
/* shell.css */
${css}
</style>
</head>
<body>
${pageHead(trip.title)}
<main>
${body}
</main>
{{shell.sign}}
${viewer}
<script>
// shell.js
</script>
<script>
${viewerJs}
</script>
</body>
</html>
`),
);
const kb = Math.round(statSync(out).size / 1024);
const inside = photos.size + galleries.flat(2).length;
console.log(
  `${relative(WORKSPACE, out)} (${kb} KB, ${inside} photo${inside === 1 ? "" : "s"} inside). One file that opens offline; hand back this path.`,
);
if (missing.length)
  console.log(
    `No photo for: ${missing.join("; ")}. Give those a "wiki" title that exists — a place abroad often has one only in its own language's Wikipedia ("pt:Mosteiro dos Jerónimos", "de:Kölner Dom") — or a "photo" page url, or leave them without one.`,
  );
if (noRoom.length)
  console.log(
    `No gallery for ${noRoom.join(", ")}: the page already carries ${MOST_PHOTOS} pictures. Set "gallery": false on stops that need no more than their own photo to give these room.`,
  );
