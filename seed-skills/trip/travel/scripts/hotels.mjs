#!/usr/bin/env node
/**
 * Places to stay from Google Hotels as a few lines: name, nightly price, rating, class,
 * deal and link, read in this shell's browser session. `--detail N` opens one and prints
 * who sells which room for how much (the cheapest can be a dormitory bed); `--photos`
 * saves each listed one's own picture for a page.
 *
 *   node hotels.mjs "<place>" <check-in YYYY-MM-DD> <check-out YYYY-MM-DD>
 *        [--adults 2] [--currency USD] [--max-price 150] [--min-rating 4] [--stars 3]
 *        [--kind hotel|rental|any] [--max 8] [--sort best|price|rating]
 *        [--photos <dir>] [--detail N]
 *
 * <place> is a city, a neighbourhood or a landmark: "Fukuoka", "Hakata, Fukuoka".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  currency,
  day,
  fail,
  money,
  nightsBetween,
  oneLine,
  parseArgs,
  shipped,
  shortDay,
} from "./lib.mjs";
import { HOTELS } from "./selectors.mjs";

const USAGE =
  'usage: node hotels.mjs "<place>" <check-in YYYY-MM-DD> <check-out YYYY-MM-DD> [--adults 2] [--currency USD] [--max-price 150] [--min-rating 4] [--stars 3] [--kind hotel|rental|any] [--max 8] [--sort best|price|rating] [--photos <dir>] [--detail N]';

const opts = parseArgs();
const [place, inArg, outArg] = opts._;
if (!place || !inArg || !outArg) fail(USAGE);
const checkIn = day(inArg, "The check-in");
const checkOut = day(outArg, "The check-out");
const nights = nightsBetween(checkIn, checkOut);
if (nights < 1) fail("The check-out is not after the check-in.");
if (checkIn < new Date().toLocaleDateString("en-CA"))
  fail(`${checkIn} has passed.`);
const cur = currency(opts.currency);
const adults = Number(opts.adults ?? 2);
if (!(adults >= 1 && adults <= 12)) fail("--adults is 1-12.");
const maxPrice = opts["max-price"] ? Number(opts["max-price"]) : null;
const minRating = opts["min-rating"] ? Number(opts["min-rating"]) : null;
const stars = opts.stars ? Number(opts.stars) : null;
const kind = String(opts.kind ?? "hotel");
if (!["hotel", "rental", "any"].includes(kind))
  fail("--kind is hotel, rental or any.");
const max = Number(opts.max ?? 8);
const sort = String(opts.sort ?? "best");
if (!["best", "price", "rating"].includes(sort))
  fail("--sort is best, price or rating.");
const detail = opts.detail ? Number(opts.detail) : null;

/**
 * Google Hotels takes its dates, guests and currency only from `ts`, a protobuf in
 * base64: `curr=` is ignored and the page answers in the currency of the machine's
 * country. Field numbers read off urls the page writes itself (2026-09).
 */
function stayState() {
  const varint = (n) => {
    const out = [];
    while (n > 127) {
      out.push((n & 127) | 128);
      n >>>= 7;
    }
    out.push(n);
    return out;
  };
  const field = (no, v) =>
    typeof v === "number"
      ? [...varint(no << 3), ...varint(v)]
      : [...varint((no << 3) | 2), ...varint(v.length), ...v];
  const date = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return [...field(1, y), ...field(2, m), ...field(3, d)];
  };
  const adult = field(1, field(1, 3));
  const guests = [...Array(adults)].flatMap(() => adult);
  const stay = [
    ...field(1, date(checkIn)),
    ...field(2, date(checkOut)),
    ...field(3, nights),
  ];
  return Buffer.from([
    ...field(1, 1),
    ...field(2, [...guests, ...field(2, 1)]),
    ...field(3, field(2, field(2, stay))),
    ...field(5, field(1, field(7, [...Buffer.from(cur)]))),
  ]).toString("base64url");
}

// A price cap in the sentence makes Google filter before it pages, not after
const sentence = `hotels in ${place}${maxPrice ? ` under ${money(maxPrice, cur)}` : ""}`;
const url = `https://www.google.com/travel/search?q=${encodeURIComponent(sentence)}&ts=${stayState()}&hl=en&gl=us`;

