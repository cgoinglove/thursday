# A canvas

Ways something could look, side by side on one surface that pans and zooms, each board at the
size the real thing has, a note beside each on what it is for and what it costs, and a picture of
every board. One self-contained HTML file in your folder under `artifacts/`, fitted to the window
because the app draws it at 1024px wide.

## Contents
- The steps
- Writing a canvas
- Sizes
- Laying out a set of options
- Designing well
- The pictures
- The values a board is made of
- What to hand back

## The steps

1. `node <skill dir>/scripts/canvas.mjs new <name>` — the canvas, styled and panning, with two
   empty frames.
2. Copy a board from `templates/boards/` for each option into a file of your own and change what
   is on it (below). Read `craft.md` before the first board.
3. `node <skill dir>/scripts/canvas.mjs put <name|path> <file> && node <skill dir>/scripts/canvas.mjs shots <name|path>`
   — the boards and notes into the canvas, then every board as a picture beside it and
   `boards.png` with all of them for one look; one that overflows is refused by number.
4. Hand back the canvas's path and the pictures' paths, and say in words what each option
   explores and which you would lead with.

What the file does that you do not write: a head naming who made it and how many boards, a rail
(select, move, pin a note, every board, the list), every board small on the left, and when a board
is picked its real colours, type and spacing on the right with a button that copies it as an
instruction; a link from one board to another (`<a href="#next">`) brings that board up, so a flow
is walked the way it would be used. Only `put` writes the boards: never write the canvas file
itself, which takes all of that with it. In the app the user can pin notes of their own on the
canvas, `<p class="note sticky" data-by="user">`: they are the user's answer to the options, so
read them, and leave them where they are unless the user asks otherwise. To change a canvas that
exists, `node <skill dir>/scripts/canvas.mjs get <name|path> <file>` first and change that file:
`put` refuses a canvas changed since your last put.

## Writing a canvas

`canvas.mjs new <name>` writes `<name>/<name>.html` in your artifacts folder, already
styled and already panning. You write the options in a file of your own — one option is one
frame and one note — and `put` them into it. Ready boards to copy sit in `templates/boards/` of this skill — `app` (a desktop screen),
`phone`, `form`, `landing`, `poster`, `post`, `wireframe`, `direction`. Start from the one
whose job matches, give it the next letter and a place, and change what is on it.

```html
<article class="frame leading" id="A" data-mark="Leading" style="--x: 0; --y: 0; --w: 1280; --h: 800">
  <h2>A — <small>one list, a row each</small></h2>
  <div class="board" data-slide>…the design, as plain HTML with inline styles…</div>
</article>

<p class="note" style="--x: 0; --y: -170; --w: 640">
  <strong>A — one list, a row each</strong>
  Every row reads the same way, and the switch is where the eye already is.
  What it costs: no room for what a bot may reach, so that moves to a dialog.
</p>
```

- `--x` / `--y` place the frame on the surface and `--w` / `--h` are the board's size in
  px. The name strip is the first 28px of the frame, so boards in a row with the same
  `--y` line up.
- **Boards can differ in size** — a phone beside a desktop is the usual pair. Each is
  shot at its own size, so give each the size the real thing has (below), never a size
  that fits the row.
- Leave 80px between boards in a row and 240px between rows, which is where the notes
  go. A note's `--w` is its wrap width; its height follows its text.
- `class="leading"` with `data-mark` marks the one option being carried forward. It is
  the only thing on the canvas with a colour of its own, so mark one board at most.
- The frame's `id` is what a link on another board points at: `<a href="#next">` on a
  button brings that board up, so a mockup can be walked through the way it would be
  used — the booking list's button opens the form. Style the `<a>` as the button.
- A `<p class="note title">` over a row names what the row is — a flow, a round, a
  page of the exploration — never one board, whose strip names it. A
  `<p class="note sticky">` is a remark pinned to the surface: a question, what the
  user said, a thing still to decide. One with `data-by="user"` the user pinned there
  themselves.
- Write the board's content as plain HTML with inline styles, laid out with flex or
  grid and `gap`, never with margins between siblings. Nothing comes from the network:
  a picture sits beside the canvas file as `<img src="shot.png">`; a font is the
  system's. Icons are inline `<svg>`, stroke-based on a 24px grid — never an emoji,
  which is a different font on every machine and shoots differently.

## Sizes

CSS px, 96 to an inch. Give a board the size of the thing it stands for:

- **A phone** 390×844 · **a desktop screen** 1280×800, or 1440×900 for a dense one
- **A printed page** Letter 816×1056, A4 794×1123 (swap for landscape); a poster at a
  size you were given is inches × 96, 18×24in → 1728×2304. No size given: Letter or A4.
- **A post** 1080×1350 fills a phone feed, 1080×1080 is the square, 1200×630 the link
  card
- **A page longer than a screen** is a taller board — set `--h` to what it needs, up to
  about 4000 — never a board whose content runs off the bottom. A board is exactly its
  size or it is refused when shot.

## Laying out a set of options

- A row of two or three boards, notes above them. More than three goes to a second row
  240px down, not a longer row: a canvas fitted into the window shrinks to its widest
  point, and a fourth board in the row makes every board a third smaller.
- A flow is a row in the order it is walked, each board linked to the next by its
  buttons, with a title note over the row.
