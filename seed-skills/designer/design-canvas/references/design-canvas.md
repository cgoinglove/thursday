# Writing a canvas

## A board and its note

`canvas.mjs new <name>` writes `<name>/<name>.html` in your artifacts folder, already
styled and already panning. Inside its `<div id="stage">`, one option is one frame and
one note:

```html
<article class="frame leading" data-mark="Leading" style="--x: 0; --y: 0; --w: 1280; --h: 800">
  <h2>A — <small>one list, a row each</small></h2>
  <div class="board" data-slide>…the design, as plain HTML with inline styles…</div>
</article>

<p class="note" style="--x: 0; --y: -190; --w: 620">
  <strong>A — one list, a row each</strong>
  Every row reads the same way, and the switch is where the eye already is.
  What it costs: no room for what a bot may reach, so that moves to a dialog.
</p>
```

- `--x` / `--y` place the frame on the surface and `--w` / `--h` are the board's size
  in px. The name strip is the first 28px of the frame, so boards in a row with the
  same `--y` line up.
- **One size for every board on a canvas** — a phone is 390×844, a desktop 1280×800, a
  poster 1240×1754. `shots` takes that one size and shoots every `[data-slide]`.
- Leave 80px between boards in a row and 240px between rows, which is where the notes
  go. A note's `--w` is its wrap width; its height follows its text.
- `class="leading"` with `data-mark` marks the one option being carried forward. It is
  the only thing on the canvas with a colour of its own, so mark one board at most.
- Write the board's content as plain HTML with inline styles. Nothing comes from the
  network: a picture sits beside the canvas file as `<img src="shot.png">`.
- Icons are inline `<svg>`, stroke-based on a 24px grid — never an emoji, which is a
  different font on every machine and shoots differently.

## Laying out a set of options

- A row of two or three boards, notes above them. More than three goes to a second row
  240px down, not a longer row: a canvas fitted into the window shrinks to its widest
  point, and a fourth board in the row makes every board a third smaller.
- A board that shows a state rather than a direction — the empty case, the error, the
  long name — goes in a row below its option, half size, with one note for the row.
- Keep the option letters stable across turns. Once a board is B it is B, even after
  the ones before it are dropped.

## The pictures

```bash
node <skill dir>/scripts/canvas.mjs shots <name> --size 1280x800
```

Every board becomes `board-01.png`, `board-02.png` … beside the canvas, in the order
they appear. They are what goes in front of whoever chooses — the canvas is one live
face in a thread, the pictures are four. The renderer needs a browser already open in
this job.

A board that is not exactly `--size` is named in the output and has no usable picture;
a board whose content overflows is clipped silently, and only the canvas says so, in
its bar and on the board. Open the canvas after `shots` and fix what it marks.

## What to hand back

The canvas's path and every picture's path, so both the whole comparison and the single
options are in front of whoever chooses. Then, in words: the axis each option explores,
which one you would lead with, and what that one costs.
