---
paths:
  - "features/thursday/components/**"
  - "features/bot/components/**"
  - "features/workspace/components/**"
  - "features/artifact/components/**"
  - "features/intro/**"
  - "features/thursday/tool-line.ts"
  - "features/thursday/call-signal.ts"
  - "features/bot/thread.store.ts"
---

# The call screen

The app is one screen: her face in the middle, a rail along the foot, the room over the right.
What holds on every screen is `ui.md`; the faces are `faces.md`. Each look here was picked by the
maintainer.

## The foot

- **A rail of fixtures, and one row above it for what opens** (`thursday` `CallFoot`). On the rail,
  never moving: the finished cards at the left end and the pill at the right, which takes the whole
  rail so no column can cap it. The row above holds what opened — a thread (the height the rail
  leaves, none of its width) or the write line in the middle. That row's two ends take equal tracks,
  so the line stands under her face; a narrow window takes width off the ends, never off the line's
  place. Nothing at the foot is placed by a breakpoint or a measured value, and anything new joins
  the rail or that row rather than positioning itself against the window.
- **One message box at a time, and the room has the foot** (`thread.store` `roomOpen`). While anything
  stands open in the room the write line is not drawn, and it comes back as it was when the room
  folds — words kept, a call in writing still on behind it. Asking for the line folds the room (the
  list's "+", `/`, a file put down outside the room), except that with a thread open `/` goes to that
  thread's box, and a thread with no box leaves the key alone. While a call in writing waits behind
  the room, the room says so at its head (`bot-room` `CallWaits`), with one press back to her.
- **The write line** (`write-line`) is absent until asked for — the pill's "+", `/`, a file dragged
  onto the window — and gone when a spoken call picks up with nothing in it. It holds who it is for,
  the words and the files. Files are kept in the workspace under `GIVEN_FILES.dir` the moment they
  arrive and travel as paths in the words; a thread's reply takes files the same way
  (`given-files`). What it sends to Thursday is a call in writing (`call.md`).

## Her line

- What she is doing is one line under her face, each held at least `CALL_LINE.dwellMs` (`useDwell`).
  **A line names what it touched, read or written** (`tool-line` `fromArgs`): the note's path, the
  command, the skill, the picture, the thread's label — never the tool's name. A tool that reads and
  says nothing of what it read is a step nobody can check.
- With captions down the sides the tool lines stand under her words (`WorkStack`) — the last three,
  older ones fainter — and stay with the turn they led to (`useKeptWork`). The backend's thinking is
  one shining line under her face ("Thinking about <title>"), held back while a tool line is up. A
  window narrower than `SIDES_MIN_WIDTH` draws her last line whatever Captions says.
- Her lines run long, two or three lines beside her face.

## The pill and the room

- **One rule puts a job on one side of the screen, and every count comes off it** (`bot.schema`
  `standOf`): ended is the left corner's; waiting on the user and working are the room's. A job that
  has ended is over whatever its room still holds — an open question left on one is closed at boot
  (`closeEndedQuestions`).
- The pill's bubble shows one thing that just happened, over the face of whoever spoke, with the bots
  it reached tucked behind. Clicking the pill opens the room's list, never a thread; the "+" at its
  left end asks for the write line. The card above the pill grows only for what waits on the user (a
  question, a stop), keeps to about three rows and scrolls past that; a finished result is the left
  corner's alone. While the write line is up the pill keeps its faces, words and width, and the card
  waits until the line closes.
- The row holds `CREW_MAX` faces; past that its tail is a "+" and no number.
- The room's list (Now, History) is a short card that scrolls; a thread is read at full height. An
  open thread lies over the right of the call and moves none of it.

## A thread

- **A thread reads as a conversation from the open tab's bot**: that bot holds the left on no surface,
  everyone else answers from the right — the user in the one dark bubble (`.inverse`), other bots on
  `secondary`. A message to a bot other than the tab's names it with a mention at its head. A thread
  opens on its own bot's tab, which holds every participant; another bot's tab holds its own lines
  and what reached it. Thursday is never drawn as a bot.
- **Every message draws as words**, never as the tool call that sent it. The open tab's bot's work
  draws in full and none of it folds: each tool call is a row showing what it touched or made
  (`bot-tool`), never the tool's name, and a tool the app ships draws as what it makes
  (`studioCall`). What is still being made holds its box from the first step. Another bot's work
  between its messages folds into one row: its last words, how many steps and how long, over a strip
  of tiles.
- The message box names who it is addressed to (`To <bot>`). Addressed to a bot other than the
  thread's own, it says that bot's answer goes to whoever called it, not to the user.
- **Step in is for a bot on a step** (its own row running or queued), never for a thread that is
  merely running: a bot idle inside one gets the open composer under a line naming who is working.
  Words stepped in wait where the composer sits, with a loader and a shining line — not the waiting
  colour, since they wait on the bot — and can be taken back until read; once read they are marked
  `stepped in` (derived, never stored).
- **A question pauses only the bot that asked.** One shows at a time, with its choices and free text,
  on a borderless sheet where the composer sits, and is answered from there to the bot that asked;
  each question keeps its own draft. It needs no word saying it is a question: the dot on the face,
  the shining words and the choices say it.
- Unread endings stay unread until opened — the card, the line, `thread_show` — or told and marked
  seen by Thursday (`thread_seen`). Closing one with its ✕ does not read it, and a relay
  acknowledgement alone never counts.

## Files

- **One piece draws a file's face wherever one appears** (`file-thumb`): under a message, in the
  corner, on the Files shelf. What has a face (an image, an html page in miniature, the head of a
  text) is a tile; anything else a row with its kind and size, a missing path struck through. A face
  is a step darker in the dark and wears a hairline. A page's face is its content alone: the tile
  asks for it as one (`queryKey.fileFace`), and a page a bot wrote leaves off the head and panes it
  wears when opened (skills/shell). A tile is served at `FILE_THUMB.imageWidth`; a
  picture opened to be looked at is served whole. Every picture waits until it is on screen
  (`markdown` `Picture` too).
- **Whatever the app can draw opens over it** (`file-view` `FileDialog`); only the ↗ button leaves for
  a tab. A file she put up closes itself after `WORKSPACE_VIEW.autoCloseMs`, and the first pointer
  move, key or scroll cancels that for good. What the reader opened is never on that clock.
- **What has ended stands in the left corner, and nothing else does.** Nothing a job finished opens by
  itself: it lands as a card — the bot, the label, how the answer opens, its files as square faces
  sharing the card's column, the overflow counted on the last. The corner draws
  `FINISHED_NOTICE.shown` cards and each other ending as a line under them (`ROW_FACES` small faces).
  It reads what it draws and nothing else, which is what lets it hold Clear all. A reload brings back
  what is unread, less what this browser closed.

## The intro

- The first run is drawn as the call screen, over it (`intro`): her face where it will be, her words
  down its left, the caller's turn on its right — a key, the microphone, the bots, what they think
  with, her style. It opens on the app's one loop played silently and ends on a button that places
  the first call (`call-signal` holds the wake word and hotkey off meanwhile). No step blocks or
  raises a red error; each can be done later where it lives. It shows until a call has been placed.
- Her lines there are heard as clips recorded ahead (`intro-voice`): no key is needed, and the first
  starts inside the first click. What she says aloud is its own text. A clip is named by a hash of
  its words, so a changed line is silent until `scripts/intro-voice.mts` records it again; a missing
  clip is never an error.
