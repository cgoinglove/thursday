// Spreadsheets: a workbook read as a short summary a model can reason over (shape, columns,
// their types and ranges, formulas, the first rows), and one written from JSON with
// headers, number formats, formulas and a totals row.
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { input, kit, output, readJson, Stop, shown } from "./kit.mjs";

/** A cell's value as it reads: a formula's result, rich text as its text, a link as its words. */
function plain(value) {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;
  if ("result" in value) return plain(value.result);
  if ("formula" in value || "sharedFormula" in value) return null;
  if (Array.isArray(value.richText))
    return value.richText.map((r) => r.text).join("");
  if ("text" in value) return plain(value.text);
  if ("error" in value) return `#${value.error}`;
  return String(value);
}

const short = (v, n = 32) => {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

const fmt = (n) =>
  Math.abs(n) >= 1e6
    ? new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(n)
    : Math.abs(n) < 0.01 && n !== 0
      ? String(Number(n.toPrecision(3)))
      : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

async function loadBook(file) {
  const { default: ExcelJS } = await kit("exceljs");
  const book = new ExcelJS.Workbook();
  if (extname(file).toLowerCase() === ".csv") await book.csv.readFile(file);
  else await book.xlsx.readFile(file);
  return book;
}

/** Rows of one sheet as arrays of plain values, with its formulas and merged ranges counted. */
function sheetRows(ws) {
  const rows = [];
  const formulas = [];
  // A row whose formulas sum the column above it holds totals, not data
  const totals = new Set();
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      const v = cell.value;
      if (
        v &&
        typeof v === "object" &&
        ("formula" in v || "sharedFormula" in v)
      ) {
        formulas.push(
          `${cell.address} =${v.formula ?? `(shared ${v.sharedFormula})`}`,
        );
        if (/^SUBTOTAL\(|^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/i.test(v.formula ?? ""))
          totals.add(r - 1);
      }
      // A merged range reads once, at its top-left cell
      cells[c - 1] = cell.isMerged && cell.master !== cell ? null : plain(v);
    });
    rows[r - 1] = cells;
  });
  return { rows: Array.from(rows, (r) => r ?? []), formulas, totals };
}

/** The first row whose cells are mostly words and which has rows under it: the header. */
function headerRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const filled = rows[i].filter((v) => v != null && v !== "");
    if (filled.length < 2) continue;
    const words = filled.filter(
      (v) => typeof v === "string" && !/^[\d.,%$€£¥₩-]+$/.test(v),
    );
    if (words.length >= filled.length * 0.6 && rows.length > i + 1) return i;
  }
  return -1;
}

function describeColumn(name, values) {
  const filled = values.filter((v) => v != null && v !== "");
  const numbers = filled.filter((v) => typeof v === "number");
  const dates = filled.filter((v) => v instanceof Date);
  const blanks = values.length - filled.length;
  const tail = blanks ? `, ${blanks} blank` : "";
  if (!filled.length) return `- ${name}: empty`;
  if (numbers.length >= filled.length * 0.8) {
    const sum = numbers.reduce((a, b) => a + b, 0);
    return `- ${name}: number — min ${fmt(Math.min(...numbers))}, max ${fmt(Math.max(...numbers))}, sum ${fmt(sum)}, mean ${fmt(sum / numbers.length)}${numbers.length < filled.length ? `, ${filled.length - numbers.length} not numbers` : ""}${tail}`;
  }
  if (dates.length >= filled.length * 0.8) {
    const times = dates.map((d) => d.getTime());
    return `- ${name}: date — ${short(new Date(Math.min(...times)))} to ${short(new Date(Math.max(...times)))}${tail}`;
  }
  const counts = new Map();
  for (const v of filled)
    counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
  const top = [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([v, n]) => `${short(v, 24)} (${n})`)
    .join(", ");
  return `- ${name}: text — ${counts.size} distinct${counts.size < filled.length ? `, most: ${top}` : ""}${tail}`;
}

const tableLine = (cells) =>
  `| ${cells.map((c) => short(c).replace(/\|/g, "/")).join(" | ")} |`;

