# A whole trip

A trip is four bash calls and one file. More than that is a sign a script's output was not
read, not that the trip was hard.

## 1. What is fixed

From the request: where from, where to, which days, how many people, a budget, what they like.
A relative date ("next month", "a long weekend") becomes real dates you choose — Thursday to
Sunday is a good default for three nights — and the page says which you chose. An origin that is
a city takes its main airport's code (Seoul `ICN`, Tokyo `TYO`, London `LON`, New York `NYC`);
a place with no airport takes the nearest one plus the ground leg, which goes in the plan as its
own stop. Where a train or a drive of a few hours is how people go (Seoul to
Gangneung, Paris to Lyon), there are no flights: leave `flights.mjs` and the page's `flights` out,
and the first stop of day 1 is the train, with its time and fare from the operator's own site.

## 2. Look, in one call

```bash
S=<skill dir>/scripts
playwright-cli open >/dev/null 2>&1; \
node $S/flights.mjs ICN FUK 2026-10-15 2026-10-18 --adults 2 --currency USD --max 6 && \
node $S/hotels.mjs "Fukuoka" 2026-10-15 2026-10-18 --adults 2 --currency USD --max-price 150 --min-rating 4 --max 6 --photos <scratch>/photos && \
node $S/weather.mjs "Fukuoka, JP" 2026-10-15 2026-10-18 && \
node $S/fx.mjs 150 USD JPY
```

The currency is the user's (a budget in dollars means `--currency USD`). A place to stay in a
city with several centres goes by the area that suits the plan ("Hakata, Fukuoka", "Shinjuku,
Tokyo").

## 3. Choose, in one call

Pick the outbound and return that balance price against hours lost — a $20 saving that lands at
midnight or leaves at 6 in the morning is not a saving — and the one or two places to stay that
fit the budget and the area. Google lists places around a city as well as in it: a pick whose
name or `--detail` page puts it in another town is said to be there, with the ride. Then:

```bash
node $S/flights.mjs ICN FUK 2026-10-15 2026-10-18 --adults 2 --currency USD --pick 3,1 && \
node $S/hotels.mjs "Fukuoka" 2026-10-15 2026-10-18 --adults 2 --currency USD --max-price 150 --min-rating 4 --detail 4
```

`--pick` re-runs the search and clicks through, so the numbers are the list you just read only
while it is fresh: run it in the same few minutes. The booking page's url is the deep link that
goes on the page and into a price watch.

## 4. The days

Three to five stops a day, in an order that makes geographic sense, with the travel between them
counted: the first and last day are short, shaped around the flights and the check-in. Places come
from what you know and one `web_search` for what is current (a closure, a festival on those dates,
an exhibition); a place you are unsure still exists is checked, not guessed. Rain in the weather
moves the outdoor stop to a dry day, and the page says so.

## 5. The page, in one call

Write `<scratch>/trip.json` (every field: `references/itinerary.md`) and build:

```bash
cp <scratch>/photos/hotel-4.jpg <scratch>/ && node $S/itinerary.mjs <scratch>/trip.json --name fukuoka-oct
```

The hotel's picture is the one `--photos` saved in step 2, copied beside the JSON. The page is
built from a tested template, so it needs no screenshot: a look costs more than the rest of the
job. The builder prints the page's path and any stop it found no photo for, with why; give those a Wikipedia
title that exists or a page url and build once more, or leave them without one. Build it at most
twice.

## What goes back

Your final text holds the answer before anything else: the flights (airline, times, price), the
place to stay (name, nightly price, why it), the total and per person against the budget, then
the page's path and the booking links. What you could not confirm — a price only one site showed,
a stop whose hours you did not find — is said beside it.
