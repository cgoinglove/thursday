# Writing a deck

`deck.mjs new <name>` writes `<name>/<name>.html` in your artifacts folder: one file that
opens offline, turns with the arrow keys, and prints one slide a sheet. You write the slides
into its `<main id="deck">`, one `<section data-slide>` each, then shoot them.

Ready slides to copy sit in `deck/slides/` beside this page — `cover`, `statement`, `cards`,
`number`, `table`, `quote`, `image`, `close`. Start from the one whose job matches, change the
words, and keep its shape. Each carries the three values a deck sets once: the ground, the ink
and the one accent.

## The subset

A slide is a fixed 1920×1080 page, designed like a poster, not a web page. Nothing reflows and
nothing shrinks to fit, so **every style is inline**: px lengths, hex colours, no classes, no
`<style>` block, no `margin`, no `z-index`, no `em` and no `var()`. A stylesheet would also put
the values out of reach of anything that later reads the slides.

On the section: `background` (always, on every slide), the text defaults (`font-family`,
`color`), and the layout — `display:flex; flex-direction:column; gap`, or `display:grid`, with
`padding:128px`.

Write in reading order: `<h1>` `<h2>` `<h3>` `<p>`, `<ul>`/`<ol>` of plain `<li>`, `<br>`,
inline `<b>` `<i>` `<u>` `<a href>` `<span style="color:…">`, `<div>` containers, `<img>`,
`<table>` of `<tr>`/`<th>`/`<td>`, inline `<svg>`, `<hr>`. Set `font-size` on everything that
holds text; nothing under 24px is read from the back of a room.

Nothing comes from the network: a picture sits beside the deck file as `<img src="photo.jpg">`.
Icons are inline `<svg>`, never an emoji — a different font on every machine.

Keep `<body style="--w: …; --h: …">` as it was written: it is where the deck says its size, and
`shots` reads it from there.

## Two ways to place a thing

**Flow** — children sit one after another in the section's layout, sized to their content
unless given a `width`, `height` or `flex`. Almost everything is flow. Open space low on a
slide is correct.

**Pinned** — `position:absolute` with `left`/`top`/`right`/`bottom`, relative to the section.
Give pinned text a `width` or it will not wrap. Use it only for what flow cannot do: a source
line at the bottom edge, a badge in a corner, or a full-bleed backdrop
(`left:0; top:0; width:1920px; height:1080px; object-fit:cover`) written **first**, since later
children paint over earlier ones and there is no `z-index`.

## The vertical budget

Inside the 128px margins you have **824px of height**. An over-full slide squeezes its boxes —
a squeezed table cuts off lines — so do the arithmetic before writing, not after:

- a heading ≈ font-size × lines × 1.1 (two lines at 96px ≈ 210px)
- a table row ≈ 2.1 × its font-size, **per line of text in a cell** — a two-line cell counts twice
- a card = lines × font-size × line-height + padding
- never set a fixed `height` on a text box: leave it out and let it grow

Nine rows at 32px is already 630px, which does not fit under a two-line heading. When it does
not fit, drop the table to 24–28px or split the slide. Nothing shrinks for you.

**A footer band costs more.** A page number, source or logo is ONE pinned 24px row at
`bottom:64px`, in the same place on every slide that has one. That slide takes
`padding:128px 128px 160px`, so flow stops short and the budget is **792px**, not 824. Nothing
else goes into that band. Take the band's exact y from a shot rather than from arithmetic: the
deck's own stylesheet has a say in where a pinned child lands, and what the browser draws is
what a picture and a PowerPoint file both get.

## Width

Flow text inside the margins is 1664px wide — far too wide to read. Put sentences in a column
of 800–1000px (`width:960px`, or a `flex:1` column beside something else); display lines read
well to about 1400px.

Every column, card and pill must be at least as wide as its longest word, or the word breaks
mid-way: reckon about 0.6 × font-size per character. Count the characters before choosing how
many columns to use.

## Type and colour

Choose **four or five sizes** for the whole deck and repeat them: an eyebrow at 24–28px in
caps with letter-spacing, a heading that states the point, 40–48px for agenda-level lines,
28–32px for sentences. Emphasise with weight, italic or colour — never with a new size. One to
three typefaces.

Pick the palette once: one dark, one light, one or two accents, toned rather than pure `#fff`
and `#000`. Text holds 4.5:1 against its background (3:1 at 44px and up). Use the dark ground
for the opening and closing slides, the light one for the body, and the accent for the single
statement slide you want remembered.

When the user gives a size in points, px = pt × 2 — "36pt" is 72px.

## Rhythm

Slides of one kind share their markup — same padding, same gap, same sizes — and repeated
elements keep their places.

