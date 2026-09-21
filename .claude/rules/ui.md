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
- What leaves the app is an `<a>` wearing the button's look, `cn(buttonVariants(…))`, never a
  `Button` that renders one: Base UI gives that anchor `role="button"`, so it is no longer heard
  as a link. The `cn` is not optional — unmerged, the base's `border-transparent` beats the
  variant's border in the light theme and the outline disappears.
- Markdown renders through `components/ui/markdown.tsx` (wraps streamdown).
- Confirmations and prompts: `notify.confirm` / `notify.prompt`. Destructive actions confirm first.
- **Esc goes to the last thing that opened, and one Esc does one thing** (`useEscape`,
  `hooks/use-hotkey`). One window listener holds the key for every layer the app draws itself —
  the ringing call, the write line, the room — so which effect registered first never decides
  who gets it. A dialog keeps its own: Base UI dismisses one on the document and stops the
  event there, so it never reaches the window. A field that wants the key handles it and calls
  `preventDefault`; mid-composition it belongs to the character being made and no layer takes
  it. A layer that opens in steps walks back the same way its own buttons do — a thread to the
  list, the list folded. A plain key a screen claims (`/`, `↓`) asks `windowKey` rather than
  repeating the guard at each call site.
- Notifications: `toast.add`, only for things that happen off-screen. Skip it when the result is
  visible.
- Waiting is always a loader: buttons swap their icon for a Loader, lists use `Skeleton`. Never dots,
  and never a new element that shifts the row when it finishes.
- Words for something still running shine (`ShinyText`), everywhere, the call screen included.
  Only what is not words — a dot, an icon, a bar, a `Skeleton` — pulses. It takes its colours from the theme —
  `tone="waiting"`, never a colour — and truncates in its own box, not a parent's.
- **Colour is picked by meaning, and the theme picks only which step of it.** Every colour in the
  app comes off the ladder, one of the three hues, or the effort steps in `app/globals.css`;
  nothing names a raw value at a call site. A floor is a floor: 4.5:1 for text, 3:1 for a shape or text at 24px and up, and a
  colour is measured before it goes in.
