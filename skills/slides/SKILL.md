---
name: slides
description: "A deck of slides to present or be walked through a step at a time: one file that opens offline, turns with the arrow keys, fits any screen and prints a slide a page. Built from ready slides — cover, statement, cards, number, table, quote, image, close — with what is said over each kept off it as notes, and every slide also a picture of its own. A PowerPoint file to send or edit is an office document, another method's work."
license: Complete terms in LICENSE.txt
---

# Slides

A deck: slides of one exact size in one self-contained HTML file in your folder under
`artifacts/`, shown one at a time and scaled to the window, turned with the arrow keys or a
tap, `f` filling the screen and `n` showing the presenter's notes. `S=<skill dir>/scripts`

1. `node $S/deck.mjs new <name>` — the deck, styled, every slide 1920×1080 (`--size WxH`
   for another).
2. Copy a slide from `deck/slides/` for each step — `cover`, `statement`, `cards`,
   `number`, `table`, `quote`, `image`, `close` — into the deck and change the words.
   Every style is inline, so the values stay readable by whatever reads the slides next.
   `references/deck.md` is the subset, the height arithmetic and what makes a deck work;
   read it before the first slide.
3. `node $S/deck.mjs shots <name|path>` — every slide as a PNG beside the file; one that
   overflows is refused by number. A deck another bot handed you is reached by its path,
   never by name.
4. Hand back the deck's path, and in a line what it argues and how many slides it is.

A slide fades in as it is turned to (`data-transition="push"` or `"none"` on a section
changes that); an `<aside>` inside a slide is what is said over it and never shows on it —
the Notes button in the deck's head shows it under the stage. The file draws its own frame
around the slides: a head naming who made it, arrows and a count, notes, full screen,
Present, a theme button and Export (print, this slide's picture, the file), and a strip of
every slide small at the foot. Write inside `<main>` only. Nothing is edited in the app:
what changes is the file, shot again.
