/**
 * Everything these scripts know about Google Flights and Google Hotels, in one place.
 * Class names are generated and change with every release, so nothing here is a class:
 * accessibility labels and roles, read with `hl=en` pinned in every url so their wording
 * holds on any machine. `css` crosses into the browser as a string; the patterns parse
 * what comes back, in Node. When a script stops with "layout changed", open the page it
 * names, take one snapshot, fix the line here, and note the date.
 */
export const FLIGHTS = {
  // Search results and the return list (last checked 2026-09)
  css: {
    /** One flight: a row labelled "From 288 US dollars round trip total. Nonstop flight with …".
     *  The Best and Cheapest tabs both sit in the page; only the shown one is read. */
    row: '[role=link][aria-label^="From "]',
    /** The form, read back to see the search took. */
    from: 'input[aria-label^="Where from?"]',
    to: 'input[aria-label^="Where to?"]',
    depart: 'input[aria-label="Departure"]',
    passengers: '[aria-label$="change number of passengers."]',
    /** One seller on the booking page: "Continue to book with Etihad airline for 469 US dollars (…)". */
    seller: '[aria-label^="Continue to book with "]',
  },
  /** What the page says in place of rows. */
  noRows:
    /No results returned|Requested flight date is too far[^.|\n]*|Oops, something went wrong/g,
  returning: /returning flights/i,
  booking: /Booking options/,

  // Pieces of a row's label
  price: /^From ([\d,]+) /,
  carrier: /(Nonstop|\d+ stops?) flight with (.+?)\.\s+Leaves/,
  legs: /Leaves (.+?) at (\d{1,2}:\d{2}\s?[AP]M) on \w+, (\w+ \d+) and arrives at (.+?) at (\d{1,2}:\d{2}\s?[AP]M) on \w+, (\w+ \d+)\./,
  duration: /Total duration ([^.]+)\./,
  layover:
    /Layover \(\d+ of \d+\) is an? (.+?) layover at (.+?)(?: in ([^.]+))?\./g,
  /** The row's visible text carries the codes: "ICN–LIS … 1 stop 6 hr 50 min HEL". */
  route: /\b([A-Z]{3})[–-]([A-Z]{3})\b/,
  /** A narrower layout puts each code on a line of its own: "3:05 PM\nHND\n6:30 AM+1\nLGW". */
  codes: /^[A-Z]{3}$/gm,

  // The booking page, reached by picking every leg
  sellerLabel: /^Continue to book with (.+?) for ([\d,]+) /,
  insight:
    /Prices are currently (?:low|typical|high)|\S+ is (?:low|typical|high) for [\w ]+?(?=\n|$)/m,
  usualRange: /usually cost between ([^.]+?)\./,
  bags: /\d+ free carry-on|No free carry-on|\d+ free checked bags?|No checked bags|\d+ checked bags? included/g,

  /** Europe sends Google to a consent page first; with hl=en its button reads so. */
  consentHost: "consent.google",
  consentButton: "Reject all",
};

export const HOTELS = {
  // Search results (last checked 2026-09)
  css: {
    /** A result's price link: "Prices starting from $81, The Nine States Hotel GREAT DEAL 37% less than usual". */
    price: 'a[aria-label^="Prices starting from "]',
    /** The card is the nearest box above the price link that also holds this one. */
    detail:
      'a[aria-label^="View prices for "], a[aria-label^="View details for "]',
    rating: 'a[aria-label*=" out of 5 stars from "]',
    checkIn: 'input[aria-label="Check-in"]',
    checkOut: 'input[aria-label="Check-out"]',
    travelers: '[aria-label^="Number of travelers"]',
  },
  priceLabel:
    /^Prices starting from \D*?([\d,]+)\D*?, (.+?)(?: (GREAT DEAL|GREAT PRICE|DEAL)(?: (\d+% less than usual))?)?$/,
  rating: /(\d(?:\.\d)?) out of 5 stars from ([\d,]+) reviews?/,
  stars: /(\d)-star hotel/,
  rental: /VACATION RENTAL/,
  amenities: /Amenities for [^:]+: ([^\n]+)/,
  /** Distance lines on a card: "2 miles from Rossio Square", "Excellent location". */
  place:
    /[\d.]+ (?:mi|miles?|km) from [^\n|]+|Excellent location|Great location/,
  travelersCount: /Current number of travelers is (\d+)/,
  noRows: /No results found|didn't match any|No hotels/,
  count: /· ([\d,]+) results/,
};
