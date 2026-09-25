import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const home = await mkdtemp(join(tmpdir(), "thursday-sheet-"));
after(() => rm(home, { recursive: true, force: true }));

const RUNTIME = join(
  import.meta.dirname,
  "..",
  "skills",
  "artifact",
  "runtime",
  "sheet",
);
const SCRIPT = join(
  import.meta.dirname,
  "..",
  "skills",
  "artifact",
  "scripts",
  "spreadsheet.mjs",
);
const { workOut, parse } = await import(join(RUNTIME, "formula.mjs"));
const { formatValue, checkFormat, xlsxFormat } = await import(
  join(RUNTIME, "format.mjs")
);
const { readXlsx, writeXlsx } = await import(join(RUNTIME, "xlsx.mjs"));
const { strFromU8, unzipSync, zipSync, strToU8 } = await import(
  join(RUNTIME, "..", "vendor", "fflate.mjs")
);

const run = (...args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    cwd: home,
    env: {
      ...process.env,
      THURSDAY_ARTIFACTS: join(home, "artifacts"),
      THURSDAY_BOT: "",
    },
  });
const v = (x: unknown) => ({ v: x });
const f = (x: string) => ({ f: x });

test("formulas work out as Excel does: references across sheets, conditions, errors", () => {
  const sheets = [
    {
      name: "Sales",
      cells: [
        [v("who"), v("n"), v("price"), v("amount")],
        [v("A"), v(2), v(100), f("=B2*C2")],
        [v("B"), v(3), v(50), f("B3*C3")],
        [v("A"), v(1), v(10), f("=B4*C4")],
        [v("Total"), f("=SUBTOTAL(109,B2:B4)"), v(null), f("=SUM(D2:D4)")],
      ],
    },
    {
      name: "Sum up",
      cells: [
        [v("who"), v("total"), v("n"), v("avg"), v("x")],
        [
          v("A"),
          f("=SUMIF(Sales!A:A,A2,Sales!D:D)"),
          f('=COUNTIF(Sales!A2:A4,"A")'),
          f("=AVERAGEIF(Sales!A2:A4,A2,Sales!D2:D4)"),
          f('=IF(B2>100,"big","small")&"!"'),
        ],
        [
          v("x"),
          f("=ROUND(10/3,2)"),
          f("=IFERROR(1/0,-1)"),
          f("=1/0"),
          f("=AND(TRUE,2>1,NOT(FALSE))"),
        ],
        [
          v("y"),
          f("='Sum up'!B2*10%"),
          f("=ABS(-4)+MAX(1,5,3)-MIN(4,2)"),
          f("=COUNTA(Sales!A:A)"),
          f('=CONCAT("a",1,TRUE)'),
        ],
        [
          v("z"),
          f('=SUMIF(Sales!B2:B4,">=2",Sales!D2:D4)'),
          f('=COUNTIF(Sales!A2:A4,"<>A")'),
          v(null),
          v(null),
        ],
      ],
    },
  ];
  workOut(sheets);
  const values = (s: number) =>
    sheets[s].cells.map((row) => row.map((cell) => (cell as { v: unknown }).v));
  assert.deepEqual(values(0)[4], ["Total", 6, null, 360]);
  assert.deepEqual(values(1)[1], ["A", 210, 2, 105, "big!"]);
  assert.deepEqual(values(1)[2], ["x", 3.33, -1, { error: "#DIV/0!" }, true]);
  assert.deepEqual(values(1)[3], ["y", 21, 7, 5, "a1TRUE"]);
  assert.deepEqual(values(1)[4].slice(0, 3), ["z", 350, 1]);
  // Row 12 is AB12, not a sheet called A
  assert.equal(parse("=AB12").a.c, 27);
});

test("a formula the sheet cannot work out stops, naming the cell and why", () => {
  const stops = (formula: string) => {
    try {
      workOut([{ name: "s", cells: [[f(formula)]] }]);
    } catch (failed) {
      return (failed as Error).message;
    }
    return "no stop";
  };
  assert.match(
    stops("=VLOOKUP(A1,B:C,2)"),
    /s!A1 .*VLOOKUP is not one this sheet works out/,
  );
  assert.match(stops("=A1+1"), /refers to itself/);
  assert.match(stops("=Nope!B2"), /no sheet "Nope"/);
  assert.match(stops("=(1+2"), /not closed/);
});

