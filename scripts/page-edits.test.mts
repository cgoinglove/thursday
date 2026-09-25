import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// The workspace is found from the data folder as the modules load: keep it off anyone's own
const home = await mkdtemp(join(tmpdir(), "thursday-page-edits-"));
process.env.THURSDAY_HOME = home;
after(() => rm(home, { recursive: true, force: true }));

const { editedSince, getBetween, putBetween } = await import(
  "../skills/artifact/runtime/shell/put.mjs"
);
const { wear } = await import("../skills/artifact/runtime/shell/wear.mjs");
const { WORKSPACE } = await import("../features/workspace/workspace.ts");
const { savePage } = await import("../features/workspace/workspace.query.ts");

/** A page as a script's `new` writes it: the shell's head, and a body between the marks. */
const page = (body: string): string =>
  wear(
    `<!doctype html><html><head>{{shell.meta}}</head><body><main id="paper">\n<!-- put: start -->\n${body}\n<!-- put: end -->\n</main></body></html>`,
  );
const revisionOf = (html: string) =>
  /<meta name="revision" content="([^"]*)">/.exec(html)?.[1];
const withoutMark = (html: string) =>
  html.replace(/<!-- put: start[^>]*-->/, "");

test("a put over a body edited since is refused until the page is got again", () => {
  let html = putBetween(page("<p>Template</p>"), "<p>First</p>");
  assert.equal(editedSince(html), false);
  // The bot's own next put, over what it put itself
  html = putBetween(html, "<p>Second</p>");
  assert.equal(editedSince(html), false);

  // The reader edits it where the app shows it
  const edited = html.replace("Second", "Second, edited in the app");
  assert.equal(editedSince(edited), true);

  const got = getBetween(edited);
  assert.ok(got);
  assert.equal(got.content, "<p>Second, edited in the app</p>");
  assert.equal(editedSince(got.html), false);
  // Getting moves the mark and nothing else
  assert.equal(withoutMark(got.html), withoutMark(edited));
});

test("every put names a new revision, and a page from before revisions is given one", () => {
  const made = page("<p>One</p>");
  const put = putBetween(made, "<p>Two</p>");
  assert.ok(revisionOf(made));
  assert.ok(revisionOf(put));
  assert.notEqual(revisionOf(put), revisionOf(made));

  const older = made.replace(/<meta name="revision"[^>]*>\n?/, "");
  assert.equal(revisionOf(older), undefined);
  assert.ok(revisionOf(putBetween(older, "<p>Two</p>")));
});

test("a save from a page opened before the file's last write is refused, and one after it names a new revision", async () => {
  const rel = "artifacts/Tester/report.html";
  const file = join(WORKSPACE, rel);
  await mkdir(join(WORKSPACE, "artifacts", "Tester"), { recursive: true });
  const opened = page("<p>One</p>");
  await writeFile(file, opened);

  // A bot puts new work in while the page is open; the open page's tick must not undo it
  const put = putBetween(opened, "<p>Two</p>");
  await writeFile(file, put);
  assert.deepEqual(
    await savePage(
      rel,
      opened.replace("One", "One, ticked"),
      revisionOf(opened) ?? "",
    ),
    { changed: true },
  );
  assert.equal(await readFile(file, "utf8"), put);

  // Opened again it keeps its edits, under a revision the next save names
  const saved = await savePage(
    rel,
    put.replace("Two", "Two, ticked"),
    revisionOf(put) ?? "",
  );
  assert.ok(!saved.changed);
  const now = await readFile(file, "utf8");
  assert.match(now, /Two, ticked/);
  assert.equal(revisionOf(now), saved.revision);
  assert.notEqual(saved.revision, revisionOf(put));
  // A second window still on the revision before that save is refused
  assert.deepEqual(
    await savePage(
      rel,
      put.replace("Two", "Two, other window"),
      revisionOf(put) ?? "",
    ),
    { changed: true },
  );
});

