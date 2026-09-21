---
name: design-canvas
description: "Designs side by side on one canvas that pans and zooms: one HTML file holding a board per option with a note on what it costs, a picture of every board to show, and each board's own colours and type as text to build from."
---

# A canvas of options

```bash
node <skill dir>/scripts/canvas.mjs new <name>                 # the canvas, in your artifacts folder
node <skill dir>/scripts/canvas.mjs shots <name> --size WxH    # every board as a picture beside it
```

The canvas's own file holds its style, its panning and its zooming: add boards inside
`<div id="stage">` and never rewrite the file whole. It opens fitted rather than at
full size, because the app draws it 1024px wide and does not scroll it.

Two things decide whether it works. **Every board is the same size**, because one
`--size` shoots them all and a board that misses it comes back named as wrong. And
**a board clips whatever does not fit it** — the picture still comes out the right
size, so nothing but the canvas itself reports it: open the canvas after `shots` and
fix every board it marks `cut`.

The canvas measures every board once it is drawn: its name strip carries the colours it
really paints, and a `spec` button that copies that board — its note, its size and its
values — as text to build from. So a palette is never written into a board by hand.

Read `references/design-canvas.md` before the first board: how a board and its note
are written, where to put them, and what to hand back.
