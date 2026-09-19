# A file translated, or reworded, in place

Take the words out, change them, put them back: styles, tables, pictures, headers and page
layout stay exactly as they were. Works on .docx, .pptx, .xlsx and .pdf.

```bash
$D segments file.docx --out file-segments      # every paragraph, numbered, in a JSON file
# … write file-ko.json: { "1": "…", "2": "…" } …
$D apply file.docx file-ko.json --lang ko       # file-ko.docx in your artifacts folder
```

- Each segment is one paragraph (a cell's text in Excel, a block of lines in a PDF). A line said
  twice in the file is one segment.
- `<1>…</1>` marks words in another style — bold, a link, a colour. Keep each tag around the
  words that mean the same in the translation; a lost tag leaves those words plain. Keep `\n`
  line breaks where they are.
- A long file: translate in several JSON files, each with some of the ids, and pass them all to
  `apply`. A segment with no translation keeps its original words.
- To change only some wording — a date, a name, a clause — put just those ids in the JSON.
- Numbers, names, codes and anything the reader must copy stay as they are.

What `apply` says:

- **Much longer than the original** (PowerPoint): the slide's text box may overflow. Say those
  shorter; the boxes are also set to shrink text that grew, where the reader supports it.
- **Shrunk to fit its place** (PDF): the translation is printed into the space the original
  had, and shrank to fit. Say it shorter.
- Charts, pictures of text and Excel sheet names keep their original words.

## A PDF

A PDF has no paragraphs to edit. Each block of lines is covered by a patch in the colour around
it and the translation is printed there, in a matching colour and weight, wrapping inside the
block and taking the empty page beside it when it needs more room. `look_at` every page after
`apply`. A scan has no text to take out: read it off the picture and make a new document.
When the layout matters less than the text, a translated Word file (`word.md`) reads better
than a patched PDF.