test("a chart drawn into a document is part of what the bot put, and a page opened before it cannot save over it", async () => {
  const { execFileSync } = await import("node:child_process");
  const rel = "artifacts/Tester/chart.html";
  const file = join(WORKSPACE, rel);
  await mkdir(join(WORKSPACE, "artifacts", "Tester"), { recursive: true });
  const put = putBetween(
    page("<p>Template</p>"),
    '<p>Rent</p>\n<figure id="rent"></figure>',
  );
  await writeFile(file, put);
  const csv = join(home, "rent.csv");
  await writeFile(
    csv,
    "# source: https://example.org/rent\nyear,rent\n2023,80\n2024,85\n",
  );
  const chart = join(
    import.meta.dirname,
    "..",
    "skills",
    "artifact",
    "scripts",
    "chart.mjs",
  );
  const draw = (id: string) =>
    execFileSync(process.execPath, [chart, file, id, csv], { stdio: "pipe" });

  // An id the empty figure does not wait for is turned away, not drawn at the end
  assert.throws(() => draw("rates"), /empty figures wait for "rent"/);
  assert.equal(await readFile(file, "utf8"), put);

  draw("rent");
  const drawn = await readFile(file, "utf8");
  assert.ok(drawn.includes('<figure id="rent" class="chart">'));
  assert.equal(editedSince(drawn), false, "the bot's next put goes through");
  assert.notEqual(revisionOf(drawn), revisionOf(put));
  assert.deepEqual(
    await savePage(
      rel,
      put.replace("Rent", "Rent, ticked"),
      revisionOf(put) ?? "",
    ),
    { changed: true },
  );

  // A figure with no place of its own ends the document's body, inside the marks
  draw("more");
  const more = await readFile(file, "utf8");
  assert.ok(
    /<figure id="more" class="chart">[\s\S]*<\/figure>\n<!-- put: end -->/.test(
      more,
    ),
  );

  // Drawn over the reader's edits, it keeps them and still asks the bot to get them first
  await writeFile(file, more.replace("<p>Rent</p>", "<p>Rent, edited</p>"));
  draw("rent");
  const over = await readFile(file, "utf8");
  assert.ok(over.includes("<p>Rent, edited</p>"));
  assert.equal(editedSince(over), true);

  // The path skills installed before the page skill was folded into artifact still draws
  const before = join(
    import.meta.dirname,
    "..",
    "skills",
    "interactive-page",
    "scripts",
    "chart.mjs",
  );
  const said = execFileSync(process.execPath, [before, file, "rent", csv], {
    stdio: "pipe",
  }).toString();
  assert.match(said, /^Drew .* as #rent\./);
});

test("a chart drawn where a placeholder holds one of its own kind replaces all of it", async () => {
  const { execFileSync } = await import("node:child_process");
  const rel = "artifacts/Tester/nested.html";
  const file = join(WORKSPACE, rel);
  await mkdir(join(WORKSPACE, "artifacts", "Tester"), { recursive: true });
  await writeFile(
    file,
    putBetween(
      page("<p>Before</p>"),
      '<p>Before</p>\n<div id="rent"><div class="note">placeholder</div><p>inside</p></div>\n<p>After</p>',
    ),
  );
  const csv = join(home, "nested.csv");
  await writeFile(
    csv,
    "# source: https://example.org\nyear,rent\n2023,80\n2024,85\n",
  );
  const chart = join(
    import.meta.dirname,
    "..",
    "skills",
    "artifact",
    "scripts",
    "chart.mjs",
  );
  execFileSync(process.execPath, [chart, file, "rent", csv], { stdio: "pipe" });

  const drawn = await readFile(file, "utf8");
  // The first close inside it once ended the match, and left the rest after the chart
  assert.ok(
    !drawn.includes("<p>inside</p>"),
    "the whole placeholder is replaced",
  );
  assert.match(drawn, /<\/figure>\s*<p>After<\/p>/);
});

test("a sheet edited in the app writes its .xlsx too, and not over one changed in Excel since", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const runtime = join(
    import.meta.dirname,
    "..",
    "skills",
    "artifact",
    "runtime",
  );
  const { readXlsx } = await import(join(runtime, "sheet", "xlsx.mjs"));
  const { unzipSync, zipSync, strToU8, strFromU8 } = await import(
    join(runtime, "vendor", "fflate.mjs")
  );
  const book = join(home, "sheet.json");
  await writeFile(
    book,
    JSON.stringify({
      sheets: [
        {
          name: "Sales",
          columns: [
            { name: "Client" },
            { name: "Qty" },
            { name: "Price" },
            { name: "Amount", formula: "=B{r}*C{r}" },
          ],
          rows: [
            ["Hanbit", 2, 10, null],
            ["Gaon", 3, 20, null],
          ],
          totals: { label: "Total", Amount: "sum" },
        },
      ],
    }),
  );
  execFileSync(
    process.execPath,
    ["skills/artifact/scripts/spreadsheet.mjs", "put", "ledger", book],
    {
      env: {
        ...process.env,
        THURSDAY_ARTIFACTS: join(WORKSPACE, "artifacts", "Tester"),
      },
    },
  );
  const rel = "artifacts/Tester/ledger/ledger.html";
  const file = join(WORKSPACE, rel);
  const xlsx = join(WORKSPACE, "artifacts", "Tester", "ledger", "ledger.xlsx");
  const opened = await readFile(file, "utf8");
  const drawn = (html: string) =>
    /<meta name="sheet-xlsx" content="([0-9a-f]*)"/.exec(html)?.[1];

  // The page as its script leaves it after an edit: a row put in, its formula filled down
  const data =
    /<script type="application\/json" id="sheet-data">([\s\S]*?)<\/script>/;
  const edit = (html: string) => {
    const sheet = JSON.parse(data.exec(html)?.[1] ?? "null");
    sheet.sheets[0].rows.push([
      { v: "Miru" },
      { v: 4 },
      { v: 5 },
      { v: null, f: "=B4*C4" },
    ]);
    return html.replace(
      data,
      () =>
        `<script type="application/json" id="sheet-data">${JSON.stringify(sheet)}</script>`,
    );
  };
  const saved = await savePage(rel, edit(opened), revisionOf(opened) ?? "");
  assert.ok(!saved.changed);
  const rows = readXlsx(await readFile(xlsx)).sheets[0].rows;
  assert.deepEqual(
    rows[3].map((cell: { v: unknown }) => cell.v),
    ["Miru", 4, 5, 20],
  );
  assert.deepEqual(rows[4][3], { v: 100, f: "=SUBTOTAL(109,D2:D4)" });
  const now = await readFile(file, "utf8");
  assert.notEqual(drawn(now), drawn(opened));
  assert.match(now, /"f":"=B4\*C4"/);
  // A bot's put from what it wrote before would undo the edit: it stops until the bot reads it
  const put = spawnSync(
    process.execPath,
    ["skills/artifact/scripts/spreadsheet.mjs", "put", "ledger", book],
    {
      env: {
        ...process.env,
        THURSDAY_ARTIFACTS: join(WORKSPACE, "artifacts", "Tester"),
      },
      encoding: "utf8",
    },
  );
  assert.equal(put.status, 1);
  assert.match(
    put.stderr,
    /changed after it was last written — in Excel, in the app/,
  );

  // Changed in Excel after the page drew it: the save stops, the file stays Excel's, and the
  // page is drawn again from it, so Reload shows it as it is
  const files = unzipSync(await readFile(xlsx));
  const sheetXml = strFromU8(files["xl/worksheets/sheet1.xml"]);
  files["xl/worksheets/sheet1.xml"] = strToU8(
    sheetXml.replace(">Hanbit<", ">Changed in Excel<"),
  );
  const excel = zipSync(files);
  await writeFile(xlsx, excel);
  assert.deepEqual(await savePage(rel, edit(now), revisionOf(now) ?? ""), {
    changed: true,
  });
  assert.deepEqual(new Uint8Array(await readFile(xlsx)), excel);
  const redrawn = await readFile(file, "utf8");
  assert.match(redrawn, /"v":"Changed in Excel"/);
  assert.notEqual(revisionOf(redrawn), revisionOf(now));
  assert.notEqual(drawn(redrawn), drawn(now));
  // Opened again, it saves
  const again = await savePage(rel, edit(redrawn), revisionOf(redrawn) ?? "");
  assert.ok(!again.changed);
});

