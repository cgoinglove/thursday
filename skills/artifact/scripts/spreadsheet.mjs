#!/usr/bin/env node
// A sheet: a real .xlsx file — its formulas, number formats, a frozen header with a filter on it
// — and the page beside it that shows it in the app, with its tabs, sorting, filters, the sum of
// the picked cells, CSV and copy. Excel, Numbers and Google Sheets open the .xlsx; the page is
// its view. Both land in your folder under artifacts/, in a folder named after the sheet.
//
//   node spreadsheet.mjs put <name> <book.json | data.csv> [--title "…"] [--over]
//        write the workbook from a JSON description (references/sheet.md), or one sheet from
//        a CSV whose first line names the columns
//   node spreadsheet.mjs read <name | file.xlsx> [--rows 20] [--csv <folder>] [--json <file>]
//        what a workbook holds: each sheet's size, its first rows and its formulas; --csv
//        writes every sheet as a CSV there, for chart.mjs or a script; --json writes the
//        whole workbook as put takes it — formats, formulas and totals kept — to change and put
//   node spreadsheet.mjs view <name | file.xlsx> [--name <name>]
//        the page drawn again from the .xlsx as it is now (after it was changed in Excel), or
//        a page for someone's .xlsx: it is copied into your folder beside its page
//   node spreadsheet.mjs shots <name>
//        the page as it opens, as a picture to look at
//   node spreadsheet.mjs sync <edited.html> --page <page.html>
//        the app's side of an edit made in the page: the .xlsx beside <page.html> written from
//        the workbook <edited.html> holds, and <edited.html> made to name it (workspace.query
//        savePage runs this before the edited page takes the old one's place); exit 3 when
//        the .xlsx was changed since the page drew it
//
// A formula this sheet cannot work out, a number format it does not draw, a sheet name Excel
// refuses and a workbook changed in Excel since it was written all stop, rather than write
// something quietly wrong or over the user's changes.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkFormat,
  formatValue,
  isDateFormat,
  isoOf,
  serialOf,
} from "../runtime/sheet/format.mjs";
import {
  asColumnFormula,
  colName,
  FormulaError,
  FUNCTIONS,
  workOut,
} from "../runtime/sheet/formula.mjs";
import { readXlsx, sheetRef, writeXlsx } from "../runtime/sheet/xlsx.mjs";
import { revision } from "../runtime/shell/put.mjs";
import { wear } from "../runtime/shell/wear.mjs";
import {
  ARTIFACTS,
  NAME,
  Stop,
  shown,
  WORKSPACE,
} from "../runtime/shell/workspace.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME = join(SKILL, "runtime", "sheet");
const SCRIPT = join(SKILL, "scripts", "spreadsheet.mjs");
const SKILLS = process.env.THURSDAY_SKILLS || resolve(SKILL, "..");

/** The most cells a workbook holds here; past it a bot works on the data with a script. */
const MOST_CELLS = 300_000;
/** How each totals function is written into the .xlsx: SUBTOTAL, so a filter in Excel is counted too. */
const TOTALS = { sum: 109, average: 101, count: 102, max: 104, min: 105 };

const usage = () => {
  const lines = readFileSync(new URL(import.meta.url), "utf8")
    .split("\n")
    .slice(1);
  const end = lines.findIndex((line) => !line.startsWith("//"));
  return lines
    .slice(0, end)
    .map((line) => line.replace(/^\/\/ ?/, ""))
    .join("\n");
};

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) {
      positional.push(argv[i]);
      continue;
    }
    const next = argv[i + 1];
    flags[argv[i].slice(2)] =
      next === undefined || next.startsWith("--") ? true : (i++, next);
  }
  return { positional, flags };
}

