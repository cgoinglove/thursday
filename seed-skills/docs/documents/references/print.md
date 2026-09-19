# A document made to print

A letter, a report, a resume, a one-pager, a certificate, a menu: written as one HTML page with
print styles, then printed to PDF by the browser. The browser sets any language well, and the
HTML stays beside the PDF for the next change.

```bash
$D new letter offer-letter        # or: report, resume — a styled page in your artifacts folder
# … write the page …
$D pdf artifacts/<you>/offer-letter.html
```

`new` writes a complete page with its stylesheet inlined and sample lines to replace; a comment
at the top names the few classes it has. Keep its `<head>` as it is and write the body. For
anything the three do not fit, start from `report` and replace its body.

## Writing the page

- `<html lang>` is the document's language: `ko` keeps Korean words whole at line ends, `ja`
  and `zh` pick the right glyphs.
- Paper is A4. For a reader in the US or Canada, change `size: A4` to `size: letter` in `@page`.
- Page numbers print at the bottom right from the second page. A letter or one-pager has one page.
- The page is 17 cm wide inside its margins. Two columns: `<div class="cols">`. Side by side,
  pushed apart: `<div class="row">`.
- `class="keep"` keeps a block on one page; `class="break"` starts a new page. Tables repeat
  their header row on every page.
- Numbers in a table: `<td class="num">`, so they line up on the right.
- Pictures sit beside the HTML file and load by a relative path (`<img src="logo.png">`), never
  from the network. A logo: about 40 pt high.
- The accent colour is `--accent` in `:root`; one colour, used for headings and a rule or two.

## After `pdf`

It prints the page count and the lines worth acting on:

- **The last page holds only N characters**: tighten the page before it or cut a line, so the
  document does not end on a nearly empty page.
- **Wider than the page**: a table or a long word sticks out and is cut in print; let it wrap or
  make it narrower.
- **Pictures that did not load**: a wrong path.

Then `look_at` the picture it names. A resume or a letter that runs one line onto a second page
is fixed by tightening, not by shrinking everything: cut a line, drop an empty paragraph.
