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
const { workOut, parse, moveRefs, fillDown, referencesIn } = await import(
  join(RUNTIME, "formula.mjs")
);
const { formatValue, formatColor, checkFormat, xlsxFormat, valueOf, serialOf } =
  await import(join(RUNTIME, "format.mjs"));
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

test("a formula moves as rows or columns go in or out, and fills down as Excel copies it", () => {
  const on = "Sales";
  const move = (formula: string, axis: string, at: number, count: number) =>
    moveRefs(formula, { on, target: "Sales", axis, at, count });
  // A row put in before row 3: what is past it moves, a range across it grows
  assert.equal(move("=C3*D3", "r", 2, 1), "=C4*D4");
  assert.equal(move("=C2*$D$2", "r", 2, 1), "=C2*$D$2");
  assert.equal(move("=SUM(C2:C9)", "r", 4, 2), "=SUM(C2:C11)");
  // Rows 4 and 5 taken out: a cell in them is gone, a range across them shrinks
  assert.equal(move("=SUM(C2:C9)", "r", 3, -2), "=SUM(C2:C7)");
  assert.equal(move("=C4+C8", "r", 3, -2), "=#REF!+C6");
  assert.equal(move("=SUM(C4:C5)", "r", 3, -2), "=SUM(#REF!)");
  // A column put in before C: whole columns move, text in quotes and other sheets stay
  assert.equal(
    move('=SUMIF(Sales!B:B,A2,Sales!E:E)&"B2"', "c", 2, 1),
    '=SUMIF(Sales!B:B,A2,Sales!F:F)&"B2"',
  );
  assert.equal(move("='Two words'!C2+C2", "c", 2, 1), "='Two words'!C2+D2");
  // Another sheet's formula moves only what it names of this one
  assert.equal(
    moveRefs("=Sales!C3+C3", {
      on: "Sum",
      target: "Sales",
      axis: "r",
      at: 2,
      count: 1,
    }),
    "=Sales!C4+C3",
  );
  assert.equal(fillDown("=C2*$D$2+SUM(C:C)", 3), "=C5*$D$2+SUM(C:C)");
  assert.equal(fillDown("=C2", -2), "=#REF!");
});

test("the references a formula names are found where they stand, a half-typed one too", () => {
  const found = (formula: string) =>
    referencesIn(formula).map(
      (ref: { sheet: string | null; start: number; end: number }) => [
        ref.sheet,
        formula.slice(ref.start, ref.end),
      ],
    );
  assert.deepEqual(found('=SUMIF(Sales!B:B,A2,Sales!E:E)&"B2"'), [
    ["Sales", "Sales!B:B"],
    [null, "A2"],
    ["Sales", "Sales!E:E"],
  ]);
  assert.deepEqual(found("=IF(TRUE,'Two words'!$A$1,SUM(C2:C"), [
    ["Two words", "'Two words'!$A$1"],
    [null, "C2:C"],
  ]);
});

test("worked out for an edit, a formula that cannot be holds Excel's error and says why", () => {
  const sheets = [
    {
      name: "A",
      cells: [
        [v("x")],
        [f("=A3")],
        [f("=A2")],
        [f("=Gone!A1")],
        [f("=#REF!+1")],
        [f("=IFERROR(#N/A,7)")],
      ],
    },
  ];
  const problems: string[] = [];
  workOut(sheets, { problems });
  const got = sheets[0].cells.map((row) => (row[0] as { v: unknown }).v);
  assert.deepEqual(got.slice(1), [
    { error: "#VALUE!" },
    { error: "#VALUE!" },
    { error: "#REF!" },
    { error: "#REF!" },
    7,
  ]);
  assert.equal(problems.length, 2);
  assert.match(problems[1], /A!A4 \(=Gone!A1\): there is no sheet "Gone"/);
});