test("a page from before revisions keeps its edits as it did", async () => {
  const rel = "artifacts/Tester/older.html";
  const file = join(WORKSPACE, rel);
  await mkdir(join(WORKSPACE, "artifacts", "Tester"), { recursive: true });
  const older = page("<p>One</p>").replace(
    /<meta name="revision"[^>]*>\n?/,
    "",
  );
  await writeFile(file, older);
  const edited = older.replace("One", "One, edited");
  assert.deepEqual(await savePage(rel, edited, ""), {
    changed: false,
    revision: "",
  });
  assert.equal(await readFile(file, "utf8"), edited);
});

test("a document written in Markdown is put in the document's own markup, and makes its page the first time", async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "thursday-document-"));
  after(() => rm(dir, { recursive: true, force: true }));
  const md = join(dir, "rent.md");
  await writeFile(
    md,
    [
      "---",
      "kicker: Report",
      "date: As of 24 September",
      "by: Analyst, Sam",
      "---",
      "<!-- the outline's guidance -->",
      "# Rent rose faster than pay",
      "",
      "The lede, read first.",
      "",
      "```stats",
      "9% | rise in rent",
      "4% | rise in pay",
      "```",
      "",
      "| District | Rent |",
      "|---|---:|",
      "| Mapo | 85 |",
      "",
      "> [!WARNING]",
      "> A first estimate.",
      "",
      "- [x] Checked",
      "- [ ] Next",
      "",
      "![Mapo, as the listing shows it](photo.jpg)",
      "",
      '<figure id="rent"></figure>',
    ].join("\n"),
  );
  const script = join(
    import.meta.dirname,
    "..",
    "skills",
    "artifact",
    "scripts",
    "document.mjs",
  );
  execFileSync(process.execPath, [script, "put", "rent", md], {
    cwd: dir,
    env: { ...process.env, THURSDAY_ARTIFACTS: "" },
  });
  const html = await readFile(join(dir, "artifacts", "rent.html"), "utf8");
  for (const piece of [
    "<title>Rent rose faster than pay</title>",
    '<p class="kicker">Report</p>',
    '<span class="chip who">Analyst</span> <span class="chip who">Sam</span>',
    '<p class="lede">The lede, read first.</p>',
    '<div class="grid"><div class="card"><p class="stat">9%</p>'.replace(
      "><div",
      ">\n<div",
    ),
    '<td class="num">85</td>',
    '<div class="note warn">',
    '<ul class="check">',
    '<input type="checkbox" checked> Checked',
    "<figcaption>Mapo, as the listing shows it</figcaption>",
    '<figure id="rent"></figure>',
  ])
    assert.ok(html.includes(piece), `the page holds ${piece}`);
  assert.ok(!html.includes("the outline's guidance"), "comments are dropped");
});