- **Two status colors only: the brand blue and one warm.** `--destructive` is what failed or is
  about to be destroyed — a red-orange rather than a red, since beside this blue a true red reads
  as an alarm and almost nothing here is one. It is rare on purpose: an error's own words, a
  connector that will not connect, a key a provider turned away, and the button that deletes. The
  brand colour is everything that wants the user — a question, a stopped job, an answer not yet
  opened, a section worth setting up — under its own name, `--waiting` (`WAITING_INK` in
  `lib/utils`), so the day one of those has to be told apart from the rest is one line and not a
  sweep (the user's pick). Success, connected and enabled have no color of their own. The settings
  nav reports the same two, and the settings door in the call screen's corner wears the worst of
  what it opens (`NavBadge`, `CornerDot`). A screen that already means "this waits on you" — the
  ringing call, the missed list — says so without it.
- **A border is never a grey of its own.** It is the ink at low opacity (`--alpha-*`), which is
  why it needs no second value for the dark. The ladder is the same list read from the other end
  there (`--gray-0` is the paper and `--gray-1000` the ink in both), so a surface is named once;
  the handful that are not symmetric — a card, `muted`, `ring` — name a step per theme rather than
  a value.
- One brand color, blue (`brand` in `app/globals.css`), on black and white, for what matters on a
  screen (the user's pick): what it asks for (`Button variant="brand"`, round; the write line's
  send), Thursday herself (her caption dot), and whatever else there most needs the eye — a new
  result's label in the room's list, the dot on the face that left it, and an answer button
  outlined in it. It stays rare so it
  keeps meaning that. What is on or picked is blue too (the user's pick) — a switch, a radio, a
  slider, a segment or a chip that fills, a picked card's border and its tick — and what is not
  is a hairline or muted words, so nothing picked has to be read twice; a label beside it is
  muted. A chip among several that may all be picked is tinted with a tick, not filled, so a
  row of them stays light (the user's pick). The row a settings index is open on, and a card
  ticked in a list of them, wash the same blue faint enough to read as paper with a tint
  (`PICKED_ROW` in `setting-ui`): the index row so which one the right pane belongs to needs no
  reading, the card so its border and tick are not carrying it alone. Every one takes that wash
  from the one constant. The pill's tail, which only says there are more
  faces than fit, is a faint brand wash rather than a fill: nothing behind it waits on anyone.
  A switch between views of one thing sets nothing
  and is a white pill (`Segmented view`, a dialog's tabs), never blue. Buttons stay black (`primary`): blue says what is set, black what to press. A tick
  that reports (saved, done, a key set) is not a pick and stays black. Never a surface, and no
  status but that one nav dot — a green beside it would read as a second brand.
- What she is doing on a call is one line under her face, each drawn for at least
  `CALL_LINE.dwellMs` (`useDwell`). **A line names what it touched, whether the tool wrote or
  read** (`tool-line` `fromArgs`): the note's path, the command — the model's own line for it
  where the tool asks for one — the skill, the picture, the thread's label. A tool that reads
  and says nothing of what it read is a step the user cannot go back and check, since only
  the writing side leaves a row behind. With captions down the sides the tool lines stand on her
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
  the user opens them — its card in the left corner and Thursday's `thread_show` count, and so
  does clearing the corner, which is the one way there to have done with a pile of them;
  closing one card does not — or Thursday has told them and marked
  them seen (`thread_seen`); a relay acknowledgement alone never counts as reading. Use neutral surfaces for these
  notices and explicit labels for questions and new results.
- The message box names who it is addressed to (`To <bot>`), because a thread with several
  participants sends to whichever tab is open. Addressed to a bot other than the thread's own,
  it also says where that bot's answer lands: it reports to whoever called it, not to the user.
- Step in is for a bot on a step — its own row in the room running or queued — never for a
  thread that is running: a bot idle inside one (it handed its part over and waits) gets the
  open composer under a still line naming who is working, because words to it start it again
  at once (`room.query` `deliver`) and there is no step to step into.
- Words stepped in with wait where the composer sits, registered, until the bot's next step reads
  them: a loader and a shining line, never the waiting colour, since they wait on the bot and not on the user,
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
  screen; opened, it is itself again. It wears a hairline wherever it is drawn, since a white
  page on a white sheet has no edge of its own. One
  piece draws a file's face everywhere (`file-thumb`): under a message, in the corner, on the
  shelf in Settings › Files. A face is optimized to a tile's width (`FILE_THUMB.imageWidth`,
  `next.config` images) — what a bot makes is megabytes and a shelf lists dozens — while a
  picture opened to be looked at is served whole. Every other picture waits until it is on
  screen: the ones in a report's own words too (`ui/markdown` `Picture`), or a long report
  pulls its whole gallery before a word of it is read. Nothing a job finished opens by itself — it lands in
  the screen's left corner as a card, the same card with files or without: the bot, the label, how
  the answer opens, the files under the words. A reload brings back the cards still unread, less those this browser
  closed; the pill makes no bubble of a job's ending, since the card says it.
- Thursday is small in one way: `thursday-mark` draws the call's orb in miniature — glyphs keep one
  size, so a bigger box holds more of them, and nothing fades — and every screen draws her through
  it, so a new icon is a change to that file. Only the browser tab keeps the bot-style mark
  (`THURSDAY_SEED`).
- A bot draws with the face picked on its page wherever it appears. The stored colour is the
  user's and never changes; nine of the eighteen are too light to read on a white page, so the
  light theme draws those as a darker twin of the same hue (`markInk` in `mark.const`). Nothing
  else varies its mark by
  thread or place, only its state: one dot in the brand colour while something of its wants the user — a question, a
  stop, a result nobody has opened, all the same dot (the user's pick) — and crossed-out eyes on a
  thread the user stopped (`cancelled`). Faces do
  not dim when others are at work: the lift of the one moving is what says who is (the user's pick). A job never ends as a failure: a model that
  breaks pauses it as waiting.
- A face answers what happens to the bot behind it with one gesture, and `crew-motion` is the
  whole vocabulary: which gesture each event gets, how long it runs, and which of a face's
  layers it takes (the body through the air, the shape pressing and flattening, the turn) — a
  jump reads as weight only when its height and its squash run on different curves. At rest
  every face breathes, each on its own phase. One gesture at a time per face: a second event
  starts over rather than landing inside the first. A gesture is a moment and a dot is a
  state, so the dot outlives it, and a gesture never stands where a notice would — it is on the
  face, not over it. Nothing moves that nothing happened to, and the lift of a working bot sits
  outside all of it, so a bot at work is still lifted while it jumps.
- A face in the row answers for its own bot: it is up while that bot's row in the room is
  running or queued (`room.participants`), never because the thread it sits in is working —
  one participant on a step keeps a thread working while everyone it handed work to rests.
- The pill's bubble shows one thing that just happened, over the face of whoever spoke: that face
  with the bots it reached tucked behind it, then the words — no glyph between faces. Questions
  and stops take the waiting colour. Clicking the pill opens the room's list, never a thread; the "+" at its
  left end asks for the write line instead. The card above the pill grows for what waits on the
  user — a question, a stop — and nothing else: a finished job's result is the left corner's
  card alone, so one notice never shows twice (the user's pick); the bot's own face turns a
  somersault, which is the pill saying it without a second notice. While the write line is up the
  card does not grow and the pill's right side says only what is running: the line stands where
  the card would, and the track it leaves the pill is not wide enough for a sentence as well.
  What waits on the user is still there, as the dot on the face it always was.
  The open list keeps the pill's row at its foot, faces without step words, and a moment shows
  there instead of in a bubble; only an open thread hides it. The row holds `CREW_MAX` faces and
  says nothing until it is full; past that its tail is a "+" and no number, since a count of
  bots nobody can act on is a number to read (the user's pick).
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
  user's pick). The room's list is a short card in the corner. What the line sends to Thursday
  is a call in writing (`.claude/rules/call.md`).
- **One message box at a time, and the room has the foot** (the user's pick; `thread.store`
  `roomOpen`). While anything stands open in the room the write line is not drawn, and when
  the room folds it comes back as it was — the words in it kept, and a call in writing still
  on behind it, which is why that line never needs a way to be closed without ending the
  call. Asking for the line folds the room, whoever asks (the list's own "+", `/`, a file put
  down outside the room), with one exception: with a thread open `/` goes to that thread's
  message box, since it is the one on screen — and a thread with no box to write in (a bot
  on a step) leaves the key alone rather than folding under the reader.
- **The foot of the screen is a rail of fixtures, and one row above it for what opens**
  (`thursday` `CallFoot`). On the rail, along the bottom and never moving: the finished cards
  at the left end, the write line in the middle, the pill at the right. A line that comes up
  takes the track its two neighbours leave rather than pushing either of them anywhere — the
  pill is furniture and furniture does not move (the user's pick) — which is why it carries
  less while the line is up. The cards stand on the rail and grow upward out of it, so however
  many have piled up they take none of its height. The row above is for what opened rather
  than sits there: a thread in the room, which takes the height the rail leaves and none of its
  width. Nothing at the foot is kept clear of anything else by a breakpoint or a measured
  value, which is why a pill of any length, a thread of any height and a line holding files
  cannot land on one another. Anything new at the foot joins the rail or that row; it does not
  position itself against the window.

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
- A stopped job's error text stays as it came, in red; it is not softened into the waiting colour or a friendly
  sentence.
- Typing in a free field is a draft, not a value. It saves when an item is picked or Save is
  pressed, never per keystroke or on blur, or a half-typed value lands in the database
  (`components/ui/combobox.tsx` has this shape).