- A board that shows a state rather than a direction — the empty case, the error, the
  long name — goes in a row below its option, with one note for the row.
- Keep the option letters stable across turns. Once a board is B it is B, even after the
  ones before it are dropped, and a direction keeps the name it was chosen under.

## Designing well

- **Settle the direction before the deliverable.** With no brand, no reference and no
  design system given, do not pick an aesthetic alone: put two to four `direction` or
  `wireframe` boards side by side, each exploring an axis you can name — warm editorial
  against dense and quick, one thing at a time against everything at once — never five
  shades of one. A finished screen in each is waste; a sketch is enough to choose by.
  Nobody to ask: commit to one nameable direction, say so, and build.
- **Then commit to a small system.** One to three typefaces, a display face with
  character over a plain body face — never a default that looks like every generated
  page. A toned ground rather than pure white or black. Zero to two accents, and the one
  that means "chosen" is used for that alone. Four or five type sizes for the whole
  board, repeated; emphasis by weight, never by a new size.
- **Root it in what is already there.** A hi-fi board starts from the real thing: the
  codebase and its stylesheet, the brand's files, a page it was shown, a screenshot the
  user gave. Lift exact values — colours, type, paddings, radii, control heights — and
  say in one line what was matched. Mocking a product from nothing is the last resort,
  and a screen you cannot open is asked for as a picture. What you have no asset for is a
  labelled placeholder, which beats a bad attempt at the real thing.
- **Nothing is filled.** No placeholder paragraphs, no invented figures, quotes or
  reviews, no stats for their own sake. A price, a date, an address you were not given is
  a visible `[YOUR PRICE]` for the user to fill. If a board feels empty, that is a
  composition problem, not a reason to add material — and material worth adding is
  suggested in your answer, not put on the board.
- **Controls are real, even on a mockup.** A `<button>`, an `<a href>`, an `<input>`
  with its `<label>` — never a styled `<div>`. On a phone everything pressed is at least
  44px tall. Text holds 4.5:1 against what is behind it (3:1 from 24px); caption grey
  and white on a light accent are what fail, so darken both.
- **No fake chrome.** No drawn status bar, clock, battery or keyboard on a phone board:
  the real ones sit on top of a real screen and a painted one doubles them.
- **Not the tropes.** No gradient washes, no cards with a coloured left border, no emoji
  as icons, no page that could be any product. Bold and quiet both work; what does not
  is the average of every generated page.
- **A landing page** is one sentence that states the offer, one action repeated down the
  page, and proof a visitor can trust — from the user's material or visibly marked. Its
  copy is the product: written from what you were told, in their voice.
- **A printed page** is read from where it hangs. A flyer has ONE dominant line, six
  words or fewer, and the five things a reader needs — what, when, where, cost, one way
  to act — grouped tight. Backgrounds may run to the edge; words stay 72px in from it.
  Body type is never under 16px, rules never under 1px, and it must still read in
  grayscale. A document that flows — a report, a letter — is not a canvas: it is a
  page to read: a document, this skill's other kind.
- **A small change stays small.** Asked to change one word, one colour, one element,
  change that and nothing else on the board. A redesign is asked for in those words.
- **Not another company's design.** Asked to recreate a distinctive UI that is not the
  user's own, say so and design an original that does the same job.

## The pictures

```bash
node <skill dir>/scripts/canvas.mjs shots <name>
node <skill dir>/scripts/canvas.mjs shots <path to a canvas>   # one another bot made
```

A name is your own canvas. A canvas handed to you sits in the other bot's artifacts folder,
where no name of yours reaches it, so it is shot by its path — the file, or the folder
holding it — and its pictures land beside it, where whoever chooses will look.

Every board becomes `board-01.png`, `board-02.png` … beside the canvas, in the order they
appear, each at its own size, and `boards.png` holds all of them, numbered, for one `look_at`. They are what goes in front of whoever chooses — the canvas
is one live face in a thread, the pictures are four. The renderer uses the job's browser,
and opens a headless one when none is.

**A board whose content overflows comes out taller than its size and is refused by its
number**; the canvas marks the same board `cut` on its name strip and in its head. Cut, tighten or
split it and shoot again, two rounds at most.

## The values a board is made of

The canvas reads every board after it is drawn: a row of swatches goes on its name strip,
and when a board is picked — clicked, or brought up with the arrows or from the list on
the left — its size, colours, type, radii and gaps stand in the pane on the right, with a
button that copies the board as text: its name, its note, and those values. All of it comes
from the page itself, so it cannot disagree with the design.

- **Never write a palette or a type scale into a board by hand.** It would be a second
  copy of what the canvas already measures, and the two would drift. Design the board;
  the values describe themselves. (The `direction` board is the one exception: the
  palette is what it is for, and the canvas still measures it.)
- Use real values in the markup rather than names only you know: `#1B1A17`, not a colour
  word nothing resolves.
- That copy is what makes the chosen board buildable: whoever picks it pastes that text
  to whatever writes the code. Say so when you hand the canvas back, in one line.

## What to hand back

The canvas's path and every picture's path, so both the whole comparison and the single
options are in front of whoever chooses. Then, in words: the axis each option explores,
which one you would lead with, and what that one costs — and that the copy button beside a
board copies it as an instruction. When the pictures could not be made — no browser on
this machine — hand back the canvas on its own and say so in one line.
