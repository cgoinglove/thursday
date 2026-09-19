# Watching a price, and booking

## A price watch

A bot cannot start anything on a schedule; only the user, through Thursday, sets up a routine.
So a watch is a line you hand over, not something you start:

1. Run the watch once now, so the line is known to work and today's price is its baseline:

   ```bash
   node $S/watch.mjs flight "<booking page url>" --below 300           # those exact flights
   node $S/watch.mjs flight ICN FUK 2026-10-15 2026-10-18 --adults 2 --below 600   # the route's cheapest
   node $S/watch.mjs hotel "WeBase Hakata, Fukuoka" 2026-10-15 2026-10-18 --adults 2 --below 90
   ```

2. In your final text, give the request a routine would carry, whole, in the user's language:
   which bot, the exact command, when to run it (once a day is plenty; prices move daily, not
   hourly), and what to report — "tell me only when it says CHEAPER or GONE". Say that Thursday
   can set it up if they ask her.

A run of a routine opens a job like any other: run the one command, and answer with its line.
CHEAPER is news; NOT YET on a routine run is answered in one short line; GONE means the flights
or the room are no longer sold, so search the route again and say what replaced them.

## Booking

Booking goes as far as the last screen before money moves, and no further:

1. The booking page from `flights.mjs --pick` lists the sellers. The airline's own is usually
   the one to use: changes and refunds go through one party.
2. Open it `--headed` (a real window on their screen), follow the seller's steps, and fill what
   the user gave you — names as on the passport, dates of birth, contact. What they did not give
   you is asked for in one `send_message` question, never invented.
3. Stop at the payment page. Leave the window open and answer with what it buys, for how much in
   total with the seller's own currency, and that the pay button is on their screen.

A hotel is the same through `hotels.mjs --detail N`'s seller: the hotel's own site when it is
listed, else the booking site with the lowest price for the same room and the same cancellation
terms.