/** A sheet's folder, and its two files in it. */
function filesFor(name) {
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a sheet name: letters, numbers, - and _ only.`,
    );
  const folder = join(ARTIFACTS, name);
  return {
    folder,
    xlsx: join(folder, `${name}.xlsx`),
    page: join(folder, `${name}.html`),
  };
}

const hashOf = (bytes) =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 16);

/** The .xlsx as the page last drew it; null for a page made before this was kept. */
const drawnHash = (page) =>
  existsSync(page)
    ? (/<meta name="sheet-xlsx" content="([0-9a-f]*)"/.exec(
        readFileSync(page, "utf8"),
      )?.[1] ?? null)
    : null;

/** Whether the page was drawn from the user's own change — an edit in the app, or the file
 * changed in Excel — rather than from a bot's put: a put over it would undo that change. */
const userChanged = (page) =>
  existsSync(page) &&
  /<meta name="sheet-xlsx" content="[0-9a-f]*" data-edited/.test(
    readFileSync(page, "utf8"),
  );
const EDITED = (hash) =>
  `<meta name="sheet-xlsx" content="${hash}" data-edited`;

/** A width for a column in Excel's characters: its longest text, a Korean or Chinese one counted twice. */
const widthOf = (texts) => {
  const longest = Math.max(
    0,
    ...texts.map((text) =>
      [...String(text)].reduce(
        (w, ch) => w + (/[ᄀ-ᇿ⺀-鿿가-힯＀-￯]/.test(ch) ? 2 : 1),
        0,
      ),
    ),
  );
  return Math.min(50, Math.max(6, longest + 2));
};

// ── a workbook from a description ─────────────────────────────────────────

/** `book.json` read and checked into sheets of cells, row 0 each sheet's header. */
function fromDescription(spec) {
  if (!spec || !Array.isArray(spec.sheets) || !spec.sheets.length)
    throw new Stop(
      'The workbook needs "sheets": a list of { "name", "columns", "rows" } (references/sheet.md).',
    );
  const seen = new Set();
  let cells = 0;
  const sheets = spec.sheets.map((one, s) => {
    const name = String(one?.name ?? "").trim();
    if (
      !name ||
      name.length > 31 ||
      /[[\]:*?/\\]/.test(name) ||
      /^'|'$/.test(name)
    )
      throw new Stop(
        `Sheet ${s + 1}'s name "${name}" is not one Excel takes: 1 to 31 characters, none of [ ] : * ? / \\, not starting or ending with '.`,
      );
    if (seen.has(name.toLowerCase()))
      throw new Stop(`Two sheets are named "${name}".`);
    seen.add(name.toLowerCase());
    if (!Array.isArray(one.columns) || !one.columns.length)
      throw new Stop(
        `Sheet "${name}" needs "columns": a list of { "name" } and, where it has them, "format", "formula", "width".`,
      );
    const columns = one.columns.map((column, c) => {
      const label = String(column?.name ?? "").trim();
      if (!label)
        throw new Stop(`Sheet "${name}", column ${colName(c)} has no name.`);
      if (column.format !== undefined) {
        const wrong = checkFormat(String(column.format));
        if (wrong)
          throw new Stop(`Sheet "${name}", column "${label}": ${wrong}.`);
      }
      return {
        name: label,
        format: column.format,
        formula: column.formula,
        width: column.width,
      };
    });
    const rows = one.rows ?? [];
    if (!Array.isArray(rows))
      throw new Stop(
        `Sheet "${name}": "rows" is a list of rows, each a list of cells.`,
      );
    const data = rows.map((row, i) => {
      if (!Array.isArray(row))
        throw new Stop(`Sheet "${name}", row ${i + 2} is not a list of cells.`);
      if (row.length > columns.length)
        throw new Stop(
          `Sheet "${name}", row ${i + 2} has ${row.length} cells for ${columns.length} columns.`,
        );
      return columns.map((column, c) => {
        const given = row[c];
        const excelRow = String(i + 2);
        if (column.formula !== undefined) {
          if (given !== undefined && given !== null)
            throw new Stop(
              `Sheet "${name}", row ${excelRow}: column "${column.name}" is worked out by its formula; leave its cell null.`,
            );
          return { f: String(column.formula).replaceAll("{r}", excelRow) };
        }
        if (given && typeof given === "object") {
          if (typeof given.f !== "string")
            throw new Stop(
              `Sheet "${name}", row ${excelRow}: a cell is a value or { "f": "=…" }.`,
            );
          return { f: given.f.replaceAll("{r}", excelRow) };
        }
        if (given === undefined || given === null || given === "")
          return { v: null };
        if (typeof given === "number" || typeof given === "boolean")
          return { v: given };
        // A date column holds dates: "2026-07-02" is that day, as Excel stores it
        if (column.format !== undefined && isDateFormat(String(column.format)))
          return { v: serialOf(given) ?? String(given) };
        return { v: String(given) };
      });
    });
    cells += (data.length + 2) * columns.length;
    let totals = null;
    if (one.totals) {
      const { label = "Total", ...fns } = one.totals;
      const byName = new Map(columns.map((column, c) => [column.name, c]));
      totals = { label: String(label), cells: columns.map(() => null) };
      for (const [key, fn] of Object.entries(fns)) {
        if (!byName.has(key))
          throw new Stop(
            `Sheet "${name}": totals name "${key}", which is not a column (${columns.map((c) => c.name).join(", ")}).`,
          );
        if (!(fn in TOTALS))
          throw new Stop(
            `Sheet "${name}": total "${fn}" for "${key}" — use sum, average, count, min or max.`,
          );
        totals.cells[byName.get(key)] = fn;
      }
      if (totals.cells[0])
        throw new Stop(
          `Sheet "${name}": the first column holds the totals' label, so it cannot be totalled; put a name or a date first.`,
        );
    }
    return { name, columns, data, totals };
  });
  if (cells > MOST_CELLS)
    throw new Stop(
      `That is ${cells.toLocaleString()} cells; a sheet here holds ${MOST_CELLS.toLocaleString()}. Work on the data with a script and put the result.`,
    );
  return { title: spec.title, sheets };
}

