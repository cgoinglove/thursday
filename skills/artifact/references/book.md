# A picture book

Anything explained the way a children's picture book explains it: each page is
one picture with at most two short lines under it, in simple words. One HTML
file is the book, and the same file is printed to a PDF or read aloud into a
video, so the three never disagree. The book's own file holds its style and page
turning: add pages inside `<main>` and never rewrite the file whole.

## Contents
- The two rules
- Steps
- Pictures
- A PDF
- A video that reads itself

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

1. `node <skill dir>/scripts/book.mjs new <name>` makes `<name>/` in your folder
   under `artifacts/` and writes `<name>.html` in it, with the style and page
   turning inlined (light and dark, phone, print), and prints its path. That
   folder is the book: its pictures, its PDF, its mp4 and the voices it was read
   with all belong there, and the user sees one book rather than twenty files.
2. Write the whole story before any picture: one row per page, its picture, its
   line or two, and `data-say`, the sentence read over it in a video — a little
   fuller than the lines, spoken the way a person would read the page aloud.
3. Make the pictures (below), then write each page as the comment in the file
   shows: `<section class="page" data-say="…">`, a `<figure>`, one or two `<p>`.
   The cover is `<section class="page cover">` with an `<h1>`. Set `lang` to the
   book's language. Add the pages inside `<main>` and leave the rest of the file
   alone: its head already carries the style and the page turning, and rewriting
   the file whole loses them.
4. Look at it once when a page carries a picture you did not draw — a photo you
   downloaded, a generated one — or when a page may not fit. A book drawn in SVG
   alone needs no browser at all; hand it back and skip to 5. To look:

   ```bash
   node <skill dir>/scripts/book.mjs shots <name>
   ```

   That is every page, numbered, on one picture for a single `look_at`, drawn in
   a headless browser of its own, never in this job's. Fix what it shows, then
   stop.
5. Hand back the path. The user turns pages with a swipe, the arrow keys or a
   tap on the right or left of a page, and `#3` in the address opens page 3.

## Pictures

Choose each page's picture in this order:

- **A real thing whose look matters** — a place, an animal, a machine, a
  person's work — is a real photo from the web. Take it from the page you read,
  or from Wikimedia Commons, whose files allow reuse with credit:

  ```bash
  node "$THURSDAY_SKILLS/browser/scripts/webimage.mjs" <page url> --out <the book's folder> [--all]
  ```

  It saves the page's own picture (`--all` adds the large ones in its body)
  through the session's browser, so a site that refuses `curl` still answers,
  keeps only what came back as an image, and prints each file with its size and
  a `Credit:` line. Every run writes `web-01.…`, so rename what you keep to the
  page's own name before fetching the next one. Put the credit in the figure:
  `<figcaption>Photo: <author>, <a href="…">source</a>, <license></figcaption>`.
- **A structure, a flow, a relation** — parts of a whole, one thing asking
  another, a before and after — is an inline `<svg viewBox="0 0 800 400">`
  drawn by hand. Fill it with `var(--ink)`, `var(--paper)`, `var(--blue)`,
  `var(--sky)`, `var(--yellow)`, `var(--green)`, `var(--red)` and
  `var(--purple)`, which follow light and dark; `var(--soft)` and
  `var(--muted)` are there too. Keep text in it at 24 units or more, and a few
  flat shapes with thick outlines rather than detail. For a vertical video draw
  it tall (`viewBox="0 0 600 800"`).
- **A number that is the point** — how much, how many, how it changed — is a
  chart, not a sentence: put a `<figure id="p4-chart">` on that page and draw
  into it with `node "$THURSDAY_SKILLS/artifact/scripts/chart.mjs" <book
  path> <that id> <data.csv>`, from a CSV whose `# source:` line names where the
  numbers came from. One chart in a book is plenty; keep the lines under it to
  what it shows.
- **A metaphor scene** — a feeling, an imagined place, a thing too small or too
  big to photograph — is a generated image: `generate_image` on the `studio`
  server through `tool_call`, `aspectRatio` `16:9` (`9:16` for a vertical
  video). It lands at the top of your artifacts folder; move it into the book's
  folder, and `<img>` takes its file name. The image model sees nothing of this
  job: write the whole picture in the prompt, and end every prompt with the same
  style sentence (medium, palette, light) or the pages come back in different
  hands. Never ask for text in a generated image — it comes back misspelled;
  words go in the lines, or labels in an SVG. With no image model, the first two
  kinds still make a book; use them.

## A PDF

```bash
node <skill dir>/scripts/book.mjs pdf <name>
```

Writes `<name>.pdf` beside the book, every page on its own sheet with the words
under the picture. It serves the book's folder on a port of its own and prints
through the job's browser, so the pictures beside the book come out with it; a
picture that did not load is named at the end, and the PDF has its gap until you
fix it and run this again.

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
3. **One command makes the mp4.**

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
   pages, or a picture that did not load, stops it with what to fix. When it is
   made, the voices move into `voices/` in the book's folder, numbered by page
   (`page-01.mp3`), and it prints where they went.
4. Hand back the mp4's path and how long it runs, with the book's path beside
   it.

To change a page later, edit the book, make that page's voice again if its
`data-say` changed, and run the same command with every page's voice again —
the ones in `voices/` for the pages that did not change, the new file in its
page's place.