test("what is typed into a cell reads as its column writes numbers", () => {
  assert.equal(valueOf("1,234.5"), 1234.5);
  assert.equal(valueOf("$1,200", '"$"#,##0.00'), 1200);
  assert.equal(valueOf("-$5", '"$"#,##0'), -5);
  assert.equal(valueOf("12,000원", '#,##0"원"'), 12000);
  assert.equal(valueOf("25%", "0.0%"), 0.25);
  assert.equal(valueOf("true"), true);
  assert.equal(valueOf(" "), null);
  // Text stays text: a date, a code with a comma in the wrong place, a word
  assert.equal(valueOf("2026-07-02"), "2026-07-02");
  assert.equal(valueOf("1,23"), "1,23");
  assert.equal(valueOf("Hanbit"), "Hanbit");
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
  // Another way for negatives and zero after a ;, in a colour, and Excel's spacing kept
  assert.equal(formatValue(-1500, "#,##0;[Red](#,##0)"), "(1,500)");
  assert.equal(formatColor(-1500, "#,##0;[Red](#,##0)"), "Red");
  assert.equal(formatColor(1500, "#,##0;[Red](#,##0)"), null);
  assert.equal(formatValue(0, '#,##0;(#,##0);"-"'), "-");
  assert.equal(xlsxFormat("#,##0_);[Red](#,##0)"), "#,##0_);[Red](#,##0)");
  assert.equal(formatValue(1234, "[$₩-412]#,##0"), "₩1,234");
  // Dates are Excel's day numbers
  const day = serialOf("2026-07-02");
  assert.equal(day, 46205);
  assert.equal(formatValue(day, "yyyy-mm-dd"), "2026-07-02");
  assert.equal(formatValue(day, 'yyyy"년" m"월" d"일"'), "2026년 7월 2일");
  assert.equal(formatValue(day, "ddd, d mmm yyyy"), "Thu, 2 Jul 2026");
  assert.equal(
    formatValue(serialOf("2026-07-02 14:05") ?? 0, "yyyy-mm-dd h:mm AM/PM"),
    "2026-07-02 2:05 PM",
  );
  assert.equal(serialOf("2026-02-30"), null);
  assert.equal(valueOf("2026-07-02", "yyyy-mm-dd"), day);
  assert.equal(valueOf("(1,200)", "#,##0;(#,##0)"), -1200);
  assert.match(checkFormat("[h]:mm") ?? "", /not a format this sheet draws/);
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
    ["Bold", 46204, 46205],
  );
  // Dates stay dates: their own format when the sheet draws it, Excel's built-in one as ISO
  assert.deepEqual(sheet.formats.slice(1), [
    "[Red]yyyy\\-mm\\-dd",
    "yyyy-mm-dd",
  ]);
  assert.equal(formatValue(46204, sheet.formats[1]), "2026-07-01");
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

  // Read back as put takes it: the column formula, formats and totals as they were written
  const again = join(home, "again.json");
  assert.equal(run("read", "q3", "--json", again).status, 0);
  const described = JSON.parse(await readFile(again, "utf8"));
  assert.equal(described.title, "Q3 sales");
  assert.deepEqual(described.sheets[0].columns[3], {
    name: "Amount",
    format: '#,##0"원"',
    formula: "=B{r}*C{r}",
  });
  assert.deepEqual(described.sheets[0].rows[0], ["Hanbit", 40, 32000, null]);
  assert.deepEqual(described.sheets[0].totals, {
    label: "Total",
    Qty: "sum",
    Amount: "sum",
  });
  assert.equal(
    described.sheets[1].columns[1].formula,
    "=SUMIF(Sales!A:A,A{r},Sales!D:D)",
  );
  assert.equal(run("put", "q3", again, "--over").status, 0);
  assert.deepEqual(readXlsx(await readFile(xlsx)).sheets[0].rows[3][3], {
    v: 3014000,
    f: "=SUBTOTAL(109,D2:D3)",
  });
});

test("a column of dates holds Excel's dates, summed by month with SUMIFS, and reads back as written", async () => {
  const book = join(home, "dated.json");
  await writeFile(
    book,
    JSON.stringify({
      sheets: [
        {
          name: "Orders",
          columns: [
            { name: "Date", format: "yyyy-mm-dd hh:mm" },
            { name: "Amount", format: "#,##0;[Red]-#,##0" },
          ],
          rows: [
            ["2026-07-03", 10],
            // A month's last evening is still that month
            ["2026-07-31 18:30", -4],
            ["2026-08-01", 40],
            ["not yet", 1],
          ],
        },
        {
          name: "By month",
          columns: [
            { name: "Month", format: "yyyy-mm" },
            {
              name: "Total",
              formula:
                '=SUMIFS(Orders!B:B,Orders!A:A,">="&A{r},Orders!A:A,"<"&EOMONTH(A{r},0)+1)',
            },
          ],
          rows: [["2026-07-01"], ["2026-08-01"]],
        },
      ],
    }),
  );
  const made = run("put", "dated", book);
  assert.equal(made.status, 0, made.stderr);
  const back = readXlsx(
    await readFile(join(home, "artifacts", "dated", "dated.xlsx")),
  ).sheets;
  assert.deepEqual(back[0].rows[1][0], { v: 46206 });
  assert.equal(
    back[0].rows[4][0].v,
    "not yet",
    "text that is no date stays text",
  );
  assert.equal(back[0].formats[0], "yyyy-mm-dd hh:mm");
  assert.deepEqual(
    back[1].rows.slice(1).map((row: { v: unknown }[]) => row[1].v),
    [6, 40],
  );
  const read = run("read", "dated", "--json", join(home, "dated-back.json"));
  assert.match(read.stdout, /2026-07-03\t10/);
  const described = JSON.parse(
    await readFile(join(home, "dated-back.json"), "utf8"),
  );
  assert.deepEqual(described.sheets[0].rows[0], ["2026-07-03", 10]);
  assert.deepEqual(described.sheets[1].rows[1], ["2026-08-01", null]);
});