/** One sheet from a CSV: its first line the columns, numbers written as numbers. */
function fromCsv(text, name) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const body = text.replace(/^﻿/, "");
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const lines = rows.filter(
    (one) => one.some((cell) => cell.trim()) && !/^#/.test(one[0] ?? ""),
  );
  if (lines.length < 1) throw new Stop("The CSV has no lines.");
  const [header, ...data] = lines;
  const number = (cell) => {
    const t = cell.trim();
    if (/^-?\d+(\.\d+)?$/.test(t) || /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t))
      return Number(t.replaceAll(",", ""));
    return t === "" ? null : cell;
  };
  return {
    sheets: [
      {
        name: name.slice(0, 31),
        columns: header.map((cell, c) => ({ name: cell.trim() || colName(c) })),
        rows: data.map((one) => header.map((_, c) => number(one[c] ?? ""))),
      },
    ],
  };
}

/** Sheets of cells: header, rows, totals row; formulas worked out. */
function build(model, problems) {
  const sheets = model.sheets.map((sheet) => {
    const header = sheet.columns.map((column) => ({ v: column.name }));
    const cells = [header, ...sheet.data];
    let totals = null;
    if (sheet.totals) {
      const last = sheet.data.length + 1;
      const row = sheet.columns.map((_, c) => {
        const fn = sheet.totals.cells[c];
        if (fn)
          return {
            f: `=SUBTOTAL(${TOTALS[fn]},${colName(c)}2:${colName(c)}${Math.max(2, last)})`,
          };
        return c === 0 ? { v: sheet.totals.label } : { v: null };
      });
      totals = cells.push(row) - 1;
    }
    return {
      name: sheet.name,
      columns: sheet.columns,
      cells,
      totals,
      totalsSpec: sheet.totals,
    };
  });
  try {
    workOut(sheets, { problems });
  } catch (failed) {
    if (failed instanceof FormulaError)
      throw new Stop(`A formula cannot be worked out — ${failed.message}.`);
    throw failed;
  }
  for (const sheet of sheets)
    sheet.columns = sheet.columns.map((column, c) => {
      const values = sheet.cells
        .slice(1)
        .map((row) => row[c]?.v ?? null)
        .filter((v) => v !== null);
      const numbers = values.filter((v) => typeof v === "number").length;
      return {
        name: column.name,
        format: column.format,
        num: values.length > 0 && numbers >= values.length / 2,
        width:
          typeof column.width === "number"
            ? column.width
            : widthOf([
                column.name,
                ...sheet.cells
                  .slice(1, 200)
                  .map((row) => formatValue(row[c]?.v ?? null, column.format)),
              ]),
      };
    });
  return sheets;
}

// ── the page ───────────────────────────────────────────────────────────────

