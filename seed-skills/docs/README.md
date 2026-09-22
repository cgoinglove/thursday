# Docs' kit

One skill the Docs seed is born with, copied into `.agents/skills/` in its own folder when it is
created. It is listed to that bot alone.

| Skill | What it adds |
|---|---|
| `documents` | `doc.mjs`, one script for office files: print-ready PDFs from HTML templates, invoices and quotes with their sums worked out, PowerPoint decks from a JSON outline, Word files from Markdown, Excel workbooks with formulas; reading PDF, Word, PowerPoint and Excel files; filling, stamping, merging and splitting PDFs; translating or rewording a file in place |

Written for this app. The browser the app already runs is the typesetter: HTML is printed to
PDF, and a deck or a Word file gets a PDF twin drawn from the same layout, because the app shows
PDFs and not Office files. PDF pages are drawn to pictures by pdf.js in Node, so a one-page PDF
is looked at without a browser; several pages are put on one sheet by the browser skill, which
opens a headless one when the job has none.

The libraries are installed on first use into the workspace's `projects/.docs-kit`, pinned by
`kit/package-lock.json` (about 150 MB, ten seconds; nothing is added to the app itself):

| Library | Licence | Used for |
|---|---|---|
| [pdf-lib](https://github.com/Hopding/pdf-lib) | MIT | forms, merging, splitting, stamping |
| [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) with `@napi-rs/canvas` | Apache-2.0, MIT | reading PDF text and drawing pages |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | MIT | writing .pptx |
| [docx](https://github.com/dolanmiu/docx) | MIT | writing .docx |
| [mammoth](https://github.com/mwilliamson/mammoth.js) | BSD-2-Clause | reading .docx |
| [ExcelJS](https://github.com/exceljs/exceljs) | MIT | reading and writing .xlsx |
| [marked](https://github.com/markedjs/marked) | MIT | Markdown for .docx |
| [JSZip](https://github.com/Stuk/jszip), [xmldom](https://github.com/xmldom/xmldom) | MIT | editing Office files in place |
| [Inter](https://github.com/rsms/inter) (`@fontsource-variable/inter`) | OFL-1.1 | the type printed PDFs are set in |

No text or code is taken from other document skills. Anthropic's docx, pdf, pptx and xlsx
skills are not open source, and openai/skills' `pdf` (Apache-2.0) relies on Poppler and Python
packages a stock machine lacks; this kit needs Node and the app's browser only.
