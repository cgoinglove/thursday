# A Word file

## Made from Markdown

```bash
$D docx <text.md> [--out contract-draft]
```

Writes the .docx with real Word styles — Title, Heading 1–3, lists, tables — so Word's
navigation pane and table of contents work in it, and a PDF twin printed from the same text.
Page numbers are in the footer.

Front matter at the top sets the rest:

```markdown
---
title: Service Agreement
subtitle: Between Northwind Studio and Acme Robotics
author: Northwind Studio
date: 20 September 2026
paper: A4            # or letter
header: Confidential # a line at the top of every page
font: Arial          # one every machine has
accent: "#1F4E79"
---
```

Everything Markdown has comes through: `#`–`####` headings, **bold**, _italic_, `code`,
links, nested lists (numbered or not), `- [ ]` tick lists, tables with their alignment,
quotes, code blocks, pictures (`![caption](picture.png)`, a path from the .md file's folder),
and `---` as a rule. A line holding only `<!-- pagebreak -->` starts a new page.

A resume as .docx: `title` is the name, `subtitle` the role, `author` the contact line; then
`## Experience` with a `###` per job (title — company (years)) and three or four bullets under
each. Keep it to one page: the PDF twin says how many pages it came to.

## Read

```bash
$D read file.docx
```

Gives the text as Markdown: headings, lists, **bold**, tables as rows. To change the wording of
a Word file someone gave you and keep everything else, see `translate.md`: the same two
commands edit it in place.