/** The page for a workbook, with the .xlsx's hash so a later put knows whether Excel changed it. */
function page({ title, sheets, xlsxName, hash }) {
  const part = (file) => readFileSync(join(RUNTIME, file), "utf8").trim();
  const data = {
    title,
    sheets: sheets.map((sheet) => {
      const end = sheet.totals ?? sheet.cells.length;
      return {
        name: sheet.name,
        columns: sheet.columns.map(({ name, format, num, width }) => ({
          name,
          format: format ?? null,
          num,
          width,
        })),
        rows: sheet.cells.slice(1, end).map((row) =>
          sheet.columns.map((_, c) => {
            const cell = row[c] ?? {};
            return cell.f === undefined
              ? { v: cell.v ?? null }
              : { v: cell.v ?? null, f: cell.f };
          }),
        ),
        totals: sheet.totalsSpec ?? null,
      };
    }),
  };
  const escape = (text) =>
    String(text).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  return wear(
    part("sheet.html")
      .replaceAll("{{title}}", escape(title))
      .replace("{{xlsx.hash}}", hash)
      .replace("{{xlsx.file}}", () => escape(encodeURIComponent(xlsxName)))
      // The workbook in place of the template's empty one; `<` escaped, so no text closes the tag
      .replace(
        '<script type="application/json" id="sheet-data">null</script>',
        () =>
          `<script type="application/json" id="sheet-data">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`,
      )
      .replace("/* sheet.css */", () => part("sheet.css"))
      // The formula engine, whole, so an edit made in the page is worked out as the file will be
      .replace(
        "// formula.mjs",
        () =>
          `const Formula = (() => {\n${part("formula.mjs").replace(/^export /gm, "")}\nreturn { workOut, moveRefs, fillDown, parse, FormulaError, colName };\n})();`,
      )
      .replace("// format.mjs", () =>
        part("format.mjs").replace(/^export /gm, ""),
      )
      .replace("// sheet.js", () => part("sheet.js")),
  );
}

/** The .xlsx and its page written, over nothing the user changed since. */
function write(name, sheets, title, over) {
  const { folder, xlsx, page: pagePath } = filesFor(name);
  if (existsSync(xlsx) && !over) {
    const kept = drawnHash(pagePath);
    if (kept !== hashOf(readFileSync(xlsx)) || userChanged(pagePath))
      throw new Stop(
        `${shown(xlsx)} was changed after it was last written — in Excel, in the app, or by hand. Read it first (node ${SCRIPT} read ${name}), make your change from what it holds now, then put again with --over.`,
      );
  }
  const bytes = writeXlsx({ sheets });
  mkdirSync(folder, { recursive: true });
  writeFileSync(xlsx, bytes);
  const hash = hashOf(bytes);
  writeFileSync(
    pagePath,
    page({ title: title || name, sheets, xlsxName: basename(xlsx), hash }),
  );
  return { xlsx, pagePath };
}

function put(name, from, flags) {
  if (!from || !existsSync(from))
    throw new Stop(
      `No file ${from ?? ""}. Give a book.json or a CSV: node ${SCRIPT} put <name> <file>`,
    );
  filesFor(name);
  let model;
  if (extname(from).toLowerCase() === ".csv")
    model = fromCsv(readFileSync(from, "utf8"), name);
  else {
    let spec;
    try {
      spec = JSON.parse(readFileSync(from, "utf8"));
    } catch (failed) {
      throw new Stop(`${from} is not JSON: ${failed.message}`);
    }
    model = spec;
  }
  const described = fromDescription(model);
  const sheets = build(described);
  const title = typeof flags.title === "string" ? flags.title : described.title;
  const { xlsx, pagePath } = write(name, sheets, title, Boolean(flags.over));
  const rows = sheets
    .map(
      (s) =>
        `${s.name} ${s.cells.length - 1 - (s.totals === null ? 0 : 1)} rows`,
    )
    .join(", ");
  console.log(
    `Wrote ${shown(xlsx)} (${rows}) and its page ${shown(pagePath)}. Hand back both paths: the page opens in the app, the .xlsx in Excel. To see it: node ${SCRIPT} shots ${name}`,
  );
}