/** A workbook, sheet by sheet, in a few hundred characters each. */
export async function summarize(file, opts) {
  const book = await loadBook(file);
  const show = Number(opts.rows ?? 8);
  const out = [];
  const sheets = book.worksheets.filter(
    (ws) => !opts.sheet || ws.name === opts.sheet,
  );
  if (!sheets.length)
    throw new Stop(
      `No sheet "${opts.sheet}". Sheets: ${book.worksheets.map((w) => w.name).join(", ")}`,
    );
  for (const ws of sheets) {
    const { rows, formulas, totals } = sheetRows(ws);
    const width = Math.max(0, ...rows.map((r) => r.length));
    const merged = Object.keys(ws._merges ?? {}).length;
    out.push(
      `## ${ws.name} — ${rows.length} rows × ${width} columns${ws.state && ws.state !== "visible" ? " (hidden)" : ""}${merged ? `, ${merged} merged ranges` : ""}${formulas.length ? `, ${formulas.length} formulas` : ""}`,
    );
    if (!rows.length) continue;
    const h = headerRow(rows);
    const names = Array.from({ length: width }, (_, c) =>
      h >= 0 && rows[h][c] != null && rows[h][c] !== ""
        ? short(rows[h][c], 40)
        : `column ${c + 1}`,
    );
    const all = rows.slice(h + 1);
    const body = all.filter((_, i) => !totals.has(h + 1 + i));
    if (h > 0)
      out.push(
        `Header on row ${h + 1}; rows above it: ${rows
          .slice(0, h)
          .map((r) =>
            r
              .filter(Boolean)
              .map((v) => short(v))
              .join(" "),
          )
          .filter(Boolean)
          .join(" / ")}`,
      );
    out.push(
      `Columns (${body.length} data rows${totals.size ? `; row ${[...totals].map((i) => i + 1).join(", ")} holds totals, left out of these figures` : ""}):`,
    );
    for (let c = 0; c < width; c++)
      out.push(
        describeColumn(
          names[c],
          body.map((r) => r[c] ?? null),
        ),
      );
    if (formulas.length)
      out.push(
        `Formulas, first ${Math.min(5, formulas.length)}: ${formulas.slice(0, 5).join("; ")}`,
      );
    out.push(`First ${Math.min(show, all.length)} rows:`);
    out.push(tableLine(names));
    for (const r of all.slice(0, show))
      out.push(tableLine(Array.from({ length: width }, (_, c) => r[c] ?? "")));
    if (opts.csv && sheets.length === 1) {
      const path = output(opts.csv, ws.name, "csv");
      const csv = [names, ...all]
        .map((r) =>
          Array.from({ length: width }, (_, c) => {
            const v = r[c];
            const s =
              v instanceof Date
                ? v.toISOString().slice(0, 10)
                : String(v ?? "");
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          }).join(","),
        )
        .join("\n");
      writeFileSync(path, `${csv}\n`);
      out.push(`Written as CSV: ${shown(path)}`);
    }
  }
  return out.join("\n");
}

/** A CSV file as rows of strings and numbers. */
function readCsv(path) {
  const text = readFileSync(input(path), "utf8").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows
    .filter((r) => !(r.length === 1 && r[0].startsWith("#")))
    .map((r) =>
      r.map((v) => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v)),
    );
}

const colName = (n) => {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26))
    s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
};

const FUNCTIONS = {
  SUM: (xs) => xs.reduce((a, b) => a + b, 0),
  AVERAGE: (xs) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN,
  MIN: (xs) => Math.min(...xs),
  MAX: (xs) => Math.max(...xs),
  COUNT: (xs) => xs.length,
  ROUND: (xs) => {
    const f = 10 ** (xs[1] ?? 0);
    return Math.round(xs[0] * f) / f;
  },
  ABS: (xs) => Math.abs(xs[0]),
};

/**
 * Works out the formulas it can — arithmetic, cell references and ranges, SUM AVERAGE MIN
 * MAX COUNT ROUND ABS on this sheet — so a preview and a read see numbers, not blanks.
 * Anything else stays for the spreadsheet app to compute: `get` answers undefined.
 */
