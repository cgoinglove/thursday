# Bots, threads and what they make

## Who the bots are

A bot is a text model with a name, one sentence about what it is for, and a face. That
sentence is how a job finds its bot. The roster is **Settings › Bots**: a bot is made there
with a name and that sentence, switched off without being deleted, given its own model, its
own tools and its own written instructions. The first run offers a few ready-made ones, and
the rest of them can be added later from the same screen.

Every bot has the same kit: a shell on this computer, a real browser of its own or the one
the user is already signed into, their files, the web, whatever skills and connected services
are installed, and the other bots. A ready-made bot may also arrive with written methods of
its own for its subject, which no other bot sees.

## A job is a thread

Work handed to a bot becomes a thread: the request, every step it took, what it asked, what
it answered. The bot remembers that thread and nothing else, so carrying work further means
going back to the same thread rather than starting a new one.

Threads live in two places: the corner at the bottom right of the call screen, which shows
what is running, what waits on the user and the five most recent endings (every one not yet
opened stays there too, however many), and **Settings › Threads**, which keeps all of them,
including the ended ones. A stopped thread leaves the corner at once.

## When a bot needs the user

- **A question** pauses that bot until it is answered. It shows where the message box is,
  with buttons when there are choices to pick from. Other bots keep working.
- **A stop** — a model that broke, a provider that refused, the app closing — pauses the
  thread instead of failing it. **Continue** picks it back up where it left off.
- **Signing in** is always the user's: the bot opens the page and waits.
- **Paying** is the user's too: a bot fills a checkout in and stops at the button.

## What comes back

A job ends in the thing that was asked for and a short report. Anything longer than a few
lines is a file. Nothing opens by itself: a finished job's files wait in the corner at the
bottom left of the call screen until they are opened or dismissed, and show under the bot's
words in the thread, images as thumbnails. All of them stay under **Settings › Artifacts**,
one shelf per bot. **Settings › Workspace** is the whole folder, for looking around rather
than for the results.

A bot keeps its own memory — what a job taught it, how the user asked it to work — in its own
folder, listed on its page in Settings › Bots.

## While the app is closed

Jobs run on the user's own machine. Closing every tab pauses them within seconds, and opening
one again picks them back up where they stopped. A call ends when the app closes; the work
waits.

**Settings › Bots › Work while the app is closed** changes that: with it on, jobs carry on
with nothing open, and a job that ends or asks sends a notification to the computer. It is off
to begin with. Either way the work stops when the server itself stops — quitting the terminal
it runs in, or the machine going to sleep.
