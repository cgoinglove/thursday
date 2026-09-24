---
name: artifact
description: "Makes what the user keeps and looks at: a document, a canvas, a picture book, a deck. Use it for a report or memo, options or a mockup at real size, an explanation in pictures, or slides; a tool they use is interactive-page."
license: Complete terms in LICENSE.txt
---

# Artifact

What the user keeps and looks at, drawn by the app from what you write. You write the content;
the app does the rest — the layout, the type, light and dark, a head that names it with Edit and
Export, and the pictures. Every kind is one file in your folder under `artifacts/` that opens with
no network, and its path is what you hand back. `S=<skill dir>/scripts`

| They will | Kind | Start | Read first |
|---|---|---|---|
| read it — a report, a memo, options compared, a plan, notes of a meeting, research with its photos | document | write Markdown, then `node $S/document.mjs put <name> <file.md>` | `references/document.md` |
| choose between ways something could look, or see it at its real size — an app or phone screen, a landing page, a poster, a post | canvas | `node $S/canvas.mjs new <name>` | `references/canvas.md`, then `references/craft.md` |
| understand one thing simply — a picture and a line or two a page, to swipe, as a PDF or read aloud | picture book | `node $S/book.mjs new <name>` | `references/book.md` |
| watch it presented | deck | the `make_deck` tool | `references/deck.md` |

A page they use rather than read — a calculator, a tracker, a small app — is `interactive-page`.
A few paragraphs that answer a question stay your final text; a kind here is for what they will
keep, share or come back to.

## For every kind

- **Write the content, never the file around it.** Each script makes its file and puts what you
  wrote into it; a file you write whole yourself loses its head, its editing and its check.
- **A name is yours, a path is anyone's.** A name reaches only your own folder; a document, canvas
  or book another bot handed you is reached by its path.
- **Change what exists by getting it first.** The user may have edited it in the app since you
  made it. `get` it into a file, change that, `put` it back: `put` refuses to undo their edits.
- **Nothing invented.** A figure, a price, a quote or a date you were not given is a visible blank,
  `[PRICE]`, for them to fill — never a plausible one.
- **Pictures come off the pages you read.** `node $THURSDAY_SKILLS/browser/scripts/webimage.mjs
  <page url> --out <the folder beside the file>` saves a page's own picture with its credit line.
- **Look once where the look is the work.** A canvas and a picture book come back as one picture
  of every board or page (`shots`, then `look_at`): fix what it refuses or marks as cut, two
  rounds at most. A document and a deck are drawn by the app from what you wrote, so they go
  back without a second look.
- **Hand back** the file's path — a canvas or a book with its pictures' paths — and say in a line
  or two what it holds and what you would do next with it.