test("front matter written without its fences is still the line over and under the title", async () => {
  const { documentBody } = await import(
    "../skills/artifact/runtime/document/markdown.mjs"
  );
  const body = documentBody(
    "kicker: Report\ndate: 24 September\nby: Analyst\n\n# The finding\n\nThe lede.\n\nby: a line of prose\n",
  );
  assert.ok(
    body.startsWith('<p class="kicker">Report</p>\n<h1>The finding</h1>'),
  );
  assert.ok(body.includes('<span class="chip who">Analyst</span>'));
  assert.ok(
    body.includes("<p>by: a line of prose</p>"),
    "prose below the title stays prose",
  );
});

test("footnotes are numbered as first cited and gathered at the end, code and strays left as written", async () => {
  const { documentBody } = await import(
    "../skills/artifact/runtime/document/markdown.mjs"
  );
  const body = documentBody(
    [
      "# Rent",
      "",
      "Rents rose.[^b] Pay did not.[^a] Rents again.[^b] Unknown.[^c]",
      "",
      "```",
      "[^x]: inside code",
      "```",
      "",
      "[^a]: Pay survey",
      "[^b]: Rent index, [the source](https://example.com)",
    ].join("\n"),
  );
  assert.ok(
    body.includes(
      '<sup class="fn"><a href="#fn-b" id="fn-b-ref">1</a></sup> Pay did not.<sup class="fn"><a href="#fn-a" id="fn-a-ref">2</a></sup>',
    ),
    "numbered in the order first cited",
  );
  assert.ok(
    body.includes("Unknown.[^c]"),
    "a citation with no note stays text",
  );
  assert.ok(body.includes("[^x]: inside code"), "code is left as written");
  const notes = body.slice(body.indexOf('<ol class="footnotes">'));
  assert.ok(notes.indexOf('id="fn-b"') < notes.indexOf('id="fn-a"'));
  assert.ok(notes.includes('<a href="https://example.com">the source</a>'));
});

