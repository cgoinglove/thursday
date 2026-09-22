# Writing a deck

## A slide

`deck.mjs new <name>` writes `<name>/<name>.html` in your artifacts folder, already styled
and already turning. Inside its `<main id="deck">`, one slide is one section:

```html
<section data-slide>
  <h2>Computers find each other by number, not by name</h2>
  <div class="cols">
    <div class="card"><h3>What you type</h3><p class="big accent">example.com</p></div>
    <div class="card"><h3>What the network needs</h3><p class="big">93.184.216.34</p></div>
  </div>
  <aside>The whole system exists to turn the left card into the right one.</aside>
</section>
```

- Every slide is exactly the deck's size — 1920×1080 unless `new` was given another, such as
  `--size 1080x1920` for a phone held upright. Sizes on a slide are px for that size: body
  text is 36px, and nothing under 24px is read from the back of a room.
- Plain HTML reads well as it is: `h1` for the deck's title, `h2` for a slide's, `p`, `ul`,
  `ol`, `blockquote`, `small`. `class="center"` on the section centres it top to bottom;
  `.cols` and `.cols.three` lay out columns, `.card` frames one, `.big` is one huge number or
  word, `.accent` is the one colour. Anything else is an inline style.
- An `<aside>` directly inside a slide is what is said over it. It never shows on the slide:
  the `n` key shows it under the deck, and it is not printed.
- Nothing comes from the network: a picture sits beside the deck file as
  `<img src="photo.jpg">`. Icons are inline `<svg>`, never an emoji, which is a different
  font on every machine.
- Keep `<body style="--w: …; --h: …">` as it was written: it is where the deck says its size,
  and `shots` reads it from there.

## What makes a deck work

- **One idea a slide, and the title says it.** "Computers find each other by number" is a
  title; "DNS overview" is a label. Someone who reads only the titles, in order, follows the
  whole argument.
- **A slide is looked at, not read.** A few words large, one picture, one number — what the
  presenter says goes in the `<aside>`, not on the slide. A slide that needs a paragraph is
  two slides.
- **Start where the listener is, end on what they keep.** The first slide is the question
  they already have; the last is the one sentence they could repeat to someone else.
- Explaining to someone new to it: a new word comes after the picture that shows it, never
  before, and each slide changes one thing from the slide before.

## The pictures

```bash
node <skill dir>/scripts/deck.mjs shots <name>
```

Every slide becomes `slide-01.png`, `slide-02.png` … beside the deck, in order. A slide whose
content overflows comes out taller than the deck and is refused by its number; on the deck
itself the bar at the foot names the same slides as `cut`. Fix every one and shoot again, two
rounds at most. The renderer uses the job's browser, and opens a headless one when none is.

## What to hand back

The deck's path, and in a line what it argues and how many slides it is. Add the pictures'
paths when the slides themselves are what should be looked at first — a few slides to
choose between, a cover to approve. When the pictures could not be made — no browser on this
machine — hand back the deck on its own and say so in one line.