test("number formats read as Excel shows them, and one the sheet cannot draw is named", () => {
  assert.equal(formatValue(1234567, "#,##0"), "1,234,567");
  assert.equal(formatValue(1234.5, "#,##0.00"), "1,234.50");
  assert.equal(formatValue(0.3055, "0.0%"), "30.6%");
  assert.equal(formatValue(-1500, '#,##0"원"'), "-1,500원");
  assert.equal(formatValue(9.5, '"$"#,##0.00'), "$9.50");
  assert.equal(formatValue(1 / 3, undefined), "0.3333333333");
  assert.equal(formatValue({ error: "#DIV/0!" }, "#,##0"), "#DIV/0!");
  assert.equal(xlsxFormat("₩#,##0"), '"₩"#,##0');
  assert.match(checkFormat("yyyy-mm") ?? "", /not a number format/);
  assert.equal(checkFormat('#,##0"원"'), null);
});

test("a workbook goes into an .xlsx and comes back: values, formulas, formats, the frozen header and its filter", () => {
  const bytes = writeXlsx({
    sheets: [
      {
        name: "Q3",
        columns: [
          { name: "Item", width: 12 },
          { name: "Qty", width: 8, format: "#,##0" },
          { name: "Share", width: 8, format: "0.0%" },
        ],
        cells: [
          [v("Item"), v("Qty"), v("Share")],
          [v("Paper & <ink>"), v(1200), { f: "=B2/B4", v: 0.8 }],
          [v("Toner"), v(300), { f: "=B3/B4", v: 0.2 }],
          [v("Total"), { f: "=SUBTOTAL(109,B2:B3)", v: 1500 }, v(null)],
        ],
        totals: 3,
      },
    ],
  });
  const files = unzipSync(bytes);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(
    sheet,
    /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/,
  );
  assert.match(sheet, /<autoFilter ref="A1:C3"\/>/);
  assert.match(strFromU8(files["xl/workbook.xml"]), /fullCalcOnLoad="1"/);
  const back = readXlsx(bytes).sheets[0];
  assert.equal(back.name, "Q3");
  assert.deepEqual(back.rows[1][0], { v: "Paper & <ink>" });
  assert.deepEqual(back.rows[1][2], { v: 0.8, f: "=B2/B4" });
  assert.deepEqual(back.rows[3][1], { v: 1500, f: "=SUBTOTAL(109,B2:B3)" });
  assert.equal(back.formats[1], "#,##0");
  assert.equal(back.formats[2], "0.0%");
  assert.equal(back.widths[0], 12);
});

test("another program's .xlsx is read: shared strings, rich text, dates, a sheet named in the rels", () => {
  const files = {
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml":
      '<workbook><sheets><sheet name="Data &amp; more" sheetId="1" r:id="rId7"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships><Relationship Id="rId7" Target="/xl/worksheets/data.xml"/></Relationships>',
    "xl/sharedStrings.xml":
      "<sst><si><t>Name</t></si><si><r><t>Bo</t></r><r><t>ld</t></r></si><si><t>When</t></si></sst>",
    "xl/styles.xml":
      '<styleSheet><numFmts><numFmt numFmtId="170" formatCode="[Red]yyyy\\-mm\\-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="170"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    "xl/worksheets/data.xml":
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" s="1"><v>46204</v></c><c r="C3" s="2"><v>46205</v></c></row></sheetData></worksheet>',
  };
  const bytes = zipSync(
    Object.fromEntries(Object.entries(files).map(([k, t]) => [k, strToU8(t)])),
  );
  const sheet = readXlsx(bytes).sheets[0];
  assert.equal(sheet.name, "Data & more");
  assert.equal(sheet.rows.length, 3);
  assert.equal(
    sheet.rows[0].length,
    3,
    "an empty row does not lose the columns",
  );
  assert.deepEqual(
    sheet.rows[2].map((cell: { v: unknown }) => cell.v),
    ["Bold", "2026-07-01", "2026-07-02"],
  );
});