// ── reading one ────────────────────────────────────────────────────────────

/** A workbook named or pointed at, and where its page goes. */
function workbookAt(arg, flags = {}) {
  if (!arg) throw new Stop("Give a sheet's name or an .xlsx path.");
  if (/\.xlsx$/i.test(arg)) {
    const file = resolve(arg);
    if (!existsSync(file)) throw new Stop(`No file ${arg}.`);
    const name =
      typeof flags.name === "string"
        ? flags.name
        : basename(file, extname(file))
            .replace(/[^\p{L}\p{N}_-]+/gu, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80) || "sheet";
    return { file, name };
  }
  if (/\.xls$/i.test(arg))
    throw new Stop(
      "An .xls is Excel's old format, which this cannot read: open it in Excel or Numbers and save it as .xlsx, or ask the user to.",
    );
  const { xlsx } = filesFor(arg);
  if (!existsSync(xlsx))
    throw new Stop(
      `No sheet ${shown(xlsx)}. Make one: node ${SCRIPT} put ${arg} <book.json | data.csv>`,
    );
  return { file: xlsx, name: arg };
}

/**
 * A workbook read back. A formula saved with no value beside it — a program other than Excel
 * wrote the file — is worked out here; a value Excel stored stays as Excel had it. `unworked`
 * says why none were worked out, when one of them is a formula this cannot work out.
 */
function readBook(file) {
  let book;
  try {
    book = readXlsx(readFileSync(file));
  } catch (failed) {
    throw new Stop(`${shown(file)}: ${failed.message}`);
  }
  const missing = book.sheets.some((sheet) =>
    sheet.rows.some((row) => row.some((cell) => cell.f && cell.v === null)),
  );
  if (!missing) return book;
  const copies = book.sheets.map((sheet) => ({
    name: sheet.name,
    cells: sheet.rows.map((row) =>
      row.map((cell) => (cell.f ? { f: cell.f } : { v: cell.v })),
    ),
  }));
  try {
    workOut(copies);
  } catch (failed) {
    if (!(failed instanceof FormulaError)) throw failed;
    return { ...book, unworked: failed.message };
  }
  book.sheets.forEach((sheet, s) =>
    sheet.rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (cell.f && cell.v === null) cell.v = copies[s].cells[r][c].v;
      }),
    ),
  );
  return book;
}

/** A value as text; a date, in a column written as dates, as YYYY-MM-DD. */
const text = (v, format) =>
  v === null || v === undefined
    ? ""
    : typeof v === "number" && format && isDateFormat(format)
      ? isoOf(v)
      : typeof v === "object"
        ? v.error
        : typeof v === "boolean"
          ? v
            ? "TRUE"
            : "FALSE"
          : String(v);

