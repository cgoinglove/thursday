# Bots, threads and what they make

## Who the bots are

A bot is a text model with a name, one sentence about what it is for, and a face. That sentence is
how a job finds its bot. The roster is **Settings › Bots**. **New bot** makes one — it needs a name,
a description and a model, and the name cannot be changed later. A bot's page holds what it
**Runs on**, its **Effort**, when it **Compacts at**, its **Tools**, its own **Prompt**, its recent
threads and its own memory. A bot can be switched off without being deleted. Deleting one keeps what
it finished (**Settings › Files** still shows it under that bot's name), but its memory and the
skills it installed go with it. **Ready-made bots**, beside New bot, adds the ready-made ones; the
first run offers them too. There can be at most 14 bots, switched-off ones included; at 14 the
roster says "14 bots · 14 is the most" in place of New bot, and one has to be deleted first.

Rarely, a bot adds a line of its own after its description when its work has changed for good, and
says so in its answer. The description stays as the user wrote it. On the bot's page the line sits
under the description, and the × beside it clears it; turning off **It may add its own line when
its work changes for good** stops it writing one.

Every bot has the same kit: a shell on this computer, a browser (its own, or the one the user is
signed into), their files, the web, every installed skill and connected service, and the other
bots. A ready-made bot differs only in its role, and some carry a skill of their own:

- **Analyst** finds things out and answers with sources: what something costs, how a number moved
  and why, which one to pick, whether to buy now or wait.
- **Curator** keeps the user up to date: a morning brief on the topics they follow, and anything
  long — a video, a podcast, a talk, an article, a PDF — handed back short, each point linked to
  where it is said.
- **Concierge** takes trips and errands up to the step that pays: a trip laid out day by day,
  flights and stays found and compared, a booking, an order or a form filled in. With the kiwi
  connector on (**Settings › Connectors**) it searches flights without opening a window.
- **Designer** makes what gets looked at: two to four ways a screen or page could look side by
  side, a deck, a post or poster at its real size.
- **Tutor** explains anything as a picture book.
- **Marketer** keeps one brief per product and works from it: positioning, page copy, a launch
  plan, social posts, emails, an SEO audit.
- **Jarvis** takes whatever nobody else is for — the web, files, this computer.

A bot keeps its own memory — what a job taught it, how the user asked it to work — listed on its
page. **Bots keep their own memory**, on the same screen, turns that on or off for every bot.

## A job is a thread

Work handed to a bot becomes a thread: the request, every step, what it asked and what it answered.
To carry work further, write to the same thread rather than start a new one: writing to a thread
that finished or stopped picks it up where it left off.

Threads show in the corner at the bottom right of the call screen (what is running and what waits
on the user; its **History** tab lists what is over) and in **Settings › Threads**, which keeps all
of them: **Filter by label, bot or word** narrows them, each can be deleted, and **Clear finished**
removes every ended one. An ended thread is kept for three months, then deleted; one still running
or waiting on an answer never is, and what a job made stays in **Settings › Files** either way.

Pressing the pill opens the corner as a list; pressing a row opens the thread. **Esc** or the back
arrow steps back one level, and the ✕ folds the room away.

A long thread summarizes itself when it fills up. The small bar at the top right of an open thread
shows how full it is; pressing it has the bot summarize at its next step, which makes every later
step cheaper. The conversation on screen stays whole.

## Stopping a job

**Stop** stops a job. In the thread it stands beside **Step in** while a bot is working, and at the
top right of a question or a pause; in Settings › Threads it is in the **…** menu on the job's row.
The thread then shows *Stopped*. Writing to it later picks it up again. Asking her on a call to stop
it does the same.

## What the faces in the corner do

The faces in the bottom-right pill move only when something happens: a hop when a bot takes on a
job, a jump and turn when it finishes, a jump and head tilt when it has a question, a nod when it
has read a step-in, a sink when it stops. A bubble says it in a few words: *took on …*,
*asks you · …*, *finished its part*, *stopped · …*, *picked it back up*. A face that is lifted is
on a step right now.

## Handing a bot work without a call

The **+** at the left end of the pill, or the `/` key, opens the line at the foot of the screen
(`calls.md`, writing to her). It opens on Thursday; pick a bot with the chip at its left, or type
`@` and a name at the start. That pick lasts for one message. Files can go with the words (at most
8 at a time, 25 MB each). The bot cannot hear the call, so the message has to say the whole job.
Enter sends it, and the room opens on the thread it started.

An open thread's own message box takes files the same way. Once more than one bot is in a thread,
the box says who it is addressed to and can be changed; only the bot the job went to answers the
user, and a bot it pulled in answers back to that bot.

A picture a bot made or was given can be changed rather than drawn again: ask for what should be
different. This needs an image model in **Settings › Models**; if the one picked cannot work from a
picture, the bot says so.

## Telling a running bot something

**Step in** on a bot that is on a step puts words in front of it before its next step — a
correction, a narrower ask. Until read they wait marked *Step-in* and can be taken back with the ✕;
once read they join the conversation. Saying the same to her on a call does the same thing.

A bot that handed its part to another and is waiting has no step to step into; its tab shows an
open message box instead, and words sent there start it again at once.

## When a bot needs the user

- **A question** pauses that bot until answered; other bots keep working. It shows where the
  message box is, with buttons when there are choices. The card above the pill says how many need
  a reply, and each can be answered right there (or just above the line at the foot, while that is
  open).
- **A pause** — a model that broke twice, a provider that refused, the app restarting, a job that
  reached its step limit — shows as *Paused*, and **Continue** picks it up where it left off.
- **Signing in** is always the user's: the bot opens the page and waits.
- **Paying** is the user's too: a bot fills a checkout in and stops at the button.

## What comes back

A job ends in what was asked for and a short report; anything longer than a few lines is a file.
Nothing opens by itself: a finished job waits as a card in the corner at the bottom left until it
is opened or dismissed, even across a reload. The corner holds the five newest. Opening a card or
a file on it counts as reading it, and she will not bring it up on a call; dismissing it with its ✕
does not, and it still waits in its thread. **Clear all** marks every one read, as does asking her
to clear what is finished. The files also show under the bot's words in the thread.

When a job finishes while the app is not the window in front, the browser shows a notification if
it was allowed (it asks when a call is placed); with no app tab open, the computer's own
notification does.

A file opens over the app, and **Esc** closes it. The ↗ button at its top right opens it in a
browser tab. A result she shows on a call closes itself after five seconds unless the mouse moves,
a key is pressed or it is scrolled.

Under a result is a box for a note to the bot that made it — what to change, or what to do next.
The note goes to the thread the file came from, which picks up where it left off. When it cannot,
the box says why instead: the bot waits on an answer (**Answer in the thread**), the bot was deleted
(**Hand to another bot**), or its model has no key or is signed out (**Open Settings**). A file no
thread's report names, or whose thread was deleted, goes to a bot as a new job. If the bot changes
an open file, it is shown fresh with **Reloaded at** and the time; a sound or video shows
**Changed since it opened · Reload**.

**Settings › Files** keeps everything. **Finished** has a shelf per bot (**Everyone**, each bot,
**Unsorted**), each file with **Open in a new tab**, **Reveal in the file manager** and **Delete**.
**All files** is the whole folder, and **Empty scratch** clears the bots' scratch space. A Word
file, a spreadsheet or anything else the app cannot show has **Open it**, which opens it in the
computer's own program.

## Books, canvases, decks and pages

A page, canvas or deck opened inside the app takes the keyboard once clicked; opened in its own tab
(↗) it has the whole window. Its top bar names the bot that made it.

**Tutor**'s picture book is a picture and a line or two a page, turned by swiping, the arrow keys or
tapping either side; it may end on a quiz. It can also be a PDF, or a video that reads itself aloud,
when asked; otherwise it is a book to swipe through. Pictures need an image model and the video a
speech model in **Settings › Models**.

**Designer**'s canvas lays two to four options side by side, each with a note on what it is for and
what it costs, the one it recommends marked. Drag to move, pinch or hold ⌘ and scroll to zoom, the
arrow keys step through the options, and 0 fits everything back. Clicking a board shows its size,
colours, type and spacing, with a button to copy them. **Export** offers **Print · a board a page**,
**This board as a picture**, **Copy this board as an instruction** and **Download this file**. The
note pin on the rail (**N**) pins a note of the user's own; a bot asked to change the canvas reads
the notes. It designs from what exists — a codebase, a brand, a page — so give it a screenshot of a
screen it cannot open.

A **deck** is for presenting. Any bot can make one; the app lays out every slide, in one of four
palettes: **Forest**, **Sea**, **Clay** or **Ink**. The top bar has the arrows, Notes (**n**), full
screen (**f**), Present, a theme button and **Export** (**Print · one slide a page**, **This slide
as a picture**, **Download this file**). Presenting shows the slide alone, never the notes. There is
no PowerPoint file; a handout prints to PDF. **Edit** changes words and notes in place, moves,
duplicates or deletes the open slide, or changes the palette; ⌘Z undoes.

A **sheet** is for numbers to keep working on — a budget, a ledger, a list of clients. It is a real
Excel file (.xlsx) with a page that shows it in the app: a tab per sheet, the picked cell's formula
over the grid, and the sum, average and count of the picked cells. A column's heading button sorts
or filters the view without changing the file. **Export** has **Excel file**, **This sheet as
CSV**, **Copy this sheet** and **Print**. **Edit** changes the sheet itself: type in cells, write
formulas starting with `=`, paste from any spreadsheet, add or take out rows and columns, set how
a column's numbers read, undo and redo; changes are saved into the Excel file. Receipts, invoices
and a bank's or card's CSV export come back as a sheet of spending (a bot never signs in to a bank).
A bot also reads an Excel file handed to it; an old .xls has to be saved as .xlsx first.

A **page** is for reading — a report, a memo, a plan, meeting notes — with its contents beside it,
tables, checklists, and numbered sources at the end. It prints as a document, and **Export › Word
file** saves a .docx. **Edit** makes it editable in place: `/` on an empty line picks a block, and
lines started with `#`, `-`, `1.`, `[]` or `>` become headings, lists, checklists or notes. Changes
are saved as typed. A bot asked to change it starts from the page as edited.

When a deck, sheet or page is changed elsewhere (by its bot, in Excel, or from another window)
while it is being edited, nothing more is saved over it: the top bar says **Changed since it opened · not kept** and shows **Reload**.

## Routines: jobs that start by themselves

A routine is a bot, a job and a time. It is made by telling Thursday — "every morning at nine, go
through my mail", "in an hour, check the fares again" — or with **New routine** in
**Settings › Routines**, which lists them, each with a switch. A bot cannot set one up. At most
twelve exist. **When** has three kinds:

- **Once**: a day and a time, or **In an hour**. It runs once and switches itself off; picking a
  new day and time sets it again.
- **On set days**: a time of day on the days picked; **Every day**, **Weekdays** and **Weekends**
  fill them in one press.
- **Every few hours**: 1, 2, 3, 6, 12 or 24. Another number up to 168 can be set by asking
  Thursday.

Each run opens an ordinary thread, marked with a repeat sign, and the bot is told the last run's
answer, so "what came since last time" works. A routine's row opens its settings and latest runs;
**Run now** starts one at once, unless the last run is still open.

- If the last run is still working or waiting when the next time comes, that time is skipped.
- Switching a routine off keeps it; deleting it keeps the threads it opened.
- A routine whose bot is switched off waits until it is back on; one whose bot was deleted asks for
  another bot.

## While the app is closed

Jobs run on the user's own computer as long as Thursday is running there. Closing every tab does not
stop them, and routines still start. When a phone is connected, questions and endings reach it too
(`phone.md`). A spoken call ends when its tab closes; the work it handed over goes on.

A computer that sleeps pauses everything, and work carries on when it wakes. When Thursday itself
stops — its terminal is quit, or the computer restarts — a running job waits for **Continue**. A
routine time missed while it was not running starts once when it is back.
