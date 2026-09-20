# A picture book

Anything explained the way a children's picture book explains it: each page is
one picture with at most two short lines under it, in simple words. One HTML
file is the book, and the same file is printed to a PDF or read aloud into a
video, so the three never disagree.

## The two rules

- **One idea a page, and the picture carries it.** Cover the words and the page
  still says it. More to say is another page, never a third line or a longer
  one.
- **A technical word comes after its picture.** A page first shows the thing
  (the rows of machines), and only then names it (`server`). Wrap the new word
  in `<mark>` on the page that names it. A word no picture has shown yet does
  not appear.

Write for someone who knows nothing about the topic: short words, one clause a
line, no jargon to explain jargon. Most topics fit in six to ten pages; the
first is the cover, asking the question the book answers.

## Steps

1. `node <skill dir>/scripts/book.mjs new <name>` writes `<name>.html` in your
   folder under `artifacts/` with the style and page turning inlined (light and
   dark, phone, print), and prints its path.
2. Write the whole story before any picture: one row per page, its picture, its
   line or two, and `data-say`, the sentence read over it in a video — a little
   fuller than the lines, spoken the way a person would read the page aloud.
3. Make the pictures (below), then write each page as the comment in the file
   shows: `<section class="page" data-say="…">`, a `<figure>`, one or two `<p>`.
   The cover is `<section class="page cover">` with an `<h1>`. Set `lang` to the
   book's language. Add the pages inside `<main>` and leave the rest of the file
   alone: its head already carries the style and the page turning, and rewriting
   the file whole loses them.
4. Look at it once, as the reader will, in one bash call:

   ```bash
   node "$THURSDAY_SKILLS/browser/scripts/render.mjs" <book path> --size 960x540 --out <scratch>/pages && \
   node "$THURSDAY_SKILLS/browser/scripts/sheet.mjs" --out <scratch>/book.png --cols 4 <scratch>/pages/*.png
   ```

   That is every page as one picture for a single `look_at`. A browser must be
   open (`playwright-cli open` when none is). Fix what it shows, then stop.
5. Hand back the path. The user turns pages with a swipe, the arrow keys or a
   tap on the right or left of a page, and `#3` in the address opens page 3.

## Pictures

Choose each page's picture in this order:

- **A real thing whose look matters** — a place, an animal, a machine, a
  person's work — is a real photo from the web. Take it from the page you read
  (the browser skill's "Pictures for a document"), or from Wikimedia Commons,
  whose files allow reuse with credit. `curl -L -o <artifacts folder>/<file>.jpg`
  and check it with `file`: a refused download arrives as an HTML error page
  saved under the image's name. Name where it came from in the figure:
  `<figcaption>Photo: <author>, <a href="…">source</a>, <license></figcaption>`.
- **A structure, a flow, a relation** — parts of a whole, one thing asking
  another, a before and after — is an inline `<svg viewBox="0 0 800 400">`
  drawn by hand. Fill it with `var(--ink)`, `var(--paper)`, `var(--blue)`,
  `var(--sky)`, `var(--yellow)`, `var(--green)`, `var(--red)` and
  `var(--purple)`, which follow light and dark; `var(--soft)` and
  `var(--muted)` are there too. Keep text in it at 24 units or more, and a few
  flat shapes with thick outlines rather than detail. For a vertical video draw
  it tall (`viewBox="0 0 600 800"`).
- **A metaphor scene** — a feeling, an imagined place, a thing too small or too
  big to photograph — is a generated image: `generate_image` on the `studio`
  server through `tool_call`, `aspectRatio` `16:9` (`9:16` for a vertical
  video). It lands in your artifacts folder beside the book, so `<img>` takes
  its file name. The image model sees nothing of this job: write the whole
  picture in the prompt, and end every prompt with the same style sentence
  (medium, palette, light) or the pages come back in different hands. Never ask
  for text in a generated image — it comes back misspelled; words go in the
  lines, or labels in an SVG. With no image model, the first two kinds still
  make a book; use them.

## A PDF

The browser skill prints it: serve the folder, `goto` the book, and
`pdf --filename=<artifacts folder>/<name>.pdf`. Every page lands on its own
sheet, the words under the picture.

## A video that reads itself

1. **Check the voice before anything.** `tool_search` with `server: "studio"`
   and `tools: ["generate_speech"]` (and `generate_image` when a page needs a
   drawn picture). A name that does not come back means nobody picked that
   model, and a call answering that the model cannot make audio means the wrong
   one is picked. Either way send Thursday a `send_message` question saying to
   pick a speech (or image) model in Settings › Models, and end your turn.
   Never work around it with another voice.
2. **One `generate_speech` call per page**, in page order, `text` set to that
   page's `data-say`, the same `voice` every time. Keep the paths it returns in
   order.
3. **One command makes the mp4.** With a browser open in your session
   (`playwright-cli open` when none is):

   ```bash
   node <skill dir>/scripts/book.mjs video <name> <audio 1> <audio 2> … <audio N>
   ```

   It screenshots every page at 1920x1080 (`--size 1080x1920` for a vertical
   video, which keeps the words above a phone player's buttons), reads each
   voice's length off its file and holds that page for exactly that long plus
   a short pause, and writes `<name>.mp4` beside the book: h264 and yuv420p,
   which every phone plays. It installs a portable ffmpeg into `projects/` the
   first time when the machine has none. Frames are drawn by the browser, not
   by ffmpeg, so every language's words come out right. Fewer audio files than
   pages, or a picture that did not load, stops it with what to fix.
4. Hand back the mp4's path and how long it runs, with the book's path beside
   it.

To change a page later, edit the book, make that page's voice again if its
`data-say` changed, and run the same command with the new path in its place.
