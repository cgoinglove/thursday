// A workbook as an .xlsx file and back, with no spreadsheet library: an .xlsx is a zip of a few
// XML files (Office Open XML, ECMA-376), and fflate zips. Written: the sheets, each a header row,
// its rows and a totals row; numbers, text, booleans and formulas with the value each holds;
// the header bold and frozen with a filter on it, column widths, number formats. Read: every
// sheet's cells, the value Excel last stored for each formula and the formula when it is
// written out, dates as Excel's day numbers with their format, column widths and number formats.
import { strFromU8, strToU8, unzipSync, zipSync } from "../vendor/fflate.mjs";
import { checkFormat, xlsxFormat } from "./format.mjs";
import { colIndex, colName } from "./formula.mjs";

const xml = (text) =>
  String(text)
    // Characters XML 1.0 cannot hold at all
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const unxml = (text) =>
  text
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(Number.parseInt(n, 16)),
    )
    .replaceAll("&amp;", "&");

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

/** A sheet's name quoted for a formula or a defined name. */
export const sheetRef = (name) => `'${name.replaceAll("'", "''")}'`;

/**
 * The .xlsx of `book`: `{ sheets: [{ name, columns: [{ name, width, format }], cells, totals }] }`,
 * `cells` rows of `{ v, f }` with row 0 the header, `totals` the index of the totals row or null.
 * `width` is in characters, as Excel counts them.
 */
export function writeXlsx(book) {
  // Formats and looks as Excel indexes them: each distinct one once
  const formats = [];
  const formatId = (code) => {
    const kept = xlsxFormat(code);
    if (kept === "General") return 0;
    const builtIn = {
      0: 1,
      "0.00": 2,
      "#,##0": 3,
      "#,##0.00": 4,
      "0%": 9,
      "0.00%": 10,
    }[kept];
    if (builtIn) return builtIn;
    let at = formats.indexOf(kept);
    if (at === -1) at = formats.push(kept) - 1;
    return 164 + at;
  };
  const looks = ["0|0|0|0"];
  const look = (fmt, bold, fill, line) => {
    const key = `${fmt}|${bold ? 1 : 0}|${fill ? 1 : 0}|${line ? 1 : 0}`;
    let at = looks.indexOf(key);
    if (at === -1) at = looks.push(key) - 1;
    return at;
  };

  const sheetXml = book.sheets.map((sheet) => {
    const ids = sheet.columns.map((column) => formatId(column.format));
    const last = sheet.cells.length;
    const width = sheet.columns.length;
    const rows = sheet.cells.map((row, r) => {
      const head = r === 0;
      const total = r === sheet.totals;
      const cells = row.map((cell, c) => {
        const ref = `${colName(c)}${r + 1}`;
        const s = look(head ? 0 : ids[c], head || total, head, total);
        const style = s ? ` s="${s}"` : "";
        const { v, f } = cell ?? {};
        const formula =
          f !== undefined ? `<f>${xml(String(f).replace(/^=/, ""))}</f>` : "";
        if (v === null || v === undefined || v === "")
          return formula
            ? `<c r="${ref}"${style}>${formula}</c>`
            : style
              ? `<c r="${ref}"${style}/>`
              : "";
        if (typeof v === "object" && "error" in v)
          return `<c r="${ref}"${style} t="e">${formula}<v>${xml(v.error)}</v></c>`;
        if (typeof v === "number")
          return `<c r="${ref}"${style}>${formula}<v>${v}</v></c>`;
        if (typeof v === "boolean")
          return `<c r="${ref}"${style} t="b">${formula}<v>${v ? 1 : 0}</v></c>`;
        if (formula)
          return `<c r="${ref}"${style} t="str">${formula}<v>${xml(v)}</v></c>`;
        return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
      });
      return `<row r="${r + 1}">${cells.join("")}</row>`;
    });
    const cols = sheet.columns
      .map(
        (column, c) =>
          `<col min="${c + 1}" max="${c + 1}" width="${column.width}" customWidth="1"/>`,
      )
      .join("");
    const dataEnd = sheet.totals ?? last;
    const filter =
      width && dataEnd > 1
        ? `<autoFilter ref="A1:${colName(width - 1)}${dataEnd}"/>`
        : "";
    return {
      filter: filter
        ? `${sheetRef(sheet.name)}!$A$1:$${colName(width - 1)}$${dataEnd}`
        : null,
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${MAIN}" xmlns:r="${REL}"><sheetViews><sheetView workbookViewId="0"${book.sheets.indexOf(sheet) === 0 ? ' tabSelected="1"' : ""}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${rows.join("")}</sheetData>${filter}</worksheet>`,
    };
  });

  const numFmts = formats.length
    ? `<numFmts count="${formats.length}">${formats.map((code, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(code)}"/>`).join("")}</numFmts>`
    : "";
  const xfs = looks.map((key) => {
    const [fmt, bold, fill, line] = key.split("|").map(Number);
    return `<xf numFmtId="${fmt}" fontId="${bold}" fillId="${fill ? 2 : 0}" borderId="${line}" xfId="0"${fmt ? ' applyNumberFormat="1"' : ""}${bold ? ' applyFont="1"' : ""}${fill ? ' applyFill="1"' : ""}${line ? ' applyBorder="1"' : ""}/>`;
  });
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${MAIN}">${numFmts}<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F4F7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF8C959F"/></top><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const names = sheetXml
    .map((s, i) =>
      s.filter
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xml(s.filter)}</definedName>`
        : "",
    )
    .join("");
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${book.sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${names ? `<definedNames>${names}</definedNames>` : ""}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  const n = book.sheets.length;
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${book.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": workbook,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG}">${book.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": styles,
  };
  sheetXml.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = s.text;
  });
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
    ),
    { level: 6, mtime: new Date("2026-01-01T00:00:00Z") },
  );
}

