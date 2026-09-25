# A sheet

Numbers people keep working on — a ledger, a list of clients, a budget, results by month — are a
sheet: a real `.xlsx` that opens in Excel, Numbers and Google Sheets, and a page beside it that
shows it in the app, with its tabs, sorting and filters on each column, and the sum of the cells
picked. `S=<skill dir>/scripts`

```bash
node $S/spreadsheet.mjs put <name> <scratch>/<name>.json   # or a .csv, one sheet
node $S/spreadsheet.mjs shots <name>                        # look at it once
```

Both land in `artifacts/<name>/`: hand back the page and the `.xlsx`.

## The workbook, written

```json
{
  "title": "Q3 sales",
  "sheets": [
    {
      "name": "Sales",
      "columns": [
        { "name": "Date" },
        { "name": "Client" },
        { "name": "Qty", "format": "#,##0" },
        { "name": "Price", "format": "\"$\"#,##0.00" },
        { "name": "Amount", "format": "\"$\"#,##0.00", "formula": "=C{r}*D{r}" }
      ],
      "rows": [
        ["2026-07-02", "Hanbit", 40, 32.5, null],
        ["2026-07-03", "Gaon", 12, 58, null]
      ],
      "totals": { "label": "Total", "Qty": "sum", "Amount": "sum" }
    },
    {
      "name": "By client",
      "columns": [
        { "name": "Client" },
        { "name": "Sales", "format": "\"$\"#,##0", "formula": "=SUMIF(Sales!B:B,A{r},Sales!E:E)" }
      ],
      "rows": [["Hanbit"], ["Gaon"]]
    }
  ]
}
```

- **A row is a list of cells, one a column.** A number is a number (`32000`, never `"32,000"`),
  text is text, an empty cell `null`. Dates are text as `YYYY-MM-DD`, which sorts right.
- **A column worked out from others has a `formula`**, `{r}` standing for the row's own number;
  its cells in `rows` are `null`. One cell of its own is `{ "f": "=…" }`. Formulas are Excel's,
  and the file keeps them, so Excel works them out again when the user changes a number. What is
  worked out here for the page: `+ - * / ^ & %`, comparisons, `SUM AVERAGE MIN MAX COUNT COUNTA
  SUBTOTAL SUMIF COUNTIF AVERAGEIF ROUND ABS IF IFERROR AND OR NOT CONCAT`, and another sheet's
  cells as `Sheet!B2` (`'Two words'!B:B`). Anything else stops: work the value out yourself and
  write it.
- **`totals`** adds a last row, bold, the first column holding `label`: `sum`, `average`,
  `count`, `min` or `max` for the columns named. It counts only the rows a filter shows, in
  Excel and in the page alike.
- **`format`** is how a column's numbers read, as an Excel code: `#,##0`, `#,##0.00`, `0`,
  `0.0%` (a share: `0.25` reads `25.0%`), and a sign or a word before or after in quotes —
  `"$"#,##0.00`, `#,##0"원"`, `"€"#,##0`. The currency is the user's, from what they said or what
  the numbers are in; never assume one.
- **A sheet's `name`** is at most 31 characters, none of `[ ] : * ? / \`. Header row 1 is frozen
  with a filter on it; widths fit the text unless a column gives `width` in characters.
- **Nothing invented**: a figure you do not have is an empty cell, and a note in your answer says
  which.

## Their own .xlsx, and changes

- **What a workbook holds**: `read <name | file.xlsx>` prints each sheet's size, first rows and
  formulas; `--rows 50` shows more, `--csv <folder>` writes every sheet as a CSV to work on or to
  chart (`chart.mjs`). A file the user gave you is read the same way; an `.xls` has to be saved
  as `.xlsx` first.
- **Showing theirs in the app**: `view <file.xlsx> [--name <name>]` copies it into your folder
  with a page beside it.
- **Changing a sheet** is `put` again with the whole workbook. When the `.xlsx` was changed since
  you wrote it — they worked on it in Excel — `put` stops: `read` it, make your change from what
  it holds now, and `put --over`. After they changed it, `view <name>` draws the page again from
  the file as it is.
- The page sorts and filters as a view and never changes the file; the user edits in Excel or
  asks you.
