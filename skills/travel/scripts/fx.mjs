#!/usr/bin/env node
/**
 * An amount in other currencies at today's rate, with the rate's date and source, so a
 * price found in yen can sit beside a budget in dollars. ECB reference rates through
 * Frankfurter; a currency the ECB does not quote (TWD, VND, AED …) comes from
 * ExchangeRate-API's open feed. No key.
 *
 *   node fx.mjs <amount> <FROM> <TO[,TO…]>        node fx.mjs 150 USD EUR,JPY
 */
import { fail, getJson, parseArgs } from "./lib.mjs";

const opts = parseArgs();
const [amountArg, fromArg, toArg] = opts._;
const amount = Number(String(amountArg ?? "").replace(/,/g, ""));
if (!Number.isFinite(amount) || !fromArg || !toArg)
  fail(
    "usage: node fx.mjs <amount> <FROM> <TO[,TO…]>   e.g. node fx.mjs 150 USD EUR,JPY",
  );
const from = fromArg.toUpperCase();
const targets = toArg
  .toUpperCase()
  .split(",")
  .map((c) => c.trim())
  .filter((c) => c && c !== from);
for (const c of [from, ...targets])
  if (!/^[A-Z]{3}$/.test(c))
    fail(`"${c}" is not a three-letter currency code.`);

const show = (value, code) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);

const ecb = await getJson("https://api.frankfurter.dev/v1/currencies");
const rates = {};
let dated = "";
if (from in ecb && targets.every((c) => c in ecb)) {
  const r = await getJson(
    `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${targets.join(",")}`,
  );
  Object.assign(rates, r.rates);
  dated = `ECB reference rate of ${r.date}, via Frankfurter`;
} else {
  const r = await getJson(`https://open.er-api.com/v6/latest/${from}`);
  if (r.result !== "success")
    fail(`No rates for ${from}: ${r["error-type"] ?? "unknown currency"}.`);
  for (const c of targets) {
    if (!(c in r.rates)) fail(`No rate for ${c}: is it a real currency code?`);
    rates[c] = r.rates[c];
  }
  dated = `Rates By Exchange Rate API, updated ${r.time_last_update_utc.slice(5, 16)}`;
}
console.log(
  `${show(amount, from)} = ${targets.map((c) => show(amount * rates[c], c)).join(" = ")}  (1 ${from} = ${targets.map((c) => `${rates[c]} ${c}`).join(", ")}; ${dated})`,
);