// ── reading one ────────────────────────────────────────────────────────────

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? unxml(m[1]) : null;
};
/** Every piece of text inside `inside` (a shared string, an inline one, rich text or not). */
const texts = (inside) =>
  [...inside.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((m) => unxml(m[1]))
    .join("");

/**
 * Excel's own date and time formats by their number, as codes this sheet draws: the ones that
 * follow the reader's locale in Excel are written the one way everywhere.
 */
const BUILTIN_DATES = {
  14: "yyyy-mm-dd",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "yyyy-mm-dd h:mm",
  27: "yyyy-mm-dd",
  30: "yyyy-mm-dd",
  36: "yyyy-mm-dd",
  45: "mm:ss",
  46: "h:mm:ss",
  47: "mm:ss",
  50: "yyyy-mm-dd",
  57: "yyyy-mm-dd",
};

/**
 * An .xlsx read back: `{ sheets: [{ name, rows, widths, formats }] }`, `rows` of `{ v, f }` with
 * the value Excel stored and the formula when it is written out (a shared one's copies carry
 * the value alone), `widths` in characters and `formats` each column's first format code.
 */
export function readXlsx(bytes) {
  let files;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error(
      "It is not an .xlsx file: it does not open as one (an old .xls, or a damaged file?).",
    );
  }
  const text = (path) => (files[path] ? strFromU8(files[path]) : null);
  const workbook = text("xl/workbook.xml");
  if (!workbook)
    throw new Error("It is not an .xlsx file: it has no workbook in it.");
  const rels = new Map(
    [
      ...(text("xl/_rels/workbook.xml.rels") ?? "").matchAll(
        /<Relationship\b[^>]*>/g,
      ),
    ].map((m) => [attr(m[0], "Id"), attr(m[0], "Target")]),
  );
  const shared = [
    ...(text("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map((m) => texts(m[1]));
  const stylesXml = text("xl/styles.xml") ?? "";
  const codes = new Map(
    [...stylesXml.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [
      Number(attr(m[0], "numFmtId")),
      attr(m[0], "formatCode"),
    ]),
  );
  const xfBlock =
    /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  const xfFormats = [...xfBlock.matchAll(/<xf\b[^>]*>/g)].map((m) =>
    Number(attr(m[0], "numFmtId") ?? 0),
  );
  const isDate = (id) =>
    id in BUILTIN_DATES ||
    /[ydh]/i.test(
      (codes.get(id) ?? "")
        .replace(/"[^"]*"/g, "")
        .replace(/\[[^\]]*\]/g, "")
        .replace(/\\./g, ""),
    );
  // A date's own code when the sheet draws it, else a date all the same: never a bare number
  const codeOf = (id) => {
    const code =
      BUILTIN_DATES[id] ??
      { 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%" }[
        id
      ] ??
      codes.get(id) ??
      null;
    if (!isDate(id) || (code && !checkFormat(code))) return code;
    // Hours counted past a day ([h]:mm) are a length of time, not a date: left a number
    if (/\[[hms]+\]/i.test(code ?? "")) return null;
    return /h/i.test(code ?? "") ? "yyyy-mm-dd hh:mm" : "yyyy-mm-dd";
  };

  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const name = attr(m[0], "name");
    const target = rels.get(attr(m[0], "r:id")) ?? "";
    const path = target.startsWith("/")
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, "")}`;
    const body = text(path) ?? "";
    const rows = [];
    const formats = [];
    for (const cell of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cell[1], "r");
      const at = ref && /^([A-Z]+)(\d+)$/.exec(ref);
      if (!at) continue;
      const [r, c] = [Number(at[2]) - 1, colIndex(at[1])];
      const type = attr(cell[1], "t");
      const styleId = xfFormats[Number(attr(cell[1], "s") ?? 0)] ?? 0;
      const inside = cell[2] ?? "";
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inside)?.[1];
      const f = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(inside)?.[1];
      let v = null;
      if (type === "s") v = shared[Number(raw)] ?? null;
      else if (type === "inlineStr") v = texts(inside);
      else if (type === "str") v = raw === undefined ? null : unxml(raw);
      else if (type === "b") v = raw === "1";
      else if (type === "e")
        v = raw === undefined ? null : { error: unxml(raw) };
      else if (raw !== undefined) {
        v = Number(raw);
      }
      rows[r] ??= [];
      rows[r][c] = { v, ...(f ? { f: `=${unxml(f)}` } : {}) };
      if (r > 0 && formats[c] === undefined && typeof v === "number")
        formats[c] = codeOf(styleId);
    }
    const widths = [];
    for (const col of body.matchAll(/<col\b[^>]*>/g)) {
      const width = Number(attr(col[0], "width"));
      for (
        let c = Number(attr(col[0], "min"));
        c <= Number(attr(col[0], "max")) && c <= 200;
        c++
      )
        widths[c - 1] = width;
    }
    // Rows with nothing in them are holes in `rows`, which map() would skip
    let wide = 0;
    for (let r = 0; r < rows.length; r++)
      wide = Math.max(wide, rows[r]?.length ?? 0);
    const full = Array.from({ length: rows.length }, (_, r) =>
      Array.from({ length: wide }, (_, c) => rows[r]?.[c] ?? { v: null }),
    );
    return { name, rows: full, widths, formats };
  });
  return { sheets };
}
