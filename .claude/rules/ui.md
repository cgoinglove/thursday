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
  app comes off the ladder or one of the three hues in `app/globals.css`;
  nothing names a raw value at a call site. A floor is a floor: 4.5:1 for text, 3:1 for a shape or text at 24px and up, and a
  colour is measured before it goes in.
- **Two status colors only, and both are warm.** `--destructive` is what failed or is about to be
  destroyed — Tailwind's red-600 in the light theme and red-500 in the dark, the plain red people
  already read as an error rather than the red-orange halfway tone this app carried before, which
  measured too dark and muddy beside the brand blue. It stays apart from `--waiting` by hue alone
  (0° against the ember's 13°), not by avoiding red. It is rare on purpose: an error's own words, a
  connector that will not connect, a key a provider turned away, and the button that deletes. `--waiting`
  (`WAITING_INK` in `lib/utils`) is everything that wants the user — a question, a stopped job, an
  answer not yet opened, a section worth setting up — an ember, brighter than what failed and one
  step deeper in the light theme than the amber this app carried before, which measured 3.19:1 on
  white where small text needs 4.5 (the user's pick). The two are told apart by shape as much as by
  hue: the warm is a dot on a face, a count, a word on the pill, and red is a line of error text
  with its glyph. It lands on those three and nothing else — never a button, never a name, since
  words that want the user shine instead (`ShinyText tone="reading"`). Success, connected and
  enabled have no color of their own. The settings nav reports the same two, and the settings door
  in the call screen's corner wears the worst of what it opens (`NavBadge`, `CornerDot`). A screen
  that already means "this waits on you" — the ringing call, the missed list — says so without it.
- **A border is never a grey of its own.** It is the ink at low opacity (`--alpha-*`), which is
  why it needs no second value for the dark. The ladder is the same list read from the other end
  there (`--gray-0` is the paper and `--gray-1000` the ink in both), so a surface is named once;
  the handful that are not symmetric — a card, `muted`, `ring` — name a step per theme rather than
  a value.
- One brand color, blue (`brand` in `app/globals.css`), on black and white, for what matters on a
  screen (the user's pick): what it asks for (`Button variant="brand"`, round), Thursday herself
  (her caption dot), and the smoke on the button that opens the write line (`write-orb`). The
  line's own send is black, like every other button that is only there to be pressed. What wants the user is the warm's, not the
  brand's. It stays rare so it keeps meaning that. What is on or picked is blue too (the user's pick) — a switch, a radio, a
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
- **How hard a model thinks is a value to pick, like any other.** One button group sets it
  (`features/ai/components/effort-switch`, a `Segmented`): one button per step that model takes
  and none beside them, so a model with two steps shows two. `auto` leads the group — it sets
  nothing and leaves the model to decide, which is a different answer from `none` — and it is the
  only button a model whose ladder nobody knows offers. The step that is set is the brand's, like
  everything else that is picked; there is no hue of its own, no ramp and nothing that moves.
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
- **One rule puts a job on one side of the screen, and every count comes off it** (`bot.schema`
  `standOf`): ended is the left corner's, waiting on the user and working are the room's list, and
  a job that has ended is over whatever its room still holds — an open question row left on one is
  dead, closed at boot (`thread.query closeEndedQuestions`). A number and the rows under it are
  then the same jobs by construction; they once were not, and the pill said three where the list
  showed two. Thread questions remain visible while other bots work. Unread endings stay in the
  inbox until the user opens them — the card or line in the left corner and Thursday's
  `thread_show` count, and so does clearing the corner; closing one with its ✕ does not — or
  Thursday has told them and marked them seen (`thread_seen`); a relay acknowledgement alone never
  counts as reading. A question needs no word saying it is one: the dot on the face, the words
  shining (`tone="reading"`) and the bot's own choices under them say it three ways, and the
  choices are answered from the row itself, to the bot that asked. What the app stopped keeps its
  label, since it is not asking anyone.
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
  a row, where a step shows what it touched or made (the site, the file, the pages a search
  read, the picture it drew — in the call and in what came back), never the tool's name. What
  is still being made holds its box from the first step, a `Skeleton` where the picture will
  be, so nothing moves when it lands. A tool the app itself ships draws as what it makes
  rather than as the server it is reached through (`bot-tool` `studioCall`). Another bot's work between the messages it sends or receives (steps,
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
  pulls its whole gallery before a word of it is read.
- **Whatever this app can draw opens over it, and only the ↗ button leaves for a tab.** A report
  over the call is still the call's screen, and a window the app opened is one it cannot close
  again when they ask it to. One dialog draws them all (`file-view` `FileDialog`, `FileElement`
  drawing the kinds the browser fills itself); a page and a video get a size of their own, and a
  file no kind knows goes to the OS. A file **she** put up rather than the reader closes itself
  after `WORKSPACE_VIEW.autoCloseMs`, counting down beside the path, and the first pointer move,
  key or scroll cancels that for good — one cancellation, never a watch, since a page being read
  gets no input at all and what happens inside the frame is invisible from outside it. What the
  reader opened is never on that clock, and neither dialog takes the focus ring onto a button.
- **What has ended stands in the left corner, and nothing else does** (`bot.schema` `standOf`, the
  one place that decides which side a job is on). Nothing a job finished opens by itself — it
  lands there as a card, the same card with files or without: the bot, the label, how the answer
  opens, the files under the words. A reload brings back what is still unread, less those this
  browser closed; the pill makes no bubble of a job's ending, since the card says it. The corner
  draws `FINISHED_NOTICE.shown` of them as a card — one, which stands clear of what she is saying
  beside her face whatever length that runs to (the user's pick) — and every other one it holds
  as a line under it: the face, the label, and small faces of what it left with a count past
  `ROW_FACES`. **The corner reads what it draws and nothing else**, which is what lets it hold a
  Clear all: a pile of edges said there were more and nothing about them, and reading that was
  reading results the user had never seen.
- **Her face at rest is an ember, and what makes it alive is that it remembers.** The field is
  value noise read at a place another noise has moved (`field.ts`), never a sine: a sine repeats
  at an interval the eye finds in seconds and moves every cell in step. The renderer keeps a
  phosphor — a cell takes a brighter value at once and decays from it on two clocks — so what
  moves leaves a tail, and it keeps the glyph it is holding until its brightness really moves,
  since the eye follows a glyph's identity and a field that shuffles glyphs while its shape holds
  still is read as television snow. A boundary is never a curve: a slow noise around the circle
  moves her radius a few percent, each cell sits a little in or out of wherever that put it, and
  the falloff reaches past the radius so her last cells scatter faint instead of stopping at a
  line. Small, all of it — anything that pushes the whole outline buys its irregularity by
  spending the radius, and three such at once left her a shape with no radius at all (the user's
  pick: the face not being a circle was the odd part, not the eyes). She is a circle; what is
  irregular is what happens inside her and what leaves her. What leaves her leans on a slow wind
  and comes apart at its end into crumbs on their own clocks, because a reach that depends on
  distance alone can only ever draw a halo, however sharp its edge.
- **A ramp of emoji is not a ramp.** Alpha is all the shading an emoji has, and alpha alone does
  not shade a shape: a pale emoji is the same nine pixels across as a bright one, where a "." is a
  tenth of an "米". Sprinkled over an ascii body they are the highlights alone and it never comes
  up; drawn by themselves — which is the app's default — eleven even steps come out as one weight
  everywhere, so what she has thrown weighs what her body weighs and there is no silhouette left.
  The ramp splits instead of shading (`ascii.const` `emojiWeight`): the bottom rungs are the halo
  and fall away in size as well as alpha, and everything from the body up is simply there.
- **Her eyes belong to resting.** Every half-minute or so the pieces draw in, the body closes, and
  two eyes open in it and run one of five scripts (`eyes.ts`); they shut before anything else comes
  up, and a cell inside one drops its trail rather than fading, or a half-gone hole reads as
  neither open nor shut. The shape is the bot faces' own, carried by two numbers rather than one:
  the pair sits where the mark puts it, and only the lens is scaled up, since a hole in a body of
  glyphs has to be bigger than one in a solid shape before it reads at all. One number for both
  pushed the pair out and up along with the lens, and that is what made the proportions wrong.
  **The lid does the opening and the closing** — the lens grows from a slit and goes back to one.
  A hole that fills itself in cell by cell is something appearing and one that fills itself back
  in is something dissolving, and neither is what an eye does; the cell noise is still there, but
  only for the third of a second the lid is moving. The outline itself never wobbles: an eye eight
  cells across cannot carry a fray and stay an eye. And opening her eyes changes nothing else
  about her — she used to draw her pieces in, fill to her rim and grow, which made her a plain
  circle for the one moment she is most worth looking at. Five scripts and a noisy interval,
  because a face that does the same thing on a beat stops being seen once the beat has been
  counted — nothing sets it off and nothing stops it.
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
  somersault, which is the pill saying it without a second notice. The write line takes nothing
  from the pill — same faces, same words, same width, since the line stands in the row above and
  the pill has the rail — except the card, which would grow across the line and so waits until it
  closes. The "+" itself becomes the line meanwhile: smoke turning over in a glass
  (`write-orb`), one hue with three tones of it, carried left to right at a pace that breathes
  and never runs backwards, lifted a little off the pill. It keeps its box, so the pill is the
  same pill. It is painted per pixel from value noise — no library, 0.52ms a frame at 28px,
  which at 30fps is a sixtieth of one core — and it stands still for anyone who has asked for
  less motion. The numbers in it were read off frames the user brought rather than guessed, and
  the file says which. It wears the app's blue, walked from `--brand` at those distances, so the
  one blue at that end of the screen is this and the line's send is black.
  What waits on the user is still there, as the dot on the face it always was. However many
  wait, the card keeps to about three rows and the rest are a scroll away under its count
  (the user's pick, over cutting the list at three).
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
  user's pick). The room's list is a short card in the corner: Now and History both keep under
  a thread's height and scroll, since a list is scanned and a thread is read. What the line
  sends to Thursday is a call in writing (`.claude/rules/call.md`).
- **One message box at a time, and the room has the foot** (the user's pick; `thread.store`
  `roomOpen`). While anything stands open in the room the write line is not drawn, and when
  the room folds it comes back as it was — the words in it kept, and a call in writing still
  on behind it, which is why that line never needs a way to be closed without ending the
  call. Asking for the line folds the room, whoever asks (the list's own "+", `/`, a file put
  down outside the room), with one exception: with a thread open `/` goes to that thread's
  message box, since it is the one on screen — and a thread with no box to write in (a bot
  on a step) leaves the key alone rather than folding under the reader. While a call in
  writing waits behind the room, the room says so at its head (`bot-room` `CallWaits`): her
  face, that she is still on the line, and one press back to her. The line that would say the
  call is on is the very thing put away, and without the band a thread opened
  mid-conversation reads as the conversation having ended.
- **The foot of the screen is a rail of fixtures, and one row above it for what opens**
  (`thursday` `CallFoot`). On the rail, along the bottom and never moving: the finished cards at
  the left end, the pill at the right. The pill takes the whole rail rather than a column of it,
  so no column can cap it — furniture neither moves nor shrinks (the user's pick), and at sixteen
  bots it is the same 467px with the write line up as without. The cards stand on the rail and
  grow upward out of it, so however many have piled up they take none of its height. The row
  above is for what opened rather than sits there: a thread in the room, which takes the height
  the rail leaves and none of its width, or the write line, which stands in the middle. That
  row's two ends take equal tracks, so its middle is the window's middle and the line stands
  under her face whatever is on the rail beneath it. A window too narrow for the line and the
  cards that grow up beside it takes the width off the ends, which truncate where they stand,
  never off the line's place. Nothing at the foot is kept clear of anything else by a breakpoint
  or a measured value, which is why a pill of any length, a thread of any height and a line
  holding files cannot land on one another. Anything new at the foot joins the rail or that row;
  it does not position itself against the window.

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
- The app opens plainly. Ascii is her face alone — no full-screen wave, no boot curtain. The one
  wave there is (`connect-wave`) belongs to a call picking up and to nothing else: it used to play
  once on every load as well, a round front crossing the whole window a second in and landing on
  top of the hello she was already showing, and a round front is the most regular thing that can
  be put on this screen (the user's pick).
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
