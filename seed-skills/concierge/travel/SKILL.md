---
name: travel
description: "Plans trips: flights and stays found and compared, a booking handed over, and a day-by-day page. Use it for a fare, a place to stay, or a whole trip."
---

# Travel

Three scripts: the page is this skill's, and the weather and the money are `data-report`'s, which
every bot has. No key, a few lines of output; chain the ones a step needs with `&&` in one bash
call. `S=<this skill's dir>/scripts`, `D=$THURSDAY_SKILLS/data-report/scripts`.

| Script | Does |
|---|---|
| `node $D/weather.mjs "<place>[, <CC>]" <from> [<to>] [--f]` | The forecast a line a day, or past the 16 days it reaches, what the same days were like the last five years. `--f` prints °F |
| `node $D/fx.mjs <amount> <FROM> <TO[,TO…]>` | The amount at today's rate, with the rate's date and where it came from |
| `node $S/itinerary.mjs <trip.json> [--name <file>]` | The trip as one page in your `artifacts/` folder: a photo and a map link per stop, costs added up. Uses the browser only for a `"photo"` page url |

**The search is yours.** Flights, stays and their prices are this skill's work, not a question to
hand to another bot: a hand-off pays for a second bot's prompt, skills and browser, and for the
messages between you, to find what one search of yours finds.

**Flights come from a published search; the rest from a page on the user's screen.** Nothing
here reads another site by script: a search page moves without notice, and a wrong price is worse
than none.

- **With Kiwi connected** — `search-flight` on the `kiwi` server, among your own tools or under
  `## Connected tools` in your prompt — flights are that tool (`tool_search` it for the exact
  inputs): places or airport codes, dates and the party in, and for each flight its price, both
  legs' times and stops, and its booking link.
- **Without it, and for a stay**, the results are the user's to choose from, so the search opens
  on their screen — `--headed`, the `browser` skill — and you read it there. The answer then ends
  by saying that connecting Kiwi in Settings › Connectors finds flights without a window. Google's
  search pages take the search in their address:

```
https://www.google.com/travel/flights?q=Flights to LIS from LHR on 2026-11-12 through 2026-11-15 for 2 adults&curr=USD&hl=en
https://www.google.com/travel/search?q=hotels in Alfama, Lisbon&hl=en
```

Percent-encode the `q` before passing it to a command. What those pages carry, and what they do not:

- **The flights `q` is a sentence:**
  `Flights to <TO> from <FROM> on <depart>[ through <return>][ for N adults[ and M children]]`,
  with airport codes or city names. Anything more — nonstop, the cabin, one way — is set on the
  page. A `q` it did not follow opens the Flights front page, so check the page names your route
  and your dates before you read a price off it.
- **Google Hotels prices are in the machine's currency**, whatever `curr=` or `gl=` says — its
  footer names the address it read that from — and the number on a result row is one night.
  Convert with `fx.mjs` before comparing against a budget, and name the currency you read.
  Google Flights does honour `curr=`.
- **A stay's dates and guests are set on the page.** Google Hotels opens on dates and a party of
  its own, whatever the address says: set the check-in, the check-out and the guests there, and
  read no price until the page shows them.
- **A price is what the page showed at that moment.** Give it with the day you read it, in your
  answer and on the page, and never from memory. It is a quote until it is booked.

Where the rest is written down:

- A whole trip, from the question to the page: `references/plan.md`
- Handing a booking over: `references/book.md`
- The page's JSON, field by field: `references/itinerary.md`