function read(arg, flags) {
  const { file } = workbookAt(arg, flags);
  const { sheets, unworked } = readBook(file);
  const most = Math.max(1, Number(flags.rows) || 20);
  const out = [
    `${shown(file)}: ${sheets.length} sheet${sheets.length === 1 ? "" : "s"}.`,
  ];
  if (unworked)
    out.push(
      `Formulas saved without their values are left empty: ${unworked}. Opening the file in Excel and saving it stores them.`,
    );
  for (const sheet of sheets) {
    const width = sheet.rows[0]?.length ?? 0;
    out.push(
      "",
      `## ${sheet.name} — ${Math.max(0, sheet.rows.length - 1)} rows under a header, ${width} columns (A–${colName(Math.max(0, width - 1))})`,
    );
    const cellText = (cell, r, c) =>
      text(cell.v, r > 0 ? sheet.formats[c] : null);
    sheet.rows.slice(0, most + 1).forEach((row, r) => {
      out.push(row.map((cell, c) => cellText(cell, r, c)).join("\t"));
    });
    if (sheet.rows.length > most + 1)
      out.push(`… ${sheet.rows.length - most - 1} more rows`);
    const formulas = [];
    sheet.rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (cell.f) formulas.push(`${colName(c)}${r + 1} ${cell.f}`);
      }),
    );
    if (formulas.length)
      out.push(
        `Formulas (${formulas.length}): ${formulas.slice(0, 12).join("; ")}${formulas.length > 12 ? "; …" : ""}`,
      );
  }
  if (typeof flags.json === "string") {
    const pagePath = /\.xlsx$/i.test(arg) ? null : filesFor(arg).page;
    // A row on one line, so the rows read as a table
    const spec = describe(fromXlsx(sheets), titleOf(pagePath));
    const rows = [];
    for (const sheet of spec.sheets)
      sheet.rows = sheet.rows.map((row) => `\u0000${rows.push(row) - 1}`);
    writeFileSync(
      flags.json,
      `${JSON.stringify(spec, null, 2).replace(/"\\u0000(\d+)"/g, (_, n) =>
        JSON.stringify(rows[Number(n)]),
      )}\n`,
    );
    out.push(
      `Wrote ${shown(resolve(flags.json))}: the whole workbook as put takes it. Change it there and put it back${pagePath ? ` (node ${SCRIPT} put ${arg} ${flags.json} --over)` : ""}; a column worked out by one formula has it as its "formula".`,
    );
  }
  if (typeof flags.csv === "string") {
    mkdirSync(flags.csv, { recursive: true });
    for (const sheet of sheets) {
      const path = join(
        flags.csv,
        `${sheet.name.replace(/[\\/:*?"<>|]+/g, "-")}.csv`,
      );
      const csv = sheet.rows
        .map((row, r) =>
          row
            .map((cell, c) => {
              const t = text(cell.v, r > 0 ? sheet.formats[c] : null);
              return /[",\n]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
            })
            .join(","),
        )
        .join("\n");
      writeFileSync(path, `${csv}\n`);
      out.push(`Wrote ${path}`);
    }
  }
  console.log(out.join("\n"));
}