function formulaResults(grid) {
  const memo = new Map();
  const toIndex = (ref) => {
    const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref);
    if (!m) return null;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
    return [Number(m[2]), col];
  };
  const value = (r, c, seen) => {
    const key = `${r},${c}`;
    const raw = grid.get(key);
    if (typeof raw === "string" && raw.startsWith("=")) {
      if (memo.has(key)) return memo.get(key);
      if (seen.has(key)) return undefined;
      seen.add(key);
      const out = run(raw.slice(1), seen);
      memo.set(key, out);
      return out;
    }
    return typeof raw === "number"
      ? raw
      : raw == null || raw === ""
        ? 0
        : undefined;
  };
  function run(src, seen) {
    const tokens = src.match(
      /\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?|[A-Z]+(?=\()|\d+(?:\.\d+)?%?|[-+*/^(),]/g,
    );
    if (!tokens || tokens.join("") !== src.replace(/\s+/g, ""))
      return undefined;
    let i = 0;
    const peek = () => tokens[i];
    const list = (t) => {
      if (t.includes(":")) {
        const [a, b] = t.split(":").map(toIndex);
        const out = [];
        for (let r = Math.min(a[0], b[0]); r <= Math.max(a[0], b[0]); r++)
          for (let c = Math.min(a[1], b[1]); c <= Math.max(a[1], b[1]); c++) {
            const raw = grid.get(`${r},${c}`);
            if (raw == null || raw === "") continue;
            const v = value(r, c, seen);
            if (v === undefined) return undefined;
            if (typeof v === "number") out.push(v);
          }
        return out;
      }
      const v = atom();
      return v === undefined ? undefined : [v];
    };
    const atom = () => {
      const t = tokens[i++];
      if (t === undefined) return undefined;
      if (t === "-") {
        const v = power();
        return v === undefined ? undefined : -v;
      }
      if (t === "+") return power();
      if (t === "(") {
        const v = sum();
        return tokens[i++] === ")" ? v : undefined;
      }
      if (FUNCTIONS[t]) {
        if (tokens[i++] !== "(") return undefined;
        const args = [];
        while (peek() !== ")") {
          const t2 = peek();
          const part = /:/.test(t2 ?? "") ? (i++, list(t2)) : [sum()];
          if (part === undefined || part.includes(undefined)) return undefined;
          args.push(...part);
          if (peek() === ",") i++;
          else if (peek() !== ")") return undefined;
        }
        i++;
        return FUNCTIONS[t](args);
      }
      if (/^\d/.test(t))
        return t.endsWith("%") ? Number(t.slice(0, -1)) / 100 : Number(t);
      const at = toIndex(t);
      return at ? value(at[0], at[1], seen) : undefined;
    };
    const power = () => {
      let v = atom();
      while (peek() === "^") {
        i++;
        const w = atom();
        v = v === undefined || w === undefined ? undefined : v ** w;
      }
      return v;
    };
    const product = () => {
      let v = power();
      while (peek() === "*" || peek() === "/") {
        const op = tokens[i++];
        const w = power();
        v =
          v === undefined || w === undefined
            ? undefined
            : op === "*"
              ? v * w
              : v / w;
      }
      return v;
    };
    const sum = () => {
      let v = product();
      while (peek() === "+" || peek() === "-") {
        const op = tokens[i++];
        const w = product();
        v =
          v === undefined || w === undefined
            ? undefined
            : op === "+"
              ? v + w
              : v - w;
      }
      return v;
    };
    const out = sum();
    return i === tokens.length && Number.isFinite(out) ? out : undefined;
  }
  return (r, c) => value(r, c, new Set());
}

/**
 * A workbook from JSON: `{ sheets: [{ name, columns, rows | csv, total, format }] }`. A cell
 * that starts with `=` is a formula, and `{row}` in it is that cell's own row number.
 */
