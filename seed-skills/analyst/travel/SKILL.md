---
name: travel
description: "Plans a trip: flights and stays from Google, weather, currency, one offline page. Use it for any travel question — a fare, a forecast, what something costs abroad, or a whole trip planned day by day."
---

# Travel

Three scripts, each `node <this skill's dir>/scripts/<name>.mjs`. No key, a few lines of output;
chain the ones a step needs with `&&` in one bash call.

| Script | Does |
|---|---|
| `weather.mjs "<place>[, <CC>]" <from> [<to>] [--f]` | The forecast a line a day, or past the 16 days it reaches, what the same days were like the last five years. `--f` prints °F |
| `fx.mjs <amount> <FROM> <TO[,TO…]>` | The amount at today's rate, with the rate's date and where it came from |
| `itinerary.mjs <trip.json> [--name <file>]` | The trip as one page in your `artifacts/` folder: a photo and a map link per stop, costs added up. Uses the browser only for a `"photo"` page url |

**Flights and stays have no script, on purpose.** Nothing here stands on another site's markup,
because a search page moves without notice and a wrong price is worse than none. Build a search
url instead, and either read that page once through the `browser` skill or open it on the user's
screen. Unlike Google search, Google Travel answers a headless browser:

```
https://www.google.com/travel/flights?q=Flights to FUK from ICN on 2026-10-15 through 2026-10-18 for 2 adults&curr=USD&hl=en
https://www.google.com/travel/search?q=hotels in Hakata, Fukuoka&checkin=2026-10-15&checkout=2026-10-18&hl=en
```

Percent-encode the `q` before passing it to a command. What those urls carry, and what they do not:

- **The flights `q` is a sentence, and it takes one extra at most.**
  `Flights to <TO> from <FROM> on <depart>[ through <return>][ for N adults[ and M children]]`,
  with airport codes or city names, plus at most one of `nonstop`, `in business`, `one way`. Two
  of those together and Google parses none of it and serves the Flights front page — which is the
  tell: check the page names your route and your dates before you read a price off it.
- **Google Hotels prices are in the machine's currency**, whatever `curr=` or `gl=` says — its
  footer names the address it read that from — and the number on a result row is one night.
  Convert with `fx.mjs` before comparing against a budget, and name the currency you read.
  Google Flights does honour `curr=`.
- **The url cannot set how many guests a stay is for.** Google Hotels opens at two. For any other
  party set it on the page, or say the price is for two.
- **A price is what the page showed at that moment.** Give it with the day you read it, in your
  answer and on the page, and never from memory. It is a quote until it is booked.

Where the rest is written down:

- A whole trip, from the question to the page: `references/plan.md`
- Handing a booking over: `references/book.md`
- The page's JSON, field by field: `references/itinerary.md`
