---
name: documents
description: "Real office files, made and read: PDF, Word, PowerPoint, Excel. Use when a file is the result — a PDF laid out for print, an invoice with its sums worked out, a .pptx from an outline or from a deck the slides skill wrote, a .docx or .xlsx, a form to fill or sign, pages to merge, split or turn, or a file translated with its layout kept. A deck to show on a screen or a page to read is not a file: that is the slides or the page skill's."
---

# Documents

Every command is one script, and it prints what it made, what went wrong, and a picture to look at:

```bash
D="node <this skill's folder>/scripts/doc.mjs"
$D            # every command, one line each
```

The first run installs its libraries into `projects/.docs-kit` (about 10 seconds). A bare name
after `--out` lands in your folder under `artifacts/`.

**An Office file stands on the app's shelf, but nothing draws it there.** A row opens it in
Word, Excel or PowerPoint instead, so a deck or a Word file is made with a PDF twin beside it,
drawn from the same layout, and that twin is what anyone can look at without leaving the app;
hand back both paths. Every command that makes a page leaves
pictures of it: look at the overview it names (the `look_at` tool, when you hold it) before you
hand anything back, and fix what you see — text too small, a page with one line on it, a wrong
number.

Read only the reference for the job in front of you:

| The job | Read |
|---|---|
| A letter, report, resume, one-pager, certificate — anything printed | `references/print.md` |
| An invoice, a quote, a receipt | `references/invoice.md` |
| A slide deck (.pptx) from an outline | `references/deck.md` |
| A .pptx of a deck already written as slides (the `slides` skill's file) | none: `$D deck-from <deck.html>` measures every slide in a browser and writes each box where it was |
| A Word file (.docx), made or read | `references/word.md` |
| A spreadsheet (.xlsx, .csv), made or read | `references/sheets.md` |
| A PDF to read, fill, sign, merge, split or turn | `references/pdf.md` |
| A file translated, or its wording changed, with its layout kept | `references/translate.md` |
