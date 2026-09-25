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
        { "name": "Date", "format": "yyyy-mm-dd" },
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
  text is text, an empty cell `null`. A date is written `"2026-07-02"` (`"2026-07-02 14:30"` with
  a time) in a column whose `format` is a date's; there it is a date in Excel too — it sorts,
  filters by month and works with `DATE`, `YEAR`, `MONTH`, `EOMONTH` and `SUMIFS` by range. In a
  column without one it stays text.
- **A column worked out from others has a `formula`**, `{r}` standing for the row's own number;
  its cells in `rows` are `null`. One cell of its own is `{ "f": "=…" }`. Formulas are Excel's,
  and the file keeps them, so Excel works them out again when the user changes a number. What is
  worked out here for the page: `+ - * / ^ & %`, comparisons, `SUM AVERAGE MIN MAX COUNT COUNTA
  SUBTOTAL SUMIF COUNTIF AVERAGEIF SUMIFS COUNTIFS AVERAGEIFS ROUND ABS IF IFERROR AND OR NOT
  CONCAT DATE YEAR MONTH DAY EOMONTH TODAY`, and another sheet's
  cells as `Sheet!B2` (`'Two words'!B:B`). Anything else stops: work the value out yourself and
  write it.
- **A summary of rows in the same workbook is a formula over them** — `SUMIF`, `COUNTIF`,
  `AVERAGEIF` on the other sheet, as in "By client" above; by month, a first-of-month date in a
  `yyyy-mm` column and `=SUMIFS(Sales!E:E,Sales!A:A,">="&A{r},Sales!A:A,"<="&EOMONTH(A{r},0))` —
  so it follows when a row changes; a number you worked out and typed in does not.
- **`totals`** adds a last row, bold, the first column holding `label`: `sum`, `average`,
  `count`, `min` or `max` for the columns named. It counts only the rows a filter shows, in
  Excel and in the page alike.
- **`format`** is how a column's numbers read, as an Excel code: `#,##0`, `#,##0.00`, `0`,
  `0.0%` (a share: `0.25` reads `25.0%`), and a sign or a word before or after in quotes —
  `"$"#,##0.00`, `#,##0"원"`, `"€"#,##0`. A second part after `;` is for negatives and a third for
  zero, in `[Red]` if it helps: `#,##0;[Red]-#,##0`, `#,##0;(#,##0);"-"`. Dates: `yyyy-mm-dd`,
  `yyyy-mm`, `d mmm yyyy`, `yyyy"년" m"월" d"일"`, `yyyy-mm-dd hh:mm`. The currency and the way a
  date reads are the user's, from what they said or what they wrote; never assume one.
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
- **Changing a sheet**: `read <name> --json <scratch>/<name>.json` writes the workbook as it is now
  — the user's changes in Excel or with **Edit** in the app, formats, formulas, totals — in the
  form above. Change that file and `put <name> <it> --over`. Writing it again from what you wrote
  before undoes their changes, which is why a `put` without `--over` stops once they changed it.
  After they changed it in Excel, `view <name>` draws the page again from the file as it is.
