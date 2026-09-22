---
name: picture-book
description: "Explains anything as a picture book: one picture and at most two short lines a page. Use when something has to be understood rather than listed — as a page to swipe through, a PDF, or a video that reads itself aloud."
---

# A picture book

```bash
node <skill dir>/scripts/book.mjs new <name>                            # the book, in a folder of its own under artifacts
node <skill dir>/scripts/book.mjs pdf <name>                            # the same book as a PDF, one page a sheet
node <skill dir>/scripts/book.mjs video <name> <audio>... [--size WxH]  # it read aloud, one audio file per page
node "$THURSDAY_SKILLS/browser/scripts/render.mjs" <book> --size 960x540 --out <dir>   # every page as a picture, to look at
```

The book's own file holds its style and page turning: add pages inside `<main>`
and never rewrite the file whole. Everything the book is made of — its pictures,
its PDF, its mp4, the voices it was read with — belongs in the folder around it,
which is what the user sees as one book. A book that draws its own pictures in
SVG is handed back as it is; a downloaded or generated picture, a PDF or a video
goes through the job's browser.

Two things decide whether it works: **one idea a page, and the picture carries it** — cover
the words and the page still says it — and **a technical word comes after its picture**. Read
`references/picture-book.md` before the first page: how a page is written, where each picture
comes from, the PDF, and the voice.
