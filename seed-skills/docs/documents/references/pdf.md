# PDFs: read, fill, sign, merge, split

## Read and look

```bash
$D read file.pdf [--pages 1-3] [--layout]   # the text, page by page; --layout: each line with x, y, width, size
$D look file.pdf [--pages 2] [--grid]       # pictures of the pages to look_at; --grid: a line every 50 pt
```

A page with no text is a scan: look at it and read it off the picture. Positions are in points
(1/72 inch) from the top left of the page — the same numbers `stamp` takes.

## Merge, pick, turn, split

```bash
$D pages a.pdf b.pdf:2-5 c.pdf:1@90 --out combined   # in this order; @90 turns those pages
$D split big.pdf --every 1 --out page                 # page-1.pdf, page-2.pdf …
$D split big.pdf --at 4,9 --out part                  # part-1-3.pdf, part-4-8.pdf, part-9-12.pdf
```

To reorder, list the same file's ranges in the new order (`a.pdf:3 a.pdf:1-2`). To remove
pages, list the ones to keep.

## A form with fields

```bash
$D fields form.pdf                               # one field a line: name, kind, box, label, value, options
$D fill form.pdf values.json --out form-filled   # values.json: { "<field name>": value, … }
```

A text field takes a string, a checkbox `true`/`false`, a radio or a dropdown one of its
`options`. A field's `label` is what the form prints nearest it; it is a guess, so match names
to the page with `look` when the names say nothing (`f1_01`). Text the form's own font cannot
draw (Korean, Japanese, Chinese, Arabic…) is printed onto the page where the field was.
`--flatten` makes the answers part of the page, so nobody can change them.

## A form without fields, a signature

A flat form, a scan, a contract to sign: print the answers onto the page.

```bash
$D read form.pdf --layout --pages 1    # where each label sits
$D stamp form.pdf marks.json --out form-filled
```

```json
[
  { "page": 1, "x": 130, "y": 574, "text": "Jordan Park", "size": 11 },
  { "page": 1, "x": 73, "y": 180, "check": true, "size": 10 },
  { "page": 2, "x": 120, "y": 560, "image": "signature.png", "w": 120, "h": 36 },
  { "page": 1, "x": 300, "y": 90, "w": 160, "h": 14, "erase": true }
]
```

`x`/`y` is the top left of the text, a few points right of the label's end or on the line
under it. Also: `w` and `h` (a box to fit or wrap in), `color`, `bold`, `serif`, `align`.
`erase` paints over what is there (white, or `background`). A signature image is one the user
gave you; never draw or invent one. Always `look` at the result: a line 5 pt off reads as
careless.