test("the bot writing the page wears its face on its own byline chip, and only there", async () => {
  const { documentBody } = await import(
    "../skills/artifact/runtime/document/markdown.mjs"
  );
  const { markStill } = await import("../features/bot/mark.geometry");
  const was = {
    bot: process.env.THURSDAY_BOT,
    mark: process.env.THURSDAY_BOT_MARK,
  };
  process.env.THURSDAY_BOT = "Analyst";
  process.env.THURSDAY_BOT_MARK = JSON.stringify(
    markStill("Analyst", { color: "#22C55E", shape: "squircle" }),
  );
  try {
    const body = documentBody("---\nby: analyst, Sam\n---\n# Title\n");
    assert.ok(
      /<span class="chip who bot"><svg class="sh-mark"[^>]*>.*<\/svg>analyst<\/span>/.test(
        body,
      ),
    );
    assert.ok(body.includes('<span class="chip who">Sam</span>'));
    // What is in the variable is drawn only when it is a mark: markup in it draws nothing
    process.env.THURSDAY_BOT_MARK = JSON.stringify({
      ...markStill("Analyst"),
      ink: '#000" onload="alert(1)',
    });
    assert.ok(
      documentBody("---\nby: Analyst\n---\n# Title\n").includes(
        '<span class="chip who">Analyst</span>',
      ),
    );
  } finally {
    for (const [key, value] of [
      ["THURSDAY_BOT", was.bot],
      ["THURSDAY_BOT_MARK", was.mark],
    ] as const)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test("bold that ends in punctuation closes before a Chinese, Japanese or Korean letter, and nothing else changes", async () => {
  const { documentBody } = await import(
    "../skills/artifact/runtime/document/markdown.mjs"
  );
  const inline = (text: string) =>
    documentBody(text).replace(/^<p>|<\/p>\s*$/g, "");

  // Scripts that put no space after a word: the run closes on the letter, and opens after one
  assert.equal(
    inline("금리는 **5.11%**다."),
    "금리는 <strong>5.11%</strong>다.",
  );
  assert.equal(
    inline("今日は**「重要」**です。"),
    "今日は<strong>「重要」</strong>です。",
  );
  assert.equal(inline("他说**“好”**了"), "他说<strong>“好”</strong>了");
  assert.equal(
    inline('그는 다**"인용"**이라고 했다.'),
    "그는 다<strong>&quot;인용&quot;</strong>이라고 했다.",
  );
  // A note's body is lexed on its own, the same way
  assert.ok(
    documentBody("> [!NOTE]\n> 금리는 **5.11%**다.").includes(
      "<strong>5.11%</strong>다.",
    ),
  );

  // Elsewhere CommonMark stands: a letter after punctuation still opens rather than closes
  assert.equal(
    inline("Rates of **5.11%**, then **6%**s and a**b**c."),
    "Rates of <strong>5.11%</strong>, then <strong>6%<strong>s and a</strong>b</strong>c.",
  );
  assert.equal(
    inline("2 * 3 * 4 and `**code**다`"),
    "2 * 3 * 4 and <code>**code**다</code>",
  );
});

test("a chart drawn as a picture stands alone: its title and source on it, no page and no readout", async () => {
  const { execFileSync } = await import("node:child_process");
  const csv = join(home, "visits.csv");
  await writeFile(
    csv,
    "# title: Visits\n# source: https://example.org/visits\nmonth,A\n2026-01,1\n2026-02,3\n",
  );
  const chart = join(
    import.meta.dirname,
    "..",
    "skills",
    "artifact",
    "scripts",
    "chart.mjs",
  );
  const out = join(home, "pictures", "visits.svg");
  const said = execFileSync(process.execPath, [chart, out, csv], {
    encoding: "utf8",
  });
  assert.match(said, /as a picture/);
  const svg = await readFile(out, "utf8");
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.match(svg, /<text class="pic-title"[^>]*>Visits<\/text>/);
  assert.match(svg, /example\.org/);
  // The readout needs a page's script; a picture has none, and draws once, not twice
  assert.ok(!svg.includes("data-chart"));
  assert.ok(!svg.includes('class="hover"'));
  assert.equal(svg.match(/class="chart-svg"/g)?.length, 1);
});

test("upright bars, a donut and stacked bars draw their parts, and each stops on what it cannot show", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const chart = join(
    import.meta.dirname,
    "..",
    "skills",
    "artifact",
    "scripts",
    "chart.mjs",
  );
  const csv = async (name: string, text: string) => {
    const path = join(home, `${name}.csv`);
    await writeFile(path, text);
    return path;
  };
  const draw = (out: string, from: string, ...flags: string[]) =>
    execFileSync(process.execPath, [chart, out, from, ...flags], {
      encoding: "utf8",
    });
  const refused = (from: string, ...flags: string[]) =>
    spawnSync(process.execPath, [chart, join(home, "no.svg"), from, ...flags], {
      encoding: "utf8",
    }).stderr;

  const months = await csv("months", "month,sold\nJan,120\nFeb,135\nMar,128\n");
  const columns = join(home, "columns.svg");
  draw(columns, months, "--kind", "column", "--highlight", "Mar");
  const upright = await readFile(columns, "utf8");
  // In the rows' own order, the picked one in the accent and the rest quiet
  const bars = [
    ...upright.matchAll(/<rect class="bar (\w+)"[^>]*><title>(\w+):/g),
  ];
  assert.deepEqual(
    bars.map((bar) => `${bar[2]} ${bar[1]}`),
    ["Jan quiet", "Feb quiet", "Mar c1"],
  );

  const shares = await csv("shares", "item,n\nA,30\nB,50\nC,20\n");
  const ring = join(home, "ring.svg");
  draw(ring, shares, "--kind", "donut", "--locale", "en");
  const donut = await readFile(ring, "utf8");
  assert.equal(donut.match(/class="slice /g)?.length, 3);
  // Largest first, and the ring's middle names it
  assert.match(donut, />50%<\/text><text class="tick"[^>]*>B</);

  const parts = await csv("parts", "day,a,b\nMon,1,3\nTue,2,2\n");
  const stack = join(home, "stack.svg");
  draw(stack, parts, "--kind", "stacked", "--share", "--locale", "en");
  const stacked = await readFile(stack, "utf8");
  assert.match(stacked, /Mon — a: 25%/);
  assert.match(stacked, /Tue — b: 50%/);

  const six = await csv(
    "six",
    `item,n\n${["A", "B", "C", "D", "E", "F"].map((x, i) => `${x},${i + 1}`).join("\n")}\n`,
  );
  assert.match(refused(six, "--kind", "donut"), /five parts or fewer/);
  const minus = await csv("minus", "day,a,b\nMon,1,-3\n");
  assert.match(refused(minus, "--kind", "stacked"), /negative part/);
  assert.match(
    refused(months, "--kind", "stacked"),
    /two or more value columns/,
  );
  assert.match(refused(months, "--kind", "column", "--share"), /--share/);
  assert.match(refused(months, "--kind", "pie"), /is not a kind/);
});
