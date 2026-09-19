#!/usr/bin/env node
import {
  currency,
  day,
  fail,
  money,
  oneLine,
  parseArgs,
  shipped,
  shortDay,
} from "./lib.mjs";
/**
 * Flights from Google Flights as a few lines: airline, times, stops, duration and price
 * per option, read from the page's own labels in this shell's browser session. Picking
 * an outbound lists the returns; picking every leg reaches the booking page, whose url
 * is the itinerary's deep link and what `watch.mjs` checks.
 *
 *   node flights.mjs <from> <to> <depart YYYY-MM-DD> [<return YYYY-MM-DD>]
 *        [--adults 1] [--children 0] [--cabin economy|premium|business|first]
 *        [--nonstop] [--currency USD] [--max 8] [--sort best|price|duration] [--pick N[,M]]
 *
 * <from> and <to> are airport or city codes (ICN, SEL, FUK) or city names.
 */
import { FLIGHTS } from "./selectors.mjs";

const USAGE =
  "usage: node flights.mjs <from> <to> <depart YYYY-MM-DD> [<return YYYY-MM-DD>] [--adults 1] [--children 0] [--cabin economy|premium|business|first] [--nonstop] [--currency USD] [--max 8] [--sort best|price|duration] [--pick N[,M]]";
const CABINS = {
  economy: "",
  premium: " premium economy class",
  business: " business class",
  first: " first class",
};

const opts = parseArgs();
const [from, to, departArg, returnArg] = opts._;
if (!from || !to || !departArg) fail(USAGE);
const depart = day(departArg, "The departure");
const back = returnArg ? day(returnArg, "The return") : null;
if (back && back < depart) fail("The return is before the departure.");
if (depart < new Date().toLocaleDateString("en-CA"))
  fail(`${depart} has passed: flights are searched from today on.`);
const cur = currency(opts.currency);
const adults = Number(opts.adults ?? 1);
const children = Number(opts.children ?? 0);
if (!(adults >= 1 && adults <= 9) || !(children >= 0 && children <= 8))
  fail("--adults is 1-9 and --children 0-8.");
const cabin = String(opts.cabin ?? "economy");
if (!(cabin in CABINS)) fail("--cabin is economy, premium, business or first.");
const max = Number(opts.max ?? 8);
const sort = String(opts.sort ?? "best");
if (!["best", "price", "duration"].includes(sort))
  fail("--sort is best, price or duration.");
const pick = opts.pick
  ? String(opts.pick)
      .split(",")
      .map((n) => Number(n))
  : [];
if (pick.some((n) => !Number.isInteger(n) || n < 1))
  fail(
    "--pick takes the # of a listed flight, and for a round trip the # of a return after it: --pick 3 or --pick 3,1.",
  );
if (pick.length > (back ? 2 : 1))
  fail(
    `--pick takes ${back ? "two numbers" : "one number"} on a ${back ? "round trip" : "one-way trip"}.`,
  );

// Google reads a sentence in `q`; hl=en keeps the labels below in English on any machine
const who = `for ${adults} adult${adults > 1 ? "s" : ""}${children ? ` and ${children} child${children > 1 ? "ren" : ""}` : ""}`;
const sentence = `Flights to ${to} from ${from} on ${depart}${back ? ` through ${back}` : " one way"} ${who}${CABINS[cabin]}${opts.nonstop ? " nonstop" : ""}`;
const searchUrl = `https://www.google.com/travel/flights?q=${encodeURIComponent(sentence)}&curr=${cur}&hl=en&gl=us`;

const { inPage, orFail } = await shipped("browser/scripts/session.mjs");