export async function xlsx(specPath, opts) {
  const spec = readJson(specPath);
  const sheets = spec.sheets ?? (spec.rows || spec.csv ? [spec] : null);
  if (!Array.isArray(sheets) || !sheets.length)
    throw new Stop(
      'The file holds { "sheets": [ { "name", "columns", "rows" } ] }.',
    );
  const { default: ExcelJS } = await kit("exceljs");
  const book = new ExcelJS.Workbook();
  book.calcProperties.fullCalcOnLoad = true;
  const accent = String(spec.accent ?? "1F4E79")
    .replace(/^#/, "")
    .toUpperCase();
  const lines = [];
  for (const [si, sheet] of sheets.entries()) {
    const name = String(sheet.name ?? `Sheet${si + 1}`).slice(0, 31);
    const ws = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    let rows = sheet.rows ?? [];
    let columns = sheet.columns;
    if (sheet.csv) {
      const csv = readCsv(sheet.csv);
      if (!columns) columns = csv.shift();
      else csv.shift();
      rows = csv;
    }
    if (!Array.isArray(columns) || !columns.length)
      throw new Stop(`Sheet "${name}": "columns" names each column.`);
    const cols = columns.map((c) =>
      typeof c === "string" ? { header: c } : c,
    );
    const formats = sheet.format ?? {};
    let formulaCount = 0;
    // Every cell as written first, formulas as text, so each result can be worked out
    const last = rows.length + 1;
    const numeric = cols.map(
      (_, ci) =>
        rows.length > 0 &&
        rows.every(
          (row) =>
            row[ci] == null ||
            typeof row[ci] === "number" ||
            (typeof row[ci] === "string" && row[ci].startsWith("=")),
        ),
    );
    const grid = new Map();
    const table = [cols.map((c) => c.header)];
    rows.forEach((row, ri) => {
      const r = ri + 2;
      table.push(
        cols.map((_, ci) => {
          const v = row[ci];
          if (typeof v === "string" && v.startsWith("="))
            return v.replaceAll("{row}", String(r)).replace(/\s+/g, "");
          if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))
            return new Date(`${v}T00:00:00Z`);
          return v ?? null;
        }),
      );
    });
    if (sheet.total) {
      const which = Array.isArray(sheet.total) ? sheet.total : null;
      table.push(
        cols.map((c, ci) => {
          if (ci === 0) return spec.totalLabel ?? "Total";
          const wanted = which ? which.includes(c.header) : numeric[ci];
          return wanted && rows.length
            ? `=SUM(${colName(ci + 1)}2:${colName(ci + 1)}${last})`
            : null;
        }),
      );
    }
    table.forEach((row, ri) =>
      row.forEach((v, ci) => grid.set(`${ri + 1},${ci + 1}`, v)),
    );
    const result = formulaResults(grid);
    let unsolved = 0;
    table.forEach((row, ri) => {
      const added = ws.addRow(
        row.map((v, ci) => {
          if (typeof v !== "string" || !v.startsWith("=")) return v;
          formulaCount++;
          const got = result(ri + 1, ci + 1);
          if (got === undefined) unsolved++;
          return got === undefined
            ? { formula: v.slice(1) }
            : { formula: v.slice(1), result: got };
        }),
      );
      if (sheet.total && ri === table.length - 1) {
        added.font = { bold: true };
        added.eachCell((cell) => {
          cell.border = { top: { style: "thin", color: { argb: "FF16181D" } } };
        });
      }
    });
    cols.forEach((c, ci) => {
      const column = ws.getColumn(ci + 1);
      const format = c.format ?? formats[c.header];
      if (format) column.numFmt = format;
      else if (numeric[ci]) column.numFmt = "#,##0.##";
      const longest = Math.max(
        String(c.header).length,
        ...rows.slice(0, 500).map((row) => short(row[ci], 80).length),
      );
      column.width = c.width ?? Math.min(60, Math.max(9, longest + 3));
      if (numeric[ci]) column.alignment = { horizontal: "right" };
    });
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.height = 20;
    head.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: `FF${accent}` },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: cell.alignment?.horizontal,
      };
    });
    if (sheet.filter !== false && rows.length)
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: last, column: cols.length },
      };
    lines.push(
      `${name}: ${rows.length} rows × ${cols.length} columns${formulaCount ? `, ${formulaCount} formulas${unsolved ? ` (${unsolved} left for the spreadsheet app to work out)` : ""}` : ""}`,
    );
  }
  const out = output(opts.out, spec.name ?? "workbook", "xlsx");
  await book.xlsx.writeFile(out);
  console.log(
    `${shown(out)}\n${lines.join("\n")}\n\`read\` it to check what landed.`,
  );
}
