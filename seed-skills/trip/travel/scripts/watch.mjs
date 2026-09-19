#!/usr/bin/env node
/**
 * One price, now, against a limit: the line a daily routine runs to say whether a trip
 * got cheaper. The first word is CHEAPER, NOT YET or GONE, so the answer is read at a
 * glance.
 *
 *   node watch.mjs flight "<booking page url from flights.mjs>" --below 300
 *   node watch.mjs flight <from> <to> <depart> [<return>] [flights.mjs options] --below 300
 *   node watch.mjs hotel "<hotel name>, <city>" <check-in> <check-out> [--adults 2] [--currency USD] --below 150
 *
 * A booking url watches those exact flights; a route watches its cheapest flight on those
 * days. A hotel is watched by its nightly price. The currency is the one the url or the
 * options name (USD when none does).
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, money, parseArgs, shipped } from "./lib.mjs";
import { FLIGHTS } from "./selectors.mjs";

const USAGE = `usage:
  node watch.mjs flight "<booking page url>" --below <price>
  node watch.mjs flight <from> <to> <depart> [<return>] [flights.mjs options] --below <price>
  node watch.mjs hotel "<hotel name>, <city>" <check-in> <check-out> [--adults 2] [--currency USD] --below <price>`;

const argv = process.argv.slice(2);
const opts = parseArgs(argv);
const [what, first] = opts._;
const below = Number(opts.below);
if (!["flight", "hotel"].includes(what) || !first || !(below > 0)) fail(USAGE);
const here = dirname(fileURLToPath(import.meta.url));
const digits = (s) => Number(String(s).replace(/[^\d.]/g, ""));

/** A sibling script's output, or its own error as this script's. */
function run(script, args) {
  try {
    return execFileSync(process.execPath, [join(here, script), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const said = String(error.stderr || error.stdout || error.message).trim();
    if (/No results returned|found nothing|has passed/.test(said))
      console.log(`GONE: ${said}`);
    else fail(said);
    process.exit(0);
  }
}

/** The args after `what`, without --below, handed on to the search script as they came. */
const passOn = () => {
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--below") i++;
    else if (!argv[i].startsWith("--below=")) out.push(argv[i]);
  }
  return out;
};

const verdict = (now, what, extra = "") =>
  console.log(
    `${now <= below ? "CHEAPER" : "NOT YET"}: ${what}, ${money(now, cur)} now, ${now <= below ? "at or under" : "over"} the ${money(below, cur)} limit.${extra}`,
  );

let cur = String(opts.currency ?? "USD").toUpperCase();

if (
  what === "flight" &&
  /^https:\/\/www\.google\.com\/travel\/flights\/booking/.test(first)
) {
  cur = first.match(/[?&]curr=([A-Z]{3})/)?.[1] ?? "USD";
  const url = /[?&]hl=/.test(first) ? first : `${first}&hl=en&gl=us`;
  const { inPage, orFail } = await shipped("browser/scripts/session.mjs");
  const got = orFail(
    await inPage(
      async (page, { url, seller }) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForSelector(seller, { timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(1000);
        return {
          sellers: await page.$$eval(seller, (els) =>
            els.map((e) => e.getAttribute("aria-label")),
          ),
          text: (await page.evaluate(() => document.body.innerText)).slice(
            0,
            4000,
          ),
        };
      },
      { url, seller: FLIGHTS.css.seller },
    ),
  );
  const prices = got.sellers
    .map((l) => l.match(FLIGHTS.sellerLabel))
    .filter(Boolean)
    .map((m) => ({ who: m[1].replace(/ airline$/, ""), price: digits(m[2]) }))
    .sort((a, b) => a.price - b.price);
  if (!prices.length) {
    const said = [...new Set(got.text.match(FLIGHTS.noRows) ?? [])];
    if (said.length || /no longer available|not available/i.test(got.text)) {
      console.log(
        `GONE: these flights are no longer sold (${said.join(". ") || "not available"}). Search the route again.`,
      );
      process.exit(0);
    }
    fail(
      `The booking page showed no sellers: layout changed? Snapshot ${url} once and fix scripts/selectors.mjs.`,
    );
  }
  const usual = got.text.match(FLIGHTS.usualRange)?.[1];
  verdict(
    prices[0].price,
    `The picked flights with ${prices[0].who}`,
    usual ? ` Similar trips usually ${usual}.` : "",
  );
} else if (what === "flight") {
  const out = run("flights.mjs", [
    ...passOn(),
    "--max",
    "1",
    "--sort",
    "price",
  ]);
  cur = String(opts.currency ?? "USD").toUpperCase();
  const cheapest = out.match(/cheapest ([^)]+)\)/)?.[1];
  const row = out.split("\n").find((l) => l.startsWith("#"));
  if (!cheapest) fail(`flights.mjs answered without a price:\n${out}`);
  verdict(
    digits(cheapest),
    "The cheapest flight on those days",
    row ? ` ${row.replace(/^#\d+\s+/, "")}` : "",
  );
} else {
  const name = first.split(",")[0].trim().toLowerCase();
  const out = run("hotels.mjs", [...passOn(), "--kind", "any", "--max", "20"]);
  const row = out
    .split("\n")
    .find((l) => l.startsWith("#") && l.toLowerCase().includes(name));
  if (!row) {
    console.log(
      `GONE: ${first} is not among what Google Hotels lists for those nights. It may be sold out.`,
    );
    process.exit(0);
  }
  const nightly = row.match(/ (\S+)\/night/)?.[1];
  verdict(digits(nightly), `${first.split(",")[0].trim()} per night`);
}
