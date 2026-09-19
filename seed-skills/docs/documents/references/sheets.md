# Spreadsheets

## Read

```bash
$D read book.xlsx [--sheet Sales] [--rows 20] [--csv sales]
```

A sheet as a short summary, not a dump: its size, which row is the header, each column's type
with its range, sum and mean (numbers) or distinct values (text), its formulas, and the first
rows. A row whose formulas sum the column above it is counted as a total, not as data. `--csv`
writes the one sheet named by `--sheet` as a CSV, ready for a chart or a script of your own.
For a question the summary does not answer, work from that CSV with a script rather than
reading rows by eye.

## Make

```bash
$D xlsx <book.json> [--out q3-budget]
```

```json
{
  "name": "q3-budget",
  "sheets": [
    {
      "name": "Budget",
      "columns": ["Item", "Qty", { "header": "Unit cost", "format": "$#,##0.00" }, { "header": "Cost", "format": "$#,##0.00" }, "Due"],
      "rows": [
        ["Laptops", 4, 1899, "=B{row}*C{row}", "2026-10-01"],
        ["Licences", 12, 29.5, "=B{row}*C{row}", "2026-10-15"]
      ],
      "total": ["Cost"]
    }
  ]
}
```

- A cell starting with `=` is a formula; `{row}` in it is that row's own number. The header is
  row 1, so data starts on row 2.
- `total: true` sums every number column in a last row; a list sums only those columns.
- `format` is Excel's number format: `#,##0`, `0.0%`, `$#,##0.00`, `"₩"#,##0`, `yyyy-mm-dd`.
- A `"YYYY-MM-DD"` string becomes a real date.
- `csv` in place of `rows` takes the rows from a CSV file (its first line is the header).
- The header is styled, frozen and filtered; widths follow the content.

Formulas it can work out (arithmetic, SUM, AVERAGE, MIN, MAX, COUNT, ROUND, ABS on the same
sheet) are stored with their results, so a preview shows numbers; the rest are worked out when
the file opens in Excel, Numbers or Google Sheets. `read` the file after writing it to check.