const { inPage, orFail } = await shipped("browser/scripts/session.mjs");

const started = Date.now();
const got = orFail(
  await inPage(
    async (page, { url, css, none, photos }) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      const count = () =>
        page.evaluate(
          (sel) => document.querySelectorAll(sel).length,
          css.price,
        );
      const start = Date.now();
      let last = -1;
      let still = 0;
      while (Date.now() - start < 30000 && still < 3) {
        await page.waitForTimeout(400);
        const n = await count();
        if (
          !n &&
          (await page.evaluate(
            (none) => new RegExp(none).test(document.body.innerText),
            none,
          ))
        )
          break;
        still = n && n === last ? still + 1 : 0;
        last = n;
      }
      // Pictures load as they scroll into view
      if (photos)
        for (let y = 0; y < 12; y++) {
          await page.mouse.wheel(0, 900);
          await page.waitForTimeout(250);
        }
      const read = await page.evaluate((css) => {
        const cards = [];
        for (const link of document.querySelectorAll(css.price)) {
          let card = link;
          while (
            card &&
            !(card.querySelector(css.detail) && card.querySelector("img"))
          )
            card = card.parentElement;
          if (!card) continue;
          cards.push({
            price: link.getAttribute("aria-label"),
            rating:
              card.querySelector(css.rating)?.getAttribute("aria-label") ?? "",
            text: card.innerText,
            href: card.querySelector(css.detail)?.href ?? "",
            // The listing's own picture, not a reviewer's avatar or a placeholder
            img:
              [...card.querySelectorAll("img")]
                .filter((i) => i.naturalWidth >= 150 || i.width >= 150)
                .map((i) => i.currentSrc || i.src || "")
                .find((s) => s.includes("googleusercontent")) ?? "",
          });
        }
        return {
          cards,
          checkIn: document.querySelector(css.checkIn)?.value ?? null,
          checkOut: document.querySelector(css.checkOut)?.value ?? null,
          travelers:
            document.querySelector(css.travelers)?.getAttribute("aria-label") ??
            "",
          text: document.body.innerText.slice(0, 3000),
        };
      }, css);
      return read;
    },
    {
      url,
      css: HOTELS.css,
      none: HOTELS.noRows.source,
      photos: Boolean(opts.photos),
    },
  ),
);

// One hotel's cards come twice (its picture and its text): merge by name
const byName = new Map();
for (const c of got.cards) {
  const m = c.price.match(HOTELS.priceLabel);
  if (!m) continue;
  const name = m[2].trim();
  const had = byName.get(name);
  if (had) {
    had.img ||= c.img;
    had.rating ||= c.rating;
    if (c.text.length > had.text.length) had.text = c.text;
    continue;
  }
  byName.set(name, {
    ...c,
    name,
    price: Number(m[1].replace(/,/g, "")),
    deal: m[3] ? `${m[3]}${m[4] ? ` ${m[4]}` : ""}` : "",
  });
}
const all = [...byName.values()].map((h, i) => {
  const rating = h.rating.match(HOTELS.rating);
  return {
    ...h,
    n: i + 1,
    stars: Number(h.text.match(HOTELS.stars)?.[1] ?? 0) || null,
    score: rating ? Number(rating[1]) : null,
    reviews: rating ? rating[2] : null,
    rental: HOTELS.rental.test(h.text),
    amenities:
      h.text
        .match(HOTELS.amenities)?.[1]
        .replace(/,\s*$/, "")
        .split(/,\s*/)
        .filter((a) => !/^(Apartment|Sleeps|\d)/.test(a))
        .slice(0, 4)
        .join(", ") ?? "",
    near: h.text.match(HOTELS.place)?.[0] ?? "",
  };
});

if (!all.length) {
  if (got.cards.length)
    fail(
      `Hotel cards came back but no price label parsed: the labels changed. First one: ${oneLine(got.cards[0].price, 160)}. Fix scripts/selectors.mjs.`,
    );
  if (HOTELS.noRows.test(got.text))
    fail(
      `Google Hotels found nothing for "${sentence}": widen the place or the price.`,
    );
  fail(
    `No hotel cards on ${url}: layout changed? Snapshot it once and fix scripts/selectors.mjs.`,
  );
}
if (got.checkIn && !got.checkIn.startsWith(shortDay(checkIn)))
  fail(
    `Google read the check-in as "${got.checkIn}", not ${shortDay(checkIn)}: the ts field moved; fix stayState().`,
  );
