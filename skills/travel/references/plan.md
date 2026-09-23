# A whole trip

A trip is a handful of bash calls and one file: the scripts in one, the browser in a few, the
page in one. More than that is a sign an output was not read, not that the trip was hard.

## 1. What is fixed

From the request: where from, where to, which days, how many people, a budget, what they like.
A relative date ("next month", "a long weekend") becomes real dates you choose — Thursday to
Sunday is a good default for three nights — and the page says which you chose. An origin that is
a city takes its main airport's code (Seoul `ICN`, Tokyo `TYO`, London `LON`, New York `NYC`);
a place with no airport takes the nearest one plus the ground leg, which goes in the plan as its
own stop. Where a train or a drive of a few hours is how people go (Seoul to Gangneung, Paris to
Lyon), there are no flights: leave the flight search and the page's `flights` out, and the first
stop of day 1 is the train, with its time and fare from the operator's own site.

## 2. What no page is needed for, in one call

```bash
S=<this skill's dir>/scripts
node $S/weather.mjs "Fukuoka, JP" 2026-10-15 2026-10-18 && \
node $S/fx.mjs 150 USD JPY
```

The currency is the user's: a budget in dollars means the whole answer is in dollars.

## 3. The flights and the stay, in the browser

Build the two search urls (`SKILL.md` has the shapes), then read the page as its own text: a
snapshot of a results page costs tens of thousands of characters and says no more than this.

```bash
playwright-cli open "<the flights url>" >/dev/null && \
playwright-cli --raw eval "document.body.innerText.slice(0, 2500)"
```

That is a dozen flights — time, airline, duration, stops, price — in about 1,500 characters. If it
comes back with `Loading results` and no prices, read it again; the page fills in a second or two.

A round trip lists departures only, and each row's price is the round-trip total for the whole
party. The returns sit behind the departure you pick: `find` that row, click it, and read the text
again — the page is now "Choose return" with a list of its own. Choose both on times as well as
price — a $20 saving that lands at midnight or leaves at 6 in the morning is not a saving — and
say why the one you chose beats the next.

Then `goto` the stays url and read it the same way: name, nightly price, rating, class, whether it
is refundable. An apartment or a whole house is the same url with `vacation rentals in <place>` as
the `q`. Google lists places around a city as well as in it, so a pick whose name or address puts
it in another town is said to be there, with the ride; and a room that wins on price is opened
before it is recommended — the cheapest bed can be a bunk in a dormitory, and a rating from a
handful of reviews is not a rating.

## 4. The days

Three to five stops a day, in an order that makes geographic sense, with the travel between them
counted: the first and last day are short, shaped around the flights and the check-in. Places come
from what you know and one search for what is current (a closure, a festival on those dates, an
exhibition); a place you are unsure still exists is checked, not guessed. Rain in the weather moves
the outdoor stop to a dry day, and the page says so.

## 5. The page, in one call

Write `<scratch>/trip.json` (`references/itinerary.md` is every field) and build:

```bash
node $S/itinerary.mjs <scratch>/trip.json --name fukuoka-oct
```

The page is built from a tested template, so it needs no screenshot: a look costs more than the
rest of the job. The builder prints the page's path and any stop it found no photo for, with why;
give those a Wikipedia title that exists or a page url and build once more, or leave them without
one. Build it at most twice.

## What goes back

Your final text holds the answer before anything else: the flights (airline, times, price), the
place to stay (name, nightly price, why it), the total and per person against the budget, then the
page's path and the links. Every price says the day you read it. What you could not confirm — a
price only one seller showed, a stop whose hours you did not find — is said beside it.