/** A workbook read back into sheets the page draws: the SUBTOTAL row found again as the totals. */
function fromXlsx(sheets) {
  const back = Object.fromEntries(
    Object.entries(TOTALS).map(([fn, n]) => [n, fn]),
  );
  return sheets.map((sheet) => {
    const [header = [], ...rest] = sheet.rows;
    const width = header.length;
    const columns = header.map((cell, c) => ({
      name: text(cell.v) || colName(c),
    }));
    let totals = null;
    const last = rest.at(-1);
    if (last?.some((cell) => /^=SUBTOTAL\(/i.test(cell.f ?? ""))) {
      totals = {
        label: text(last[0]?.v) || "Total",
        cells: last.map((cell) => {
          const n = /^=SUBTOTAL\((\d+)/i.exec(cell.f ?? "")?.[1];
          return n ? (back[Number(n)] ?? back[Number(n) + 100] ?? "sum") : null;
        }),
      };
    }
    const cells = [header, ...rest.slice(0, totals ? -1 : undefined)];
    return {
      name: sheet.name,
      cells: totals ? [...cells, last] : cells,
      totals: totals ? cells.length : null,
      totalsSpec: totals,
      columns: columns.map((column, c) => {
        const format =
          sheet.formats[c] && !checkFormat(sheet.formats[c])
            ? sheet.formats[c]
            : undefined;
        const values = rest
          .map((row) => row[c]?.v ?? null)
          .filter((v) => v !== null);
        return {
          ...column,
          format,
          num:
            values.length > 0 &&
            values.filter((v) => typeof v === "number").length >=
              values.length / 2,
          width:
            sheet.widths[c] ??
            widthOf([
              column.name,
              ...rest
                .slice(0, 200)
                .map((row) => formatValue(row[c]?.v ?? null, format)),
            ]),
        };
      }),
      width,
    };
  });
}

/** The title a sheet's page carries, or null. */
function titleOf(pagePath) {
  if (!pagePath || !existsSync(pagePath)) return null;
  try {
    return (
      JSON.parse(DATA.exec(readFileSync(pagePath, "utf8"))?.[1] ?? "null")
        ?.title ?? null
    );
  } catch {
    return null;
  }
}

/**
 * A workbook read back as the description put takes (references/sheet.md): a column whose
 * every row holds one formula filled down has it as its `formula`, other formulas stay in their
 * cells, and the totals row is `totals` again. An error Excel saved in a cell is left empty.
 */
function describe(drawn, title) {
  return {
    ...(title ? { title } : {}),
    sheets: drawn.map((sheet) => {
      const end = sheet.totals ?? sheet.cells.length;
      const rows = sheet.cells.slice(1, end);
      const width = sheet.columns.length;
      const formulas = sheet.columns.map((_, c) => {
        if (!rows.length || !rows.every((row) => row[c]?.f)) return null;
        const template = asColumnFormula(rows[0][c].f, 2);
        return template &&
          rows.every(
            (row, i) => template.replaceAll("{r}", String(i + 2)) === row[c].f,
          )
          ? template
          : null;
      });
      const value = (cell, c) => {
        const v = cell?.v ?? null;
        if (v !== null && typeof v === "object") return null;
        const format = sheet.columns[c].format;
        return typeof v === "number" && format && isDateFormat(format)
          ? isoOf(v)
          : v;
      };
      return {
        name: sheet.name,
        columns: sheet.columns.map((column, c) => ({
          name: column.name,
          ...(column.format ? { format: column.format } : {}),
          ...(formulas[c] ? { formula: formulas[c] } : {}),
        })),
        rows: rows.map((row) =>
          Array.from({ length: width }, (_, c) =>
            formulas[c] ? null : row[c]?.f ? { f: row[c].f } : value(row[c], c),
          ),
        ),
        ...(sheet.totalsSpec
          ? {
              totals: {
                label: sheet.totalsSpec.label,
                ...Object.fromEntries(
                  sheet.totalsSpec.cells
                    .map((fn, c) => [sheet.columns[c]?.name, fn])
                    .filter(([, fn]) => fn),
                ),
              },
            }
          : {}),
      };
    }),
  };
}

function view(arg, flags) {
  const { file, name } = workbookAt(arg, flags);
  const { sheets, unworked } = readBook(file);
  const drawn = fromXlsx(sheets);
  const { folder, xlsx, page: pagePath } = filesFor(name);
  mkdirSync(folder, { recursive: true });
  if (resolve(file) !== resolve(xlsx)) {
    if (
      existsSync(xlsx) &&
      hashOf(readFileSync(xlsx)) !== hashOf(readFileSync(file))
    )
      throw new Stop(
        `${shown(xlsx)} already holds another workbook. Give this one another name: --name <name>.`,
      );
    copyFileSync(file, xlsx);
  }
  const hash = hashOf(readFileSync(xlsx));
  const title =
    typeof flags.title === "string" ? flags.title : (titleOf(pagePath) ?? name);
  writeFileSync(
    pagePath,
    page({ title, sheets: drawn, xlsxName: basename(xlsx), hash }),
  );
  console.log(
    `Drew ${shown(pagePath)} from ${shown(xlsx)}. Hand back the page; the .xlsx stays the file.${unworked ? ` Formulas saved without their values show empty: ${unworked}.` : ""}`,
  );
}

// ── an edit made in the page ───────────────────────────────────────────────

const DATA =
  /<script type="application\/json" id="sheet-data">([\s\S]*?)<\/script>/;

/** A file written beside itself and moved into place, so it is never half written. */
function writeAtomic(file, content) {
  const beside = `${file}.${process.pid}.saving`;
  writeFileSync(beside, content);
  try {
    renameSync(beside, file);
  } catch (failed) {
    rmSync(beside, { force: true });
    throw failed;
  }
}

/** A sheet's page holding `sheets` and naming the .xlsx they are in, its head left as it is. */
function withBook(html, sheets, xlsx, hash) {
  // Drawn from what the user changed: a bot's next put reads it first (userChanged)
  let title = basename(xlsx, ".xlsx");
  try {
    title = JSON.parse(DATA.exec(html)?.[1] ?? "null")?.title || title;
  } catch {}
  const fresh = page({ title, sheets, xlsxName: basename(xlsx), hash });
  return html
    .replace(
      /<meta name="sheet-xlsx" content="[0-9a-f]*"( data-edited)?/,
      EDITED(hash),
    )
    .replace(DATA, () => DATA.exec(fresh)[0]);
}

/**
 * The workbook a page edited in the app holds, written into the .xlsx beside the page it
 * replaces. A formula that no longer works out keeps its error code in its cell, as Excel shows
 * it, rather than stop the save. The .xlsx changed since the page drew it — in Excel — stops.
 */
function sync(edited, flags) {
  const pagePath = typeof flags.page === "string" ? resolve(flags.page) : null;
  if (!edited || !existsSync(edited) || !pagePath || !existsSync(pagePath))
    throw new Stop(`Give the edited page and --page <page.html>.`);
  const xlsx = join(
    dirname(pagePath),
    `${basename(pagePath, extname(pagePath))}.xlsx`,
  );
  // Changed since the page drew it: the page is drawn again from the file, under a new
  // revision, and exit 3 has the app tell the open page as it does of a page written since —
  // its Reload then shows the file as it is, not the page the edit came from
  if (existsSync(xlsx) && drawnHash(pagePath) !== hashOf(readFileSync(xlsx))) {
    const bytes = readFileSync(xlsx);
    const { sheets, unworked } = readBook(xlsx);
    const now = readFileSync(pagePath, "utf8");
    writeAtomic(
      pagePath,
      withBook(now, fromXlsx(sheets), xlsx, hashOf(bytes)).replace(
        /<meta name="revision" content="[^"]*">/,
        `<meta name="revision" content="${revision()}">`,
      ),
    );
    console.error(
      `${shown(xlsx)} was changed after this page drew it — in Excel, or by a bot.${unworked ? ` Formulas saved without their values show empty: ${unworked}.` : ""}`,
    );
    process.exitCode = 3;
    return;
  }
  const html = readFileSync(edited, "utf8");
  let data;
  try {
    data = JSON.parse(DATA.exec(html)?.[1] ?? "null");
  } catch {
    data = null;
  }
  if (!data || !Array.isArray(data.sheets))
    throw new Stop("The page holds no workbook to keep.");
  const described = fromDescription({
    title: data.title,
    sheets: data.sheets.map((sheet) => ({
      name: sheet?.name,
      columns: (sheet?.columns ?? []).map((column) => ({
        name: column?.name,
        format: column?.format ?? undefined,
        width: typeof column?.width === "number" ? column.width : undefined,
      })),
      rows: (sheet?.rows ?? []).map((row) =>
        (Array.isArray(row) ? row : []).map((cell) =>
          typeof cell?.f === "string" ? { f: cell.f } : (cell?.v ?? null),
        ),
      ),
      totals: sheet?.totals
        ? {
            label: sheet.totals.label,
            ...Object.fromEntries(
              (sheet.totals.cells ?? [])
                .map((fn, c) => [sheet.columns?.[c]?.name, fn])
                .filter(([, fn]) => fn),
            ),
          }
        : undefined,
    })),
  });
  const sheets = build(described, []);
  const bytes = writeXlsx({ sheets });
  writeAtomic(xlsx, bytes);
  // The edited page keeps its own head and shell; only what the .xlsx now holds is new
  writeFileSync(edited, withBook(html, sheets, xlsx, hashOf(bytes)));
  console.log(`Wrote ${shown(xlsx)}.`);
}

function shots(name) {
  const { page: pagePath } = filesFor(name);
  if (!existsSync(pagePath)) throw new Stop(`No sheet ${shown(pagePath)}.`);
  const out = join(WORKSPACE, "scratch", `${name}-sheet-shots`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const done = spawnSync(
    process.execPath,
    [
      join(SKILLS, "artifact", "runtime", "render.mjs"),
      pagePath,
      "--out",
      out,
      "--size",
      "1280x800",
      "--most",
      "1",
      "--name",
      "sheet",
      "--apart",
    ],
    { stdio: "inherit" },
  );
  if (done.status !== 0)
    throw new Stop("Fix what it names above, then run this again.");
  console.log(`Look at it with look_at, from ${shown(out)}.`);
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const [command, ...rest] = positional;
try {
  if (command === "put") put(rest[0], rest[1], flags);
  else if (command === "read") read(rest[0], flags);
  else if (command === "view") view(rest[0], flags);
  else if (command === "shots") shots(rest[0]);
  else if (command === "sync") sync(rest[0], flags);
  else
    throw new Stop(
      `${usage()}\nFunctions a formula may use: ${FUNCTIONS.join(", ")}. A cell elsewhere: ${sheetRef("Other sheet")}!B2.`,
    );
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