const seen = got.travelers.match(HOTELS.travelersCount)?.[1];
if (seen && Number(seen) !== adults)
  fail(
    `Google read ${seen} travellers, not ${adults}: the ts field moved; fix stayState().`,
  );

const kept = all
  .filter((h) => kind === "any" || (kind === "rental") === h.rental)
  .filter((h) => !maxPrice || h.price <= maxPrice)
  .filter((h) => !minRating || (h.score ?? 0) >= minRating)
  .filter((h) => !stars || (h.stars ?? 0) >= stars)
  .sort((a, b) =>
    sort === "price"
      ? a.price - b.price
      : sort === "rating"
        ? (b.score ?? 0) - (a.score ?? 0)
        : a.n - b.n,
  )
  .slice(0, max);

const found = got.text.match(HOTELS.count)?.[1];
console.log(
  `${place}, ${shortDay(checkIn)} – ${shortDay(checkOut)} (${nights} night${nights > 1 ? "s" : ""}), ${adults} guest${adults > 1 ? "s" : ""}, ${cur}${found ? `, ${found} places` : ""}. Prices are per night for the room, before some sites add taxes.`,
);
console.log(`Search: ${url}`);
if (!kept.length)
  console.log(
    `None of the ${all.length} read pass the filters. Loosen --max-price, --min-rating, --stars or --kind.`,
  );
for (const h of kept)
  console.log(
    [
      `#${h.n}  ${h.name}  ${money(h.price, cur)}/night (${money(h.price * nights, cur)} total)`,
      h.score ? `${h.score}★ (${h.reviews})` : "no rating",
      h.rental ? "rental" : h.stars ? `${h.stars}-star` : "",
      h.deal,
      h.near,
      h.amenities,
    ]
      .filter(Boolean)
      .join("  "),
  );

if (opts.photos) {
  const dir = resolve(String(opts.photos));
  mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const h of kept) {
    if (!h.img) continue;
    // The listing's thumbnail url takes its size after "="
    const big = h.img.replace(/=[^=/]*$/, "=w1200-h800-n-k-no");
    try {
      const res = await fetch(big, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      const file = join(dir, `hotel-${h.n}.jpg`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      saved.push(`#${h.n} ${file}`);
    } catch {}
  }
  console.log(
    saved.length
      ? `Photos (Google Hotels): ${saved.join(", ")}`
      : "No photo came back: the listing pictures had not loaded.",
  );
}

if (detail) {
  const one = all.find((h) => h.n === detail);
  if (!one) fail(`There is no #${detail}.`);
  const offers = orFail(
    await inPage(
      async (page, { href, name }) => {
        await page.goto(href, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        await page
          .waitForFunction(
            () =>
              /\/night|Nightly total|Visit site/.test(document.body.innerText),
            null,
            {
              timeout: 20000,
            },
          )
          .catch(() => {});
        await page.waitForTimeout(1500);
        const text = await page.evaluate(() => document.body.innerText);
        const at = text.indexOf(name);
        return { text: text.slice(at < 0 ? 0 : at, (at < 0 ? 0 : at) + 5000) };
      },
      { href: one.href, name: one.name },
    ),
  );
  const start = offers.text.search(
    /Nightly total|Featured options|All options/,
  );
  if (start < 0)
    fail(
      `The page for ${one.name} showed no offers: layout changed? Snapshot ${one.href} once and fix scripts/selectors.mjs.`,
    );
  const end = offers.text.search(
    /Track this hotel|Similar hotels|Nearby hotels/,
  );
  const lines = offers.text
    .slice(start, end > start ? end : start + 2500)
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !/^(Visit site|,|·|Sponsored.*|Nightly total|Free cancellation only)$/.test(
          l,
        ),
    );
  console.log(`\n#${one.n} ${one.name}: who sells which room, nightly`);
  console.log(oneLine([...new Set(lines)].join(" | "), 1500));
  console.log(`Page: ${one.href}`);
}
console.log(`(${((Date.now() - started) / 1000).toFixed(1)}s)`);
