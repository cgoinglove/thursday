---
name: picture-book
description: "Explain anything as a picture book: one picture and at most two short lines a page, in one HTML file that is also its PDF and, read aloud, its mp4."
---

# A picture book

```bash
node <skill dir>/scripts/book.mjs new <name>                         # the book, in your artifacts folder
node <skill dir>/scripts/book.mjs video <name> <audio>... [--size WxH]  # it read aloud, one audio file per page
```

Two things decide whether it works: **one idea a page, and the picture carries it** — cover
the words and the page still says it — and **a technical word comes after its picture**. Read
`references/picture-book.md` before the first page: how a page is written, where each picture
comes from, the PDF, and the voice.
