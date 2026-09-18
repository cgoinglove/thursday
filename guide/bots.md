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
it answered. The bot remembers the thread it is in. Of its other threads it sees only a line
each — where it stands, the start of its own last words there, the files they named — and can
open one to read those words in full, so carrying work further still means going back to the
same thread rather than starting a new one.

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

## Routines: jobs that start by themselves

A routine is a bot, a job and a time: every weekday at nine, every six hours. It is made by
telling Thursday — "every morning at nine, go through my mail" — or in **Settings › Routines**,
which lists them all, each with one switch. There are two kinds of time, a time of day on
chosen days, or every so many hours, and at most twelve routines.

Each time it is due, a routine opens an ordinary thread, marked with a repeat sign, and that
thread behaves like any other: it shows in the corner of the call screen, a question pauses
it, and its result is told on the next call. The bot is told how its last run ended, so "what
came since last time" works. A routine's row opens its settings and its latest runs; **Run
now** starts one without waiting.

- A run that is still working or waiting on the user when the next time comes is not stacked
  on: that time is skipped. Answering or stopping the open run lets the next one start.
- A result nobody opened is replaced by the next run's; the older one stays in Settings ›
  Threads.
- Switching a routine off keeps it; deleting it keeps the threads it already opened.
- A routine whose bot is switched off waits, and starts once the bot is back on.

Routines start only while Thursday is running on this computer, and, like any job, only with
the app open in a tab unless **Work while the app is closed** is on — the same switch that is
under Settings › Bots, shown at the foot of Settings › Routines too. A time that passed
meanwhile starts once when it is back, not once for every time missed.

## While the app is closed

Jobs run on the user's own machine. Closing every tab pauses them within seconds, and opening
one again picks them back up where they stopped. A call ends when the app closes; the work
waits.

**Settings › Bots › Work while the app is closed** (the same switch is at the foot of Settings ›
Routines) changes that: with it on, jobs carry on and routines start
with nothing open, and a job that ends or asks sends a notification to the computer. It is off
to begin with. Either way the work stops when the server itself stops — quitting the terminal
it runs in, or the machine going to sleep.
