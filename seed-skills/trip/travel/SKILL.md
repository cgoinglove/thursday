---
name: travel
description: "Trips by script instead of snapshots: flights and hotels from Google Flights and Google Hotels as a few lines each, weather for the dates, currency conversion, a price watch a routine can run daily, and the itinerary as one page with a real photo and a map link per stop."
---

# Travel

A whole trip — somewhere, for some days — follows `references/plan.md`: read it first.

A snapshot of a flight or hotel results page runs 60-130k characters. These scripts read
the same pages through your own browser session and print a dozen lines, so run them first
and snapshot only when one says the layout changed. Each is
`node <this skill's dir>/scripts/<name>.mjs`; `playwright-cli open` once before the browser
ones, then chain every search a step needs with `&&` in one bash call.

| Script | Does | Browser |
|---|---|---|
| `flights.mjs <from> <to> <depart> [<return>] [--adults N] [--children N] [--cabin …] [--nonstop] [--currency USD] [--sort price] [--pick N[,M]]` | Options as rows (#, airline, times, stops, duration, price) and whether prices are low. Only after reading a list: `--pick N` is that list's #N outbound and lists its returns, `--pick N,M` adds return #M and opens the booking page (sellers, bags, the usual range, the deep link) | yes |
| `hotels.mjs "<place>" <in> <out> [--adults N] [--currency USD] [--max-price N] [--min-rating 4] [--stars 3] [--kind hotel\|rental\|any] [--sort price] [--photos <dir>] [--detail N]` | Places to stay as rows (nightly price and total, rating, class, deal); `--detail N` prints who sells which room; `--photos` saves each one's picture | yes |
| `weather.mjs "<place>, <CC>" <from> [<to>]` | The forecast a line a day, or past the 16 days it reaches, what the same days were like the last five years | no |
| `fx.mjs <amount> <FROM> <TO,…>` | The amount at today's rate, with the rate's date | no |
| `watch.mjs flight\|hotel …  --below N` | One line, CHEAPER / NOT YET / GONE: what a daily routine runs | yes |
| `itinerary.mjs <trip.json> [--name <file>]` | The trip as one page in your artifacts folder, photos inside | only for `photo` urls |

Two facts no page tells you:

- **Every price is in the currency you pass, whatever the machine's country.** Google Hotels
  ignores `curr=` and the script sets it another way; a price you read off a page by hand is in
  the machine's currency and is converted with `fx.mjs` before it is compared.
- **The cheapest room can be a bed in a dormitory.** A place that wins on price goes through
  `--detail N` before it is recommended; a rating from a handful of reviews is not a rating.

A script that stops with "layout changed" means the site moved something: snapshot the page it
names once, fix the line in `scripts/selectors.mjs`, and run it again. Kayak, Booking.com and
Skyscanner answer a headless browser with a robot check: go there only for something Google does
not show, and `--headed --persistent` when you do.

- A whole trip, from the question to the page: `references/plan.md`
- The page's JSON, every field: `references/itinerary.md`
- Watching a price, and booking up to the payment page: `references/watch-and-book.md`