test("put writes the .xlsx and its page, refuses one changed since, and reads and views it again", async () => {
  const book = join(home, "book.json");
  await writeFile(
    book,
    JSON.stringify({
      title: "Q3 sales",
      sheets: [
        {
          name: "Sales",
          columns: [
            { name: "Client" },
            { name: "Qty", format: "#,##0" },
            { name: "Price", format: "#,##0" },
            { name: "Amount", format: '#,##0"원"', formula: "=B{r}*C{r}" },
          ],
          rows: [
            ["Hanbit", 40, 32000, null],
            ["Gaon", 6, 289000, null],
          ],
          totals: { label: "Total", Qty: "sum", Amount: "sum" },
        },
        {
          name: "By client",
          columns: [
            { name: "Client" },
            {
              name: "Sales",
              format: "#,##0",
              formula: "=SUMIF(Sales!A:A,A{r},Sales!D:D)",
            },
          ],
          rows: [["Hanbit"], ["Gaon"]],
        },
      ],
    }),
  );
  const made = run("put", "q3", book);
  assert.equal(made.status, 0, made.stderr);
  const xlsx = join(home, "artifacts", "q3", "q3.xlsx");
  const page = await readFile(join(home, "artifacts", "q3", "q3.html"), "utf8");
  // The page carries the workbook as data, its values worked out, and links the file beside it
  assert.match(page, /"f":"=B2\*C2"/);
  assert.match(page, /"v":1280000/);
  assert.match(page, /href="q3\.xlsx"/);
  assert.ok(!page.includes("{{"), "every placeholder is filled");
  const back = readXlsx(await readFile(xlsx)).sheets;
  assert.equal(back[1].rows[2][1].v, 1734000);
  assert.deepEqual(back[0].rows[3][3], {
    v: 3014000,
    f: "=SUBTOTAL(109,D2:D3)",
  });

  // Changed after it was written, as Excel would: put stops until told to go over it
  const files = unzipSync(await readFile(xlsx));
  files["docProps/app.xml"] = strToU8("<Properties/>");
  await writeFile(xlsx, zipSync(files));
  const refused = run("put", "q3", book);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /was changed after it was last written/);
  assert.equal(run("put", "q3", book, "--over").status, 0);

  const read = run("read", "q3", "--rows", "2");
  assert.match(
    read.stdout,
    /## Sales — 3 rows under a header, 4 columns \(A–D\)/,
  );
  assert.match(read.stdout, /Hanbit\t40\t32000\t1280000/);
  assert.match(read.stdout, /Formulas \(4\): D2 =B2\*C2/);
  assert.equal(run("view", "q3").status, 0);
});

test("a CSV becomes one sheet, grouped numbers read as numbers; an old .xls is refused", async () => {
  const csv = join(home, "d.csv");
  await writeFile(csv, 'Item,Qty\nPaper,"1,200"\n"Toner, black",12\n');
  assert.equal(run("put", "d", csv).status, 0);
  const sheet = readXlsx(await readFile(join(home, "artifacts", "d", "d.xlsx")))
    .sheets[0];
  assert.deepEqual(
    sheet.rows.map((row: { v: unknown }[]) => row.map((cell) => cell.v)),
    [
      ["Item", "Qty"],
      ["Paper", 1200],
      ["Toner, black", 12],
    ],
  );
  await writeFile(join(home, "old.xls"), "x");
  assert.match(run("read", join(home, "old.xls")).stderr, /old format/);
});

test("a description the sheet cannot write stops, saying what to change", async () => {
  const bad = join(home, "bad.json");
  const stops = async (spec: unknown) => {
    await writeFile(bad, JSON.stringify(spec));
    const out = run("put", "bad", bad);
    assert.equal(out.status, 1);
    return out.stderr;
  };
  const one = (sheet: object) => ({
    sheets: [{ name: "a", columns: [{ name: "x" }], rows: [], ...sheet }],
  });
  assert.match(await stops(one({ name: "a/b" })), /not one Excel takes/);
  assert.match(
    await stops(one({ columns: [{ name: "x", format: "yyyy" }] })),
    /not a number format/,
  );
  assert.match(
    await stops(one({ columns: [{ name: "x", formula: "=1" }], rows: [[5]] })),
    /worked out by its formula/,
  );
  assert.match(await stops(one({ totals: { y: "sum" } })), /not a column/);
  assert.match(
    await stops(
      one({
        columns: [{ name: "x", formula: "=VLOOKUP(A{r},B:C,2)" }],
        rows: [[null]],
      }),
    ),
    /VLOOKUP is not one/,
  );
  assert.match(await stops({ sheets: [] }), /needs "sheets"/);
});
