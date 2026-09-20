---
paths:
  - "features/**/components/**"
  - "components/**"
  - "app/**/*.tsx"
  - "app/globals.css"
  - "hooks/**"
---

# UI

- Domain-agnostic components are shadcn (`components/ui/`). Check there before writing a new one.
- Markdown renders through `components/ui/markdown.tsx` (wraps streamdown).
- Confirmations and prompts: `notify.confirm` / `notify.prompt`. Destructive actions confirm first.
- Notifications: `toast.add`, only for things that happen off-screen. Skip it when the result is
  visible.
- Waiting is always a loader: buttons swap their icon for a Loader, lists use `Skeleton`. Never dots,
  and never a new element that shifts the row when it finishes.
- Words for something still running shine (`ShinyText`), everywhere, the call screen included.
  Only what is not words — a dot, an icon, a bar, a `Skeleton` — pulses. It takes its colours from the theme —
  `tone="waiting"` for amber, never a colour — and truncates in its own box, not a parent's.
- Two status colors only: amber (waits on the user — a question, a stopped job, an answer not yet
  opened, where nothing tells the two apart — the Threads count is one number; `WAITING_INK` in
  `lib/utils`) and red (failed — `text-destructive`). Success, connected and
  enabled have no color of their own: an unopened answer is amber because it waits on the user, not
  because it worked. The settings nav reports the same two, and one blue dot for a section worth
  setting up that nothing waits on — Models with no studio model (the user's pick); the settings
  door in the call screen's corner wears the worst of what it opens (`NavBadge`, `CornerDot`). A
  screen that already means "this waits on you" — the ringing call, the missed list — says so
  without the amber.
- One brand color, blue (`brand` in `app/globals.css`), on black and white, for what matters on a
  screen (the user's pick): what it asks for (`Button variant="brand"`, round; the write line's
  send), Thursday herself (her caption dot), and whatever else there most needs the eye — a new
  result's label in the room's list, the dot on the face that left it, and an answer button
  outlined in it. It stays rare so it
  keeps meaning that. What is on or picked is blue too (the user's pick) — a switch, a radio, a
  slider, a segment or a chip that fills, a picked card's border and its tick — and what is not
  is a hairline or muted words, so nothing picked has to be read twice; a label beside it is
  muted. A chip among several that may all be picked is tinted with a tick, not filled, so a
  row of them stays light (the user's pick). A switch between views of one thing sets nothing
  and is a white pill (`Segmented view`, a dialog's tabs), never blue. Buttons stay black (`primary`): blue says what is set, black what to press. A tick
  that reports (saved, done, a key set) is not a pick and stays black. Never a surface, and no
  status but that one nav dot — a green beside it would read as a second brand.
- What she is doing on a call is one line under her face, each drawn for at least
  `CALL_LINE.dwellMs` (`useDwell`). With captions down the sides the tool lines stand on her
  side instead, under her words (`WorkStack`): the last three, older ones fainter, no rule and
  no plate — and they stay with the turn they led to for the rest of the call, under it
  whenever it is level, the one gone back to included (`useKeptWork`). What the backend is
  thinking about stays under her face in either view,
  held back while a tool line is up. A tool line that follows the caller's words before any
  of hers takes her level line as her turn in the making, and her earlier words step back for
  it as they would for a new turn; thinking alone moves nothing. A window narrower than
  `SIDES_MIN_WIDTH` draws her last line whatever Captions says.
- Errors are never swallowed. Inline or toast, they reach the user.
- Thread questions remain visible while other bots work. Unread endings stay in the inbox until
  the user opens them — its card in the left corner and Thursday's `thread_show` count, closing the
  card does not — or Thursday has told them and marked
  them seen (`thread_seen`); a relay acknowledgement alone never counts as reading. Use neutral surfaces for these
  notices and explicit labels for questions and new results.
- Words stepped in with wait where the composer sits, registered, until the bot's next step reads
  them: a loader and a shining line, never amber, since they wait on the bot and not on the user,
  and they can be taken back until then. Outside the thread only the pill says so, as a shining
  line held by that bot's face. Read, they join the conversation marked `stepped in` — derived (a
  user line straight after that bot's own tool step), never stored.
- Ask the user with an explicit question message; ordinary Thursday messages never block a thread,
  and a question pauses only the bot that asked it. Show one question at a time with optional choices and free text, on a borderless sheet where the
  composer sits; it joins the thread as a record once answered. Its ID selects the recipient and
  its own draft; sending one answer never clears another question's text.
- A thread reads as a conversation from the open tab's bot: that bot holds the left on no surface,
  and everyone else answers from the right — the user's side in the one dark bubble, other bots on
  `secondary`. The dark bubble's contents take the opposite theme through `.inverse`
  (`app/globals.css`), tokens and `dark:` alike. A message to a bot other than the tab's names it
  with a mention at its head.
- Every message draws as words — the user's, questions, answers and reports between participants,
  a bot's reply, the ending — never as the tool call that sent it. The open tab's bot's own work
  draws in full and none of it folds (the user's pick): its words as words and every tool call
  a row, where a step shows what it touched (the site, the file, the pages a search read),
  never the tool's name. Another bot's work between the messages it sends or receives (steps,
  stops, the words beside a call) folds into one row before its next message: a head that
  says what it did last in the bot's own words, how many steps and how long, over a strip of
  tiles — a picture it took, the site it opened, else a glyph for what it did — and the row
  opens in place. A site's icon is round and wears no border, wherever it is drawn. A
  thread opens on its own bot's tab, which holds
  every participant; another bot's tab holds only its own lines and the messages that reached it,
  and the composer follows the open tab. Thursday is never invited and never drawn as a bot.
- The files a message names are drawn under its words, whatever the message: what has a face of
  its own as a tile that opens in the viewer where the reader already is — an image, an html page in
  miniature (the live page, sandboxed, the first `FILE_THUMB.pages` of a message), the head of a
  text — everything else as a row with its kind and size, a path with no file struck through. A
  face is a step darker in the dark, where white paper is otherwise the brightest thing on the
  screen; opened, it is itself again. One
  piece draws a file's face everywhere (`file-thumb`): under a message, in the corner, on the
  shelf in Settings › Files. Nothing a job finished opens by itself — it lands in
  the screen's left corner as a card, the same card with files or without: the bot, the label, how
  the answer opens, the files under the words. A reload brings back the cards still unread, less those this browser
  closed; the pill makes no bubble of a job's ending, since the card says it.
- Thursday is small in one way: `thursday-mark` draws the call's orb in miniature — glyphs keep one
  size, so a bigger box holds more of them, and nothing fades — and every screen draws her through
  it, so a new icon is a change to that file. Only the browser tab keeps the bot-style mark
  (`THURSDAY_SEED`).
- A bot draws with the face picked on its page wherever it appears; nothing varies its mark by
  thread or place, only its state: a dot while something of its waits on the user — amber to
  answer (a question, a stop), blue for a result nobody has opened, amber first when it has both
  (the user's pick) — and crossed-out eyes on a thread the user stopped (`cancelled`). Faces do
  not dim when others are at work: the lift of the one moving is what says who is (the user's pick). A job never ends as a failure: a model that
  breaks pauses it as waiting.
- The pill's bubble shows one thing that just happened, over the face of whoever spoke: that face
  with the bots it reached tucked behind it, then the words — no glyph between faces. Questions
  and stops take amber. Clicking the pill opens the room's list, never a thread; the "+" at its
  left end asks for the write line instead. The card above the pill grows for what waits on the
  user — a question, a stop — and nothing else: a finished job's result is the left corner's
  card alone, so one notice never shows twice (the user's pick). While the write line is up the
  card does not grow — the line stands there — and the pill's own words say what waits.
  The open list keeps the pill's row at its foot, faces without step words, and a moment shows
  there instead of in a bubble; only an open thread hides it.
- The first run is drawn as the call screen, over it (`intro`): her face where it will be, her
  words down its left as captions are, and on its right the caller's turn — a key, the
  microphone, the bots, what they think with. It opens on the app's one loop played silently in
  place and ends on a button that places the first call (`call-signal`, which also holds the
  call's wake word and hotkey off while the intro is up). No step blocks or raises a red error:
  each can be passed and done later where it lives. It shows until a call has been placed.
  Her lines there are also heard, as clips recorded ahead (`intro-voice`, the one file that
  holds what she says aloud, where a clip lives and the hook that plays it): no key is
  needed to hear them, the first starts inside the first click, and her face moves to them
  through the same clip tap a voice sample uses. What she says aloud is its own text — she
  opens by saying it is a recording — so a caption can be rewritten without recording
  anything. A clip is named by a hash of its words: a spoken line that changed is silent
  until `scripts/intro-voice.mts` records it again, and a missing clip is never an error.
- What is typed or handed over rather than said goes through one write line at the foot of the
  call screen (`write-line`): absent until asked for (the pill's "+", `/`, a file dragged onto the
  window), and gone again when a spoken call picks up with nothing in it, it holds who it is for,
  the words and the files. Files are kept in the workspace
  under `GIVEN_FILES.dir` the moment they arrive and travel as paths in the words — which is
  also how the room draws them under the message. A thread's reply takes files the same way
  (`given-files` is the one hook and the one row of chips), and a drop that lands on the room
  is the open thread's rather than the line's. An open thread lies over the right of the call
  and moves none of it — her face and the captions are where they were when it closes (the
  user's pick); only the line steps aside (`roomOpen`), since two composers cannot share the
  foot of the screen. The room's list is a short card in the corner. What the line sends to
  Thursday is a call in writing (`.claude/rules/call.md`).

# Taste

- **A new shape starts from this app.** A face, a chat screen, a notice is drawn from the app's own
  code and screens and judged by whether it belongs here, not by whether it is good on its own. A
  first pass from generic UI — a dark theme, letter avatars, red badges — does not.
- No dividers: groups are split by space.
- Her lines run long, two or three lines beside her face; short ones wrap awkwardly and look empty.
- An icon on a filled button is filled, not outlined. Buttons are fully round.
- A trigger sits inside what it belongs to: the write button is inside the pill, not a circle
  floating beside it, and it is not blue.
- The button that calls her carries no phone glyph: one round blue button, and her face is a
  button too. Cancel is small and set apart (the Esc hint), never a twin of the main button.
- The app opens plainly. Ascii is her face alone — no full-screen wave, no boot curtain.
- What a first-time user reads or hears is plain, everyday English with no jargon (a key is
  "think of it as a password").
- Signing in with ChatGPT is called "GPT Subscription" everywhere. The key step leads with it and
  Vercel AI Gateway; the other providers wait behind "more" as a row of provider marks.
- On the call screen the backend's thinking is one activity line ("Thinking about <title>",
  shining) and no more: a summary body, a list of thoughts and a rail were each built and taken out.
- A stopped job's error text stays as it came, in red; it is not softened into amber or a friendly
  sentence.
- Typing in a free field is a draft, not a value. It saves when an item is picked or Save is
  pressed, never per keystroke or on blur, or a half-typed value lands in the database
  (`components/ui/combobox.tsx` has this shape).
