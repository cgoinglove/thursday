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
   `poster`, `post`, `wireframe`, `direction` — into a file of your own and change what is
   on it. `references/canvas.md` is the layout, the sizes and what makes a set of options a
   real choice; read it before the first board.
3. `node $S/canvas.mjs put <name|path> <file> && node $S/canvas.mjs shots <name|path>` —
   the boards and notes into the canvas, then every board as a PNG beside it, each at its
   own size; one that overflows is refused by number. A canvas another bot handed you is
   reached by its path, never by name.
4. Hand back the canvas's path and the pictures' paths, and say in words what each
   option explores and which you would lead with.

What the file does that you do not write: a head naming who made it and how many boards, a
rail (select, move, pin a note, every board, the list), a list of every board small on the left, and
when a board is picked its real colours, type and spacing on the right with a button that
copies it as an instruction; a link from one board to another (`<a href="#next">`) brings
that board up, so a flow is walked through the way it would be used. Only `put` writes the
boards: never write the canvas file itself, which takes all of that with it. Boards on one
canvas can be different sizes — a phone beside a desktop. In the app the user can pin notes
of their own on the canvas, `<p class="note sticky" data-by="user">`: they are the user's
answer to the options, so read them, and leave them where they are unless the user asks
otherwise. What changes on the boards is yours, put and shot again. To change a canvas that
exists, `node $S/canvas.mjs get <name|path> <file>` first and change that file: `put`
refuses a canvas changed since your last put.
