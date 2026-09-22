# The itinerary's JSON

`itinerary.mjs` reads one JSON file and writes the page. Only `title` and `days` (each with
`stops`, each with a `name`) are required; every section appears when its field is there.
Words on the page are yours, in the user's language: set `lang` and `labels` when it is not English.

```json
{
  "title": "Fukuoka, three easy days",
  "lede": "Oct 15–18 · 2 adults from Seoul · food, the sea, a shrine town",
  "lang": "en",
  "place": "Fukuoka, Japan",
  "currency": "USD",
  "travelers": 2,
  "travel": "transit",
  "cover": { "wiki": "Fukuoka" },
  "facts": [
    { "value": "Oct 15 – 18", "label": "3 nights" },
    { "value": "24° / 18°", "label": "Usual high / low" }
  ],
  "flights": {
    "legs": [
      { "label": "Out", "date": "2026-10-15", "from": "ICN", "to": "FUK", "dep": "17:00", "arr": "18:30",
        "duration": "1h30", "stops": "nonstop", "airline": "Jin Air" },
      { "label": "Back", "date": "2026-10-18", "from": "FUK", "to": "ICN", "dep": "09:45", "arr": "11:15",
        "duration": "1h30", "stops": "nonstop", "airline": "Jin Air" }
    ],
    "price": 609,
    "priceNote": "round trip for 2, taxes in",
    "note": "Seen on Sep 22; Google called it typical for this route.",
    "link": "<the booking url read off the browser>"
  },
  "stay": { "name": "WeBase Hakata", "area": "Hakata, 8 min walk to the station", "nights": 3,
            "price": 93, "rating": "4.4 (566 reviews)", "photo": "https://<its own page>",
            "why": "The cheapest well-rated private room under $150.", "link": "<its page>" },
  "climate": "No forecast reaches these days yet; the same days in 2021–2025: highs 24°, lows 18°, rain on 9 of 20 days.",
  "days": [
    { "date": "2026-10-16", "title": "Castle park and the old shrine town", "weather": "24°/17°, dry",
      "travel": "walking",
      "stops": [
        { "time": "09:30", "name": "Ohori Park", "what": "Walk the lake loop, 2 km.", "wiki": "Ōhori Park" },
        { "time": "14:00", "name": "Dazaifu Tenmangū", "what": "Train from Tenjin, 40 minutes.",
          "wiki": "Dazaifu Tenman-gū", "cost": 12, "tip": "Umegae mochi on the approach." },
        { "time": "19:00", "name": "Ichiran Canal City", "photo": "https://<the place's own page>",
          "map": "Canal City Hakata", "link": "https://<its site>", "linkText": "Hours", "cost": 25 }
      ] }
  ],
  "costs": [
    { "item": "Flights, 2 people", "amount": 609, "note": "Jin Air, round trip" },
    { "item": "WeBase Hakata, 3 nights", "amount": 279 },
    { "item": "Food, about $50 a person a day", "amount": 400 }
  ],
  "fx": "<the line fx.mjs printed>",
  "notes": ["Entry rules checked for the traveller's passport on 2026-09-22."],
  "sources": [{ "url": "https://www.google.com/travel/flights", "label": "Google Flights" }]
}
```

- **A photo per stop** is one of three: `"wiki"`, the English Wikipedia title of the place
  (`"ja:大濠公園"` for another language's — a place outside the English-speaking world often has an
  article, or a picture, only in its own language), whose lead picture comes with its author and licence;
  `"photo"` as a page url, whose own share picture is taken through the browser; `"photo"` as a
  file beside the JSON. A stop with none shows without one — the airport, the hotel check-in, a walk.
- **Every link is a full `http(s)` address** — `flights.link`, `stay.link`, a stop's `link`, a
  source's `url`. Anything shorter stops the build by name before a single photo is fetched.
- **Maps.** Each stop links to Google Maps by `"<name>, <place>"`; `"map"` sets a better query,
  `"map": false` leaves the stop off the map and off the day's route. Each day gets one link that
  opens its stops in order; `"travel"` is how it gets between them (`transit` unless said), on a
  day or on the trip.
- **Costs** are numbers in `currency`; the total and per-person share are added up for you and
  also shown at the top. A range is a string (`"$30–50"`) and is left out of the total.
- `stay.price` is one night's price; the stay's total is worked out from `nights`.
- `facts` are the three or four numbers someone checks first: dates, flight time, weather.
- A leg of `flights.legs` may carry its own `price` when the two halves were bought apart;
  `flights.note` is a line under the panel, for what the price depends on.
- A stop's `linkText` names its link, in place of the site's host.
- `sources` takes `{ "url", "label" }`, or a plain string when the source is not a page.
- `labels` renames the page's own words: `flights`, `stay`, `weather`, `days`, `costs`, `notes`,
  `total`, `perPerson`, `map`, `route`, `book`, `night`, `nights`, `day`, `sources`.