**The heading sits at the top margin on every content slide.** Leave the section's column
top-aligned and spread the body below it with `justify-content:space-between` or a `flex:1`
spacer. Centring a column that has a heading above its body makes the heading's height depend
on how much the slide holds, so it hops 20–60px between neighbours — the commonest flaw in a
generated deck. A slide with no heading above its body — a statement, a quote, the close — is
free to centre.

A content slide whose column stops at 60% of the height reads as unfinished; plan the `gap` so
the blocks span the 824px. A statement slide with open space below is correct.

## The shapes worth knowing

- **Card row** — `<div style="display:flex; gap:32px">` with `flex:1` on each child. The
  default `align-items:stretch` makes every card as tall as the tallest. This is what a bullet
  list should become.
- **A matrix is ONE grid, not several columns.** `display:grid;
  grid-template-columns:repeat(3,1fr)` and let the children fill row by row — separate stacks
  drift apart as their contents differ. Tracks take px, `fr`, `auto` and `repeat(N, …)`; there
  is no `minmax()` or named area.
- **Bars stand on one baseline** — a track of fixed height, `display:flex;
  align-items:flex-end`, each bar's `height` its value on one scale for the whole slide, values
  above and labels below the track. Bars first in a top-aligned column hang from the top and
  the labels land raggedly.
- **Labels over a picture** — wrap the `<img>` in a `position:relative` `<div>` of a set size
  and pin `<p>` elements to that box. Put the artwork in the image and the words over it, never
  inside the SVG: fonts do not load inside an image.
- **Push apart** — an empty `<div style="flex:1"></div>` between siblings. There is no `margin`.

## What makes a deck work

- **Write the titles first, all of them, in one grammar.** Either short topic labels or action
  lines — not both. Someone who reads only the titles, in order, follows the whole argument. A
  title introduces its slide; it is not the presenter's punchline, so no verdicts, no
  manufactured tension ("It's not X, it's Y"), no faux insight.
- **One idea a slide.** One statement slide beats three half-full ones. A slide that needs a
  paragraph is two slides.
- **A slide is looked at, not read.** Decide what becomes a table, a card row, a big number, a
  quote or a picture, and vary them so the deck has rhythm.
- **Start where the listener is, end on what they keep.** The first slide is the question they
  already have; the last is the sentence they could repeat to someone who was not there, and
  what happens next.
- Explaining something new: a word comes after the picture that shows it, and each slide
  changes one thing from the slide before.
- No filler. If a slide feels empty that is a composition problem, not a reason to invent
  content. Never invent a figure or a quote — a detail you were not given stays a visible blank
  like `[figure]`, named in your answer.

## Turning

A slide fades in as it is turned to, from the side the deck is going. `data-transition` on
a section changes that for that slide: `push` slides it in from the edge, `none` holds it
still — which is what a slide wants when the thing on it must not move as it arrives. Leave
it off unless there is a reason; a deck where every slide enters differently is a deck
nobody watches. Nothing moves in a picture of a slide, or for a reader who has asked for
less motion.

## Speaker notes

An `<aside>` directly inside a slide is what is said over it: it never shows on the slide, the
Notes button in the head (or the `n` key) puts it under the stage, and it is not printed. Write notes only when they were asked
for — and then the deck goes visual-first and the script lives in the notes, not on the slide.
Write them as speech, not bullets. The `<aside>` is the section's last child.

## The pictures

```bash
node <skill dir>/scripts/deck.mjs shots <name>
node <skill dir>/scripts/deck.mjs shots <path to a deck>   # one another bot made
```

A name is your own deck. A deck handed to you sits in the other bot's artifacts folder, where
no name of yours reaches it, so it is shot by its path — the file, or the folder holding it —
and its pictures land beside it, where whoever presents will look.

Every slide becomes `slide-01.png`, `slide-02.png` … beside the deck, in order. **A slide that
overflows comes out taller than 1080 and is refused by its number**, and the head of the deck
names the same slides as `cut`. That is the arithmetic above catching you: fix each
one and shoot again, two rounds at most. The renderer uses the job's browser, and opens a
headless one when none is.

## When it has to be a PowerPoint file

The deck itself is what is shown on a screen, and it prints a slide a page. A deck that has to
be *sent* or *edited* as a `.pptx` is an office document, so it is the `documents` method's
work: `doc.mjs deck-from <deck.html>` measures every slide in a browser and writes each box to
the same place in a PowerPoint file — text stays text, a table stays a table, the notes come
across. Nothing is laid out twice, so what the pictures show is what the file holds.

That method belongs to the bot whose subject is office files. Without it, make the deck, say in
one line that a PowerPoint copy is a step away, and let whoever asked decide.

## What to hand back

The deck's path, and in a line what it argues and how many slides it is. Add the pictures'
paths when the slides themselves are what should be looked at first — a few to choose between,
a cover to approve. When the pictures could not be made — no browser on this machine — hand
back the deck on its own and say so in one line.
