# The itinerary's JSON

`itinerary.mjs` reads one JSON file and writes the page. Only `title` and `days` (each with
`stops`, each with a `name`) are required; every section appears when its field is there.
Words on the page are yours, in the user's language: set `lang` and `labels` when it is not English.

```json
{
  "title": "Lisbon, three easy days",
  "lede": "Nov 12–15 · 2 adults from London · food, the river, a palace on a hill",
  "lang": "en",
  "place": "Lisbon, Portugal",
  "currency": "GBP",
  "travelers": 2,
  "travel": "transit",
  "cover": { "wiki": "Lisbon" },
  "facts": [
    { "value": "Nov 12 – 15", "label": "3 nights" },
    { "value": "18° / 11°", "label": "Usual high / low" }
  ],
  "flights": {
    "legs": [
      { "label": "Out", "date": "2026-11-12", "from": "LHR", "to": "LIS", "dep": "07:25", "arr": "10:05",
        "duration": "2h40", "stops": "nonstop", "airline": "<the airline>" },
      { "label": "Back", "date": "2026-11-15", "from": "LIS", "to": "LHR", "dep": "18:40", "arr": "21:20",
        "duration": "2h40", "stops": "nonstop", "airline": "<the airline>" }
    ],
    "price": 312,
    "priceNote": "round trip for 2, taxes in",
    "note": "Seen on Oct 20 on the flight search.",
    "link": "<the booking link the search gave>"
  },
  "stay": { "name": "<the stay's name>", "area": "Alfama, 5 min walk to the tram", "nights": 3,
            "price": 96, "rating": "4.6 (812 reviews)", "photo": "https://<its own page>",
            "why": "The best-rated private room under £120 a night.", "link": "<its page>" },
  "climate": "No forecast reaches these days yet; the same days in 2021–2025: highs 18°, lows 11°, rain on 7 of 20 days.",
  "days": [
    { "date": "2026-11-13", "title": "The castle hill, then the palace at Sintra", "weather": "18°/11°, dry",
      "travel": "walking",
      "stops": [
        { "time": "09:30", "name": "São Jorge Castle", "what": "Walk up through Alfama, 20 minutes.",
          "wiki": "São Jorge Castle" },
        { "time": "14:00", "name": "Pena Palace", "what": "Train to Sintra from Rossio, 40 minutes.",
          "wiki": "Pena Palace", "cost": 20, "tip": "Buy the timed ticket the day before." },
        { "time": "19:00", "name": "<a place to eat>", "photo": "https://<the place's own page>",
          "map": "<its name>, Lisbon", "link": "https://<its site>", "linkText": "Hours", "cost": 30 }
      ] }
  ],
  "costs": [
    { "item": "Flights, 2 people", "amount": 312, "note": "round trip" },
    { "item": "<the stay>, 3 nights", "amount": 288 },
    { "item": "Food, about £40 a person a day", "amount": 320 }
  ],
  "fx": "<the line fx.mjs printed>",
  "notes": ["Entry rules checked for the travellers' passports on 2026-10-20."],
  "sources": [{ "url": "https://<the flight search's page>", "label": "<where the flights came from>" }]
}
```

- **A photo per stop** is one of three: `"wiki"`, the English Wikipedia title of the place
  (`"pt:Mosteiro dos Jerónimos"` for another language's — a place outside the English-speaking
  world often has an article, or a picture, only in its own language), whose lead picture comes
  with its author and licence; `"photo"` as a page url, whose own share picture is taken through the browser; `"photo"` as a
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
