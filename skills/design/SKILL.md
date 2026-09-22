---
name: design
description: "Ways something could look, side by side on one canvas, each at its real size: an app screen, a phone screen, a form, a landing page, a poster or flyer, a social post, a wireframe, a direction to choose between. Every board is also a picture of its own, and a button on one board can lead to the next. For settling how a thing should look before it is built, and for a mockup at exact size."
license: Complete terms in LICENSE.txt
---

# Design

A canvas: boards pinned on one surface that pans and zooms, a note beside each on what it
is for and what it costs, and a picture of every board. One self-contained HTML file in
your folder under `artifacts/`, opening with no network, fitted to the window because the
app draws it at 1024px wide. `S=<skill dir>/scripts`

1. `node $S/canvas.mjs new <name>` — the canvas, styled and panning, with two empty frames.
2. Copy a board from `boards/` for each option — `app`, `phone`, `form`, `landing`,
   `poster`, `post`, `wireframe`, `direction` — into the canvas and change what is on it.
   `references/canvas.md` is the layout, the sizes and what makes a set of options a real
   choice; read it before the first board.
3. `node $S/canvas.mjs shots <name>` — every board as a PNG beside the file, each at its
   own size; one that overflows is refused by number.
4. Hand back the canvas's path and the pictures' paths, and say in words what each
   option explores and which you would lead with.

Two things the file does that you do not write: it measures each board's real colours,
type and spacing into its name strip, with a `spec` button that copies the board as an
instruction; and a link from one board to another (`<a href="#next">`) brings that board
up, so a flow is walked through the way it would be used. Boards on one canvas can be
different sizes — a phone beside a desktop — and there is no editing in the app: what
changes is the file, shot again.
