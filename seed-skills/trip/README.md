# Trip's kit

One skill the Trip seed is born with, copied into `.agents/skills/` in its own folder when it is
created. It is listed to that bot alone.

| Skill | What it adds |
|---|---|
| `travel` | Flights and hotels read from Google Flights and Google Hotels as a few lines each, through the bot's own browser session; weather (Open-Meteo) and exchange rates (ECB via Frankfurter, else ExchangeRate-API's open feed) with no key; a price check a daily routine can run; and `itinerary.mjs`, which writes the trip as one offline page with a Wikipedia or web photo per stop and a Google Maps link per stop and day |

Written for this app. The browser scripts drive the session through the shipped browser skill's
`session.mjs` and keep every selector in `scripts/selectors.mjs`. Nothing needs a package.