// EUC-KR by hand: each Korean word's bytes, and ASCII as it is
const EUC_KR: Record<string, string> = {
  조회계좌: "c1b6c8b8b0e8c1c2",
  거래일자: "b0c5b7a1c0cfc0da",
  적요: "c0fbbfe4",
  출금액: "c3e2b1ddbed7",
  입금액: "c0d4b1ddbed7",
  카페: "c4abc6e4",
  급여: "b1debfa9",
  환불: "c8afbad2",
};
const eucKr = (text: string) =>
  Buffer.concat(
    text.split(/(\p{Script=Hangul}+)/u).map((part) => {
      if (EUC_KR[part]) return Buffer.from(EUC_KR[part], "hex");
      assert.match(part, /^[\x00-\x7f]*$/, `no EUC-KR bytes for ${part}`);
      return Buffer.from(part, "ascii");
    }),
  );

// Two banks' exports, each with a line about the account over its table
const BANK_EXPORTS = [
  {
    encoding: "euc-kr",
    bytes: eucKr(
      '조회계좌,123-456\n\n거래일자,적요,출금액,입금액\n2026.07.03 12:10,카페,"5,500",\n2026.07.05 09:00,급여,,"3,200,000"\n2026.08.11 18:30,환불,(1200),\n',
    ),
    columns: ["거래일자", "적요", "출금액", "입금액"],
    rows: [
      ["2026-07-03 12:10", "카페", 5500, null],
      ["2026-07-05 09:00", "급여", null, 3200000],
      ["2026-08-11 18:30", "환불", -1200, null],
    ],
  },
  {
    encoding: "windows-1252",
    // latin1 and windows-1252 write every letter here as the same byte
    bytes: Buffer.from(
      "Compte,000123\n\nDate,Libellé,Débit,Crédit\n2026-07-03 12:10,Café,5.50,\n2026-07-05 09:00,Salaire,,3200.00\n2026-08-11 18:30,Remboursé,(12.00),\n",
      "latin1",
    ),
    columns: ["Date", "Libellé", "Débit", "Crédit"],
    rows: [
      ["2026-07-03 12:10", "Café", 5.5, null],
      ["2026-07-05 09:00", "Salaire", null, 3200],
      ["2026-08-11 18:30", "Remboursé", -12, null],
    ],
  },
];

for (const bank of BANK_EXPORTS)
  test(`a bank's export in ${bank.encoding} is refused until named, and read from the line naming its columns`, async () => {
    const name = `bank-${bank.encoding}`;
    const csv = join(home, `${name}.csv`);
    await writeFile(csv, bank.bytes);
    const refused = run("read", csv);
    assert.equal(refused.status, 1);
    assert.match(
      refused.stderr,
      new RegExp(`not written in UTF-8[\\s\\S]*${bank.encoding}`),
    );
    const lines = run("read", csv, "--encoding", bank.encoding);
    assert.match(
      lines.stdout,
      new RegExp(`^3\\t${bank.columns.join("\\t")}$`, "m"),
    );
    const out = join(home, `${name}.json`);
    const json = run(
      "read",
      csv,
      "--encoding",
      bank.encoding,
      "--header",
      "3",
      "--json",
      out,
    );
    assert.equal(json.status, 0, json.stderr);
    const spec = JSON.parse(await readFile(out, "utf8"));
    assert.deepEqual(spec.sheets[0].columns[0], {
      name: bank.columns[0],
      format: "yyyy-mm-dd hh:mm",
    });
    assert.deepEqual(spec.sheets[0].rows, bank.rows);
    assert.equal(run("put", name, out).status, 0);
    const back = readXlsx(
      await readFile(join(home, "artifacts", name, `${name}.xlsx`)),
    ).sheets[0];
    assert.equal(back.formats[0], "yyyy-mm-dd hh:mm");
    assert.equal(
      formatValue(back.rows[1][0].v, back.formats[0]),
      "2026-07-03 12:10",
    );
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
    await stops(one({ columns: [{ name: "x", format: "[h]:mm" }] })),
    /not a format this sheet draws/,
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