const started = Date.now();
const got = orFail(
  await inPage(
    async (page, { url, css, noRows, returning, booking, consent, pick }) => {
      const text = () =>
        page.evaluate(
          () =>
            (document.querySelector("[role=main]") ?? document.body).innerText,
        );
      const visible = (sel) =>
        page.evaluate(
          (sel) =>
            [...document.querySelectorAll(sel)]
              .filter((e) => e.offsetParent !== null)
              .map((e) => ({
                label: e.getAttribute("aria-label") ?? "",
                text: (e.closest("li") ?? e).innerText ?? "",
              })),
          sel,
        );
      // Results stream in: wait for the list to stop growing, the page's own "nothing",
      // or a form left blank (Google did not read the sentence and showed its front page)
      const settle = async (none) => {
        const start = Date.now();
        let last = -1;
        let still = 0;
        while (Date.now() - start < 30000) {
          await page.waitForTimeout(400);
          const now = await page.evaluate(
            ({ row, none, from }) => ({
              n: [...document.querySelectorAll(row)].filter(
                (e) => e.offsetParent !== null,
              ).length,
              none: new RegExp(none).test(document.body.innerText),
              blank:
                document.readyState === "complete" &&
                document.querySelector(from)?.value === "",
            }),
            { row: css.row, none, from: css.from },
          );
          if (!now.n && (now.none || (now.blank && Date.now() - start > 5000)))
            return;
          still = now.n && now.n === last ? still + 1 : 0;
          last = now.n;
          if (still >= 3) return;
        }
      };
      const read = async () => ({
        url: page.url(),
        rows: await visible(css.row),
        text: (await text()).slice(0, 6000),
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      if (page.url().includes(consent.host)) {
        await page
          .getByRole("button", { name: new RegExp(consent.button) })
          .first()
          .click({ timeout: 10000 })
          .catch(() => {});
        await page
          .waitForURL(/travel\/flights/, { timeout: 20000 })
          .catch(() => {});
        if (page.url().includes(consent.host))
          return {
            error: `Google's consent page did not let go: ${page.url()}`,
          };
      }
      await settle(noRows);
      const form = await page.evaluate(
        (css) => ({
          from: document.querySelector(css.from)?.value ?? null,
          to: document.querySelector(css.to)?.value ?? null,
          depart: document.querySelector(css.depart)?.value ?? null,
          passengers:
            document
              .querySelector(css.passengers)
              ?.getAttribute("aria-label") ?? null,
        }),
        css,
      );
      const steps = [{ ...(await read()), form }];
      for (const [leg, n] of pick.entries()) {
        const rows = steps.at(-1).rows;
        if (n > rows.length)
          return { error: `There is no #${n}: the list has ${rows.length}.` };
        await page.evaluate(
          ({ sel, i }) =>
            [...document.querySelectorAll(sel)]
              .filter((e) => e.offsetParent !== null)
              [i].click(),
          { sel: css.row, i: n - 1 },
        );
        // After an outbound comes the return list, or the booking page when nothing is left to pick
        const next = await page
          .waitForFunction(
            ({ returning, booking, leg }) => {
              const t = document.body.innerText;
              if (new RegExp(booking, "i").test(t)) return "booking";
              if (leg === 0 && new RegExp(returning, "i").test(t))
                return "returning";
              return null;
            },
            { returning, booking, leg },
            { timeout: 25000 },
          )
          .then((h) => h.jsonValue())
          .catch(() => null);
        if (!next) return { stuck: page.url() };
        if (next === "returning") await settle(noRows);
        else {
          await page
            .waitForSelector(css.seller, { timeout: 15000 })
            .catch(() => {});
          await page.waitForTimeout(1500);
        }
        steps.push({
          ...(await read()),
          kind: next,
          sellers: await page.$$eval(css.seller, (els) =>
            els.map((e) => e.getAttribute("aria-label")),
          ),
        });
      }
      return { steps };
    },
    {
      url: searchUrl,
      css: FLIGHTS.css,
      noRows: FLIGHTS.noRows.source,
      returning: FLIGHTS.returning.source,
      booking: FLIGHTS.booking.source,
      consent: { host: FLIGHTS.consentHost, button: FLIGHTS.consentButton },
      pick,
    },
  ),
);

if (got.stuck)
  fail(
    `Google Flights did not go on to the return list or the booking page after the click: layout changed? Snapshot ${got.stuck} once and fix scripts/selectors.mjs.`,
  );

// "5:00 PM" → "17:00"
const clock = (t) => {
  const [, h, m, ap] = t.match(/(\d{1,2}):(\d{2})\s?([AP]M)/);
  return `${String((Number(h) % 12) + (ap === "PM" ? 12 : 0)).padStart(2, "0")}:${m}`;
};
// "25 hr 5 min" → "25h05", "33 hr" → "33h", "50 min" → "0h50"; words around it stay
const span = (s) =>
  s
    .replace(/(\d+) hr(?: (\d+) min)?/, (_, h, m) =>
      m ? `${h}h${m.padStart(2, "0")}` : `${h}h`,
    )
    .replace(/^(\d+) min/, (_, m) => `0h${m.padStart(2, "0")}`)
    .trim();
const dayOf = (md) => Date.parse(`${md} 2000`);

function parseRow({ label, text }, n) {
  const price = label.match(FLIGHTS.price)?.[1];
  const carrier = label.match(FLIGHTS.carrier);
  const legs = label.match(FLIGHTS.legs);
  if (!carrier || !legs) return { n, raw: oneLine(label, 220) };
  const codes = text.match(FLIGHTS.route) ?? [
    null,
    ...(text.match(FLIGHTS.codes) ?? []),
  ];
  // Days later it lands, across a new year too (2000 was a leap year)
  const plus =
    (Math.round((dayOf(legs[6]) - dayOf(legs[3])) / 864e5) + 366) % 366;
  const layovers = [...label.matchAll(FLIGHTS.layover)].map(
    (m) => `${span(m[1])} ${m[3] ?? m[2]}`,
  );
  const stops = carrier[1] === "Nonstop" ? 0 : Number.parseInt(carrier[1], 10);
  const duration = span(label.match(FLIGHTS.duration)?.[1] ?? "?");
  return {
    n,
    price: price ? Number(price.replace(/,/g, "")) : null,
    // "Etihad. Operated by Hifly for Etihad Airways": the seller's name is what books it
    airline: carrier[2].split(". ")[0].replace(/ and /g, ", "),
    from: codes[1] ?? legs[1],
    to: codes[2] ?? legs[4],
    dep: clock(legs[2]),
    arr: `${clock(legs[5])}${plus > 0 ? `+${plus}` : ""}`,
    date: legs[3],
    stops,
    layovers,
    duration,
    minutes:
      Number(duration.match(/(\d+)h/)?.[1] ?? 0) * 60 +
      Number(duration.match(/h(\d+)/)?.[1] ?? 0),
  };
}

// `tfu` only remembers how the page was reached; the itinerary is all in `tfs`
const shorter = (url) => url.replace(/&tfu=[^&]*/, "");

const line = (f) =>
  f.raw
    ? `#${f.n}  (unparsed) ${f.raw}`
    : `#${f.n}  ${f.airline}  ${f.from} ${f.dep} → ${f.to} ${f.arr}  ${f.stops ? `${f.stops} stop${f.stops > 1 ? "s" : ""} (${f.layovers.join(", ")})` : "nonstop"}  ${f.duration}  ${money(f.price, cur)}`;

function listRows(step, what) {
  const rows = step.rows.map((r, i) => parseRow(r, i + 1));
  if (!rows.length) {
    const said = [...new Set(step.text.match(FLIGHTS.noRows) ?? [])];
    if (said.length) fail(`Google Flights: ${said.join(". ")}.`);
    fail(
      `No flight rows on ${step.url}: layout changed? Snapshot it once and fix scripts/selectors.mjs.`,
    );
  }
  if (rows.every((r) => r.raw))
    fail(
      `Flight rows came back but none parsed: the labels changed. First one: ${rows[0].raw}. Fix scripts/selectors.mjs.`,
    );
  const kept = rows
    .filter((r) => !(opts.nonstop && r.stops))
    .sort((a, b) =>
      sort === "price"
        ? (a.price ?? 1e12) - (b.price ?? 1e12)
        : sort === "duration"
          ? (a.minutes ?? 1e9) - (b.minutes ?? 1e9)
          : a.n - b.n,
    );
  const cheapest = Math.min(...rows.map((r) => r.price ?? 1e12));
  console.log(
    `${what} (${rows.length} found, ${kept.length > max ? `first ${max} shown` : "all shown"}, cheapest ${money(cheapest, cur)}):`,
  );
  for (const r of kept.slice(0, max)) console.log(line(r));
  return rows;
}

const [search, ...picked] = got.steps;
const form = search.form;
if (!form.from && !search.rows.length)
  fail(
    `Google did not read the search "${sentence}" (the form came back empty): use airport codes (ICN, FUK) or a plainer city name.`,
  );
if (form.depart && !form.depart.startsWith(shortDay(depart)))
  fail(
    `Google read the departure as "${form.depart}", not ${shortDay(depart)}: say the date as YYYY-MM-DD.`,
  );
console.log(
  `${form.from ?? from} → ${form.to ?? to}, ${shortDay(depart)}${back ? ` – ${shortDay(back)}` : " one way"}, ${form.passengers?.replace(/, change.*/, "") ?? who}, ${cabin}, ${cur}`,
);
const insight = search.text.match(FLIGHTS.insight)?.[0];
if (insight) console.log(`${insight}.`);
console.log(`Search: ${searchUrl}`);
const outbound = listRows(
  search,
  back ? "Outbound (price is the round-trip total)" : "Flights",
);

if (!picked.length) {
  console.log(
    back
      ? "Next: --pick <#> lists the returns that go with that outbound."
      : "Next: --pick <#> opens its booking page: sellers, bags and the deep link.",
  );
} else {
  const chosen = outbound[pick[0] - 1];
  console.log(`\nPicked outbound: ${line(chosen)}`);
  const last = picked.at(-1);
  if (last.kind === "returning") {
    listRows(last, "Returns with it (price is the round-trip total)");
    console.log(`Outbound fixed: ${shorter(last.url)}`);
    console.log(
      `Next: --pick ${pick[0]},<#> opens the booking page for that pair.`,
    );
  } else {
    if (picked.length === 2) {
      const ret = parseRow(picked[0].rows[pick[1] - 1], pick[1]);
      console.log(`Picked return:   ${line(ret)}`);
    }
    const sellers = (last.sellers ?? [])
      .map((l) => l.match(FLIGHTS.sellerLabel))
      .filter(Boolean)
      .map(
        (m) =>
          `${m[1].replace(/ airline$/, " (airline)")} ${money(Number(m[2].replace(/,/g, "")), cur)}`,
      );
    if (!sellers.length)
      fail(
        `The booking page came up with no sellers: layout changed? Snapshot ${last.url} once and fix scripts/selectors.mjs.`,
      );
    console.log(`Book with: ${sellers.join(" | ")}`);
    const bags = [...new Set(last.text.match(FLIGHTS.bags) ?? [])];
    if (bags.length) console.log(`Bags: ${bags.join(", ")}`);
    const verdict = last.text.match(FLIGHTS.insight)?.[0];
    const usual = last.text.match(FLIGHTS.usualRange)?.[1];
    if (verdict || usual)
      console.log(
        `Price: ${verdict ?? ""}${usual ? `${verdict ? "; " : ""}similar trips usually ${usual}` : ""}.`,
      );
    console.log(
      `Booking page (deep link, and what watch.mjs checks): ${shorter(last.url)}`,
    );
  }
}
console.log(`(${((Date.now() - started) / 1000).toFixed(1)}s)`);
