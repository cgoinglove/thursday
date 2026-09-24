# Handing a booking over

## The link is read, never built

A flight from `kiwi` carries its booking link. On a search page, once both legs are chosen the
page moves to the flight's booking page, and a stay's own page is a click from the list: the
address the window is on then is the link — read it off (`playwright-cli --raw eval
"location.href"`). Never assemble one by hand, and never hand back a link you did not land on or
get. It is what goes in the itinerary page's `flights.link` and `stay.link`, and what you open for
the user.

## Which seller

That page lists who sells the same flight or the same room. At the same price the airline's or the
hotel's own is the one to prefer: changes and refunds then go through one party. A booking site
that is cheaper is worth saying so, with the difference and its cancellation terms — the terms are
often the reason for the difference.

## Which price

The seller charges in its own currency, and the page shows both (`$312` beside `€288`). Say
the one that will actually be charged, and use `fx.mjs` for the one the user thinks in. The price
can move between the search and the seller's page: if the seller shows another number, that is the
price, and say so rather than repeating the search's.

## On their screen

```bash
playwright-cli open "<the booking url>" --headed --persistent
```

Fill what the user already gave you. A travel booking asks for things a request rarely carries —
each traveller's name exactly as on the passport, date of birth, sometimes passport number and
expiry, a contact email and phone — so gather what is missing in one question rather than one per
field.
