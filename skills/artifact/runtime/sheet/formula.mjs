// A sheet's formulas worked out, so the page shows what Excel will: the value each formula
// cell holds, stored in the .xlsx beside it too (Excel works them out again on opening). The
// common functions only; anything else stops rather than show a wrong number.
//
// Coordinates are Excel's: row 1 is the header, column A the first; a value is a number, a
// string, a boolean, null (empty) or { error: "#DIV/0!" }.

/** A formula this file cannot work out, said so the bot can fix it; `code` is what a cell
 * shows instead when the book is worked out leniently (an edit in the page). */
export class FormulaError extends Error {
  constructor(message, code = "#NAME?") {
    super(message);
    this.code = code;
  }
}

/** `A`, `B`, … `Z`, `AA`: a column's letters from its index, counted from 0. */
export const colName = (index) => {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

/** A column's index, counted from 0, from its letters. */
export const colIndex = (letters) => {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export const FUNCTIONS = [
  "SUM",
  "AVERAGE",
  "MIN",
  "MAX",
  "COUNT",
  "COUNTA",
  "SUBTOTAL",
  "SUMIF",
  "COUNTIF",
  "AVERAGEIF",
  "SUMIFS",
  "COUNTIFS",
  "AVERAGEIFS",
  "ROUND",
  "ABS",
  "IF",
  "IFERROR",
  "AND",
  "OR",
  "NOT",
  "CONCAT",
  "DATE",
  "YEAR",
  "MONTH",
  "DAY",
  "EOMONTH",
  "TODAY",
];

/** Days from 1970-01-01 to Excel's day 0 (the 1900 date system). */
const DAY_ZERO = 25569;
const dayOf = (serial) => new Date(Math.floor(serial - DAY_ZERO) * 86400000);
const serialAt = (y, m, d) => Date.UTC(y, m, d) / 86400000 + DAY_ZERO;

const isError = (v) => v !== null && typeof v === "object" && "error" in v;
const error = (code) => ({ error: code });

// ── reading a formula ──────────────────────────────────────────────────────

const REF = String.raw`\$?[A-Za-z]{1,3}\$?\d*`;
const PATTERNS = [
  ["space", /^\s+/],
  ["str", /^"((?:[^"]|"")*)"/],
  ["num", /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/],
  ["fn", /^([A-Za-z][A-Za-z0-9.]*)\s*\(/],
  ["bool", /^(TRUE|FALSE)\b/i],
  ["err", /^(#REF!|#DIV\/0!|#N\/A|#VALUE!|#NAME\?|#NUM!|#NULL!)/],
  [
    "ref",
    new RegExp(
      String.raw`^(?:(?:'((?:[^']|'')+)'|([\p{L}\p{N}_.]+))!)?(${REF})(?::(${REF}))?`,
      "u",
    ),
  ],
  ["op", /^(<>|<=|>=|[-+*/^&=<>%])/],
  ["punct", /^[(),]/],
];

/** One part of a reference: its column and row, either missing for a whole column or row. */
function part(text) {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d*)$/.exec(text);
  if (!match) return null;
  return {
    c: colIndex(match[1]),
    r: match[2] ? Number(match[2]) - 1 : null,
  };
}

function tokenize(text) {
  const tokens = [];
  let rest = text;
  while (rest) {
    let hit = null;
    for (const [kind, re] of PATTERNS) {
      const m = re.exec(rest);
      if (!m) continue;
      hit = { kind, m };
      break;
    }
    if (!hit) throw new FormulaError(`cannot read "${rest.slice(0, 12)}"`);
    const { kind, m } = hit;
    rest = rest.slice(m[0].length);
    if (kind === "space") continue;
    if (kind === "str")
      tokens.push({ t: "str", v: m[1].replaceAll('""', '"') });
    else if (kind === "num") tokens.push({ t: "num", v: Number(m[0]) });
    else if (kind === "fn") tokens.push({ t: "fn", v: m[1].toUpperCase() });
    else if (kind === "bool")
      tokens.push({ t: "bool", v: m[1].toUpperCase() === "TRUE" });
    else if (kind === "err") tokens.push({ t: "err", v: m[1] });
    else if (kind === "ref") {
      const sheet = m[1]?.replaceAll("''", "'") ?? m[2] ?? null;
      const a = part(m[3]);
      const b = m[4] ? part(m[4]) : null;
      if (!a || (m[4] && !b)) throw new FormulaError(`cannot read "${m[0]}"`);
      if (!b && a.r === null)
        throw new FormulaError(
          `"${m[0]}" is not a cell; a column is written ${m[3]}:${m[3]}`,
        );
      tokens.push({ t: "ref", sheet, a, b });
    } else if (kind === "op") tokens.push({ t: "op", v: m[1] });
    else tokens.push({ t: m[0] });
  }
  return tokens;
}

/** A formula as a tree: comparison, &, + -, * /, ^, unary minus, %, then a value. */
export function parse(formula) {
  const tokens = tokenize(String(formula).replace(/^=/, ""));
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const isOp = (...ops) => peek()?.t === "op" && ops.includes(peek().v);
  const binary = (next, ops) => () => {
    let left = next();
    while (isOp(...ops)) {
      const op = take().v;
      left = { k: "bin", op, a: left, b: next() };
    }
    return left;
  };
  const primary = () => {
    const token = take();
    if (!token) throw new FormulaError("ends too soon");
    if (token.t === "num") return { k: "val", v: token.v };
    if (token.t === "str") return { k: "val", v: token.v };
    if (token.t === "bool") return { k: "val", v: token.v };
    if (token.t === "err") return { k: "val", v: error(token.v) };
    if (token.t === "ref") return { k: "ref", ...token };
    if (token.t === "(") {
      const inner = comparison();
      if (take()?.t !== ")") throw new FormulaError("a ( is not closed");
      return inner;
    }
    if (token.t === "fn") {
      if (!FUNCTIONS.includes(token.v))
        throw new FormulaError(
          `${token.v} is not one this sheet works out; use ${FUNCTIONS.join(", ")}, or put the value itself`,
        );
      const args = [];
      if (peek()?.t !== ")") {
        args.push(comparison());
        while (peek()?.t === ",") {
          take();
          args.push(comparison());
        }
      }
      if (take()?.t !== ")")
        throw new FormulaError(`${token.v}( is not closed`);
      return { k: "call", name: token.v, args };
    }
    throw new FormulaError(`did not expect "${token.v ?? token.t}"`);
  };
  const postfix = () => {
    let node = primary();
    while (isOp("%")) {
      take();
      node = { k: "bin", op: "/", a: node, b: { k: "val", v: 100 } };
    }
    return node;
  };
  const unary = () => {
    if (isOp("-")) {
      take();
      return { k: "neg", a: unary() };
    }
    if (isOp("+")) {
      take();
      return unary();
    }
    return postfix();
  };
  const power = binary(unary, ["^"]);
  const product = binary(power, ["*", "/"]);
  const sum = binary(product, ["+", "-"]);
  const concat = binary(sum, ["&"]);
  const comparison = binary(concat, ["=", "<>", "<", ">", "<=", ">="]);
  const tree = comparison();
  if (at < tokens.length)
    throw new FormulaError(`did not expect "${peek().v ?? peek().t}"`);
  return tree;
}

// ── working it out ─────────────────────────────────────────────────────────

const toNumber = (v) => {
  if (isError(v)) return v;
  if (v === null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : error("#VALUE!");
};
const toText = (v) =>
  v === null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v);
const clean = (n) =>
  Number.isFinite(n) ? Number(n.toPrecision(15)) : error("#NUM!");

/** Excel orders numbers before text before booleans; text ignores case. */
function compare(a, b) {
  const rank = (v) =>
    typeof v === "number" || v === null ? 0 : typeof v === "string" ? 1 : 2;
  const [x, y] = [a ?? 0, b ?? 0];
  if (rank(x) !== rank(y)) return rank(x) - rank(y);
  if (typeof x === "string")
    return x.toLowerCase() < y.toLowerCase()
      ? -1
      : x.toLowerCase() > y.toLowerCase()
        ? 1
        : 0;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** A SUMIF/COUNTIF criterion: `>=100`, `<>x`, `=x`, `x`, with * and ? in text. */
function criterion(raw) {
  const text = toText(raw);
  const m = /^(<>|<=|>=|=|<|>)?(.*)$/s.exec(text);
  const op = m[1] ?? "=";
  const operand = m[2];
  const n = operand.trim() === "" ? null : Number(operand);
  const numeric = typeof raw === "number" || (n !== null && Number.isFinite(n));
  const pattern = new RegExp(
    `^${operand
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*")
      .replaceAll("?", ".")}$`,
    "is",
  );
  return (v) => {
    if (isError(v)) return false;
    if (numeric && typeof v === "number") {
      const c = v - (typeof raw === "number" ? raw : n);
      return {
        "=": c === 0,
        "<>": c !== 0,
        "<": c < 0,
        ">": c > 0,
        "<=": c <= 0,
        ">=": c >= 0,
      }[op];
    }
    if (op === "=") return pattern.test(toText(v));
    if (op === "<>") return !pattern.test(toText(v));
    if (numeric) return false;
    const c = compare(toText(v), operand);
    return { "<": c < 0, ">": c > 0, "<=": c <= 0, ">=": c >= 0 }[op];
  };
}

/**
 * Every formula in a workbook worked out. `sheets` is a list of `{ name, cells }`, `cells` rows
 * of `{ v }` or `{ f }` (a formula, `=` or not) with row 0 the header. Each formula cell gets its
 * `v`. A formula that cannot be read, names a sheet or function that is not there, or refers to
 * itself throws a FormulaError naming the cell — or, given a `problems` list, holds that error's
 * code (`#NAME?`, `#REF!`, …) and adds the message to the list, as a cell in Excel would.
 */
export function workOut(sheets, { problems } = {}) {
  const byName = new Map(sheets.map((s) => [s.name.toLowerCase(), s]));
  const trees = new Map();
  const state = new Map(); // "sheet|r|c" → "busy" | "done"

  const sheetOf = (name, from) => {
    if (!name) return from;
    const found = byName.get(name.toLowerCase());
    if (!found) throw new FormulaError(`there is no sheet "${name}"`, "#REF!");
    return found;
  };
  const value = (sheet, r, c) => {
    const cell = sheet.cells[r]?.[c];
    if (!cell) return null;
    if (cell.f === undefined) return cell.v ?? null;
    const key = `${sheet.name}|${r}|${c}`;
    if (state.get(key) === "done") return cell.v;
    if (state.get(key) === "busy")
      throw new FormulaError(
        `${sheet.name}!${colName(c)}${r + 1} refers to itself`,
        "#VALUE!",
      );
    state.set(key, "busy");
    try {
      let tree = trees.get(key);
      if (!tree) {
        tree = parse(cell.f);
        trees.set(key, tree);
      }
      const out = evaluate(tree, sheet);
      cell.v = Array.isArray(out) ? error("#VALUE!") : out;
    } catch (failed) {
      if (!(failed instanceof FormulaError)) throw failed;
      const named = failed.message.startsWith(`${sheet.name}!`)
        ? failed
        : new FormulaError(
            `${sheet.name}!${colName(c)}${r + 1} (${cell.f}): ${failed.message}`,
            failed.code,
          );
      if (!problems) throw named;
      problems.push(named.message);
      cell.v = error(named.code);
    }
    state.set(key, "done");
    return cell.v;
  };
  /** A reference as a grid of values; a whole column stops at the sheet's last row. */
  const grid = (node, from) => {
    const sheet = sheetOf(node.sheet, from);
    const b = node.b ?? node.a;
    const rows = sheet.cells.length;
    const r1 = node.a.r ?? 0;
    const r2 = b.r ?? rows - 1;
    const [top, bottom] = [Math.min(r1, r2), Math.max(r1, r2)];
    const [left, right] = [Math.min(node.a.c, b.c), Math.max(node.a.c, b.c)];
    const out = [];
    for (let r = top; r <= Math.min(bottom, rows - 1); r++) {
      const row = [];
      for (let c = left; c <= right; c++) row.push(value(sheet, r, c));
      out.push(row);
    }
    return out;
  };
  const flat = (args, from) =>
    args.flatMap((arg) =>
      arg.k === "ref" && (arg.b || arg.a.r === null)
        ? grid(arg, from)
            .flat()
            .map((v) => ({ v, cell: true }))
        : [{ v: evaluate(arg, from), cell: arg.k === "ref" }],
    );
  const numbers = (args, from) => {
    const out = [];
    for (const { v, cell } of flat(args, from)) {
      if (isError(v)) return v;
      if (typeof v === "number") out.push(v);
      else if (!cell && v !== null) {
        const n = toNumber(v);
        if (isError(n)) return n;
        out.push(n);
      }
    }
    return out;
  };
  const aggregate = (name, list) => {
    if (isError(list)) return list;
    if (name === "SUM") return clean(list.reduce((s, n) => s + n, 0));
    if (name === "COUNT") return list.length;
    if (!list.length) return name === "AVERAGE" ? error("#DIV/0!") : 0;
    if (name === "AVERAGE")
      return clean(list.reduce((s, n) => s + n, 0) / list.length);
    if (name === "MIN") return Math.min(...list);
    return Math.max(...list);
  };
  const conditional = (name, args, from) => {
    if (args[0]?.k !== "ref")
      throw new FormulaError(`${name} needs a range first`);
    const range = grid(args[0], from).flat();
    const test = criterion(evaluate(args[1], from));
    const target = args[2] ? grid(args[2], from).flat() : range;
    const picked = range.flatMap((v, i) => (test(v) ? [target[i]] : []));
    if (name === "COUNTIF") return picked.length;
    const nums = picked.filter((v) => typeof v === "number");
    if (name === "SUMIF") return clean(nums.reduce((s, n) => s + n, 0));
    return nums.length
      ? clean(nums.reduce((s, n) => s + n, 0) / nums.length)
      : error("#DIV/0!");
  };

  /** SUMIFS, COUNTIFS, AVERAGEIFS: every range and its criterion must hold. */
  const conditionals = (name, args, from) => {
    const counting = name === "COUNTIFS";
    const pairs = counting ? args : args.slice(1);
    if (pairs.length < 2 || pairs.length % 2)
      throw new FormulaError(
        `${name} needs ${counting ? "" : "a range to add up, then "}ranges each with a criterion`,
      );
    const ranges = [];
    for (let i = 0; i < pairs.length; i += 2) {
      if (pairs[i].k !== "ref")
        throw new FormulaError(`${name} needs a range before each criterion`);
      ranges.push({
        cells: grid(pairs[i], from).flat(),
        test: criterion(evaluate(pairs[i + 1], from)),
      });
    }
    if (!counting && args[0].k !== "ref")
      throw new FormulaError(`${name} needs a range first`);
    const target = counting ? ranges[0].cells : grid(args[0], from).flat();
    if (ranges.some((one) => one.cells.length !== target.length))
      return error("#VALUE!");
    const picked = target.filter((_, i) =>
      ranges.every((one) => one.test(one.cells[i])),
    );
    if (counting) return picked.length;
    const nums = picked.filter((v) => typeof v === "number");
    if (name === "SUMIFS") return clean(nums.reduce((s, n) => s + n, 0));
    return nums.length
      ? clean(nums.reduce((s, n) => s + n, 0) / nums.length)
      : error("#DIV/0!");
  };
  /** The numbers a function is given, or the first error among them. */
  const numbersOf = (list, from) => {
    const out = [];
    for (const arg of list) {
      const n = toNumber(evaluate(arg, from));
      if (isError(n)) return n;
      out.push(n);
    }
    return out;
  };

  function evaluate(node, from) {
    if (node.k === "val") return node.v;
    if (node.k === "ref") {
      if (node.b || node.a.r === null) return grid(node, from);
      return value(sheetOf(node.sheet, from), node.a.r, node.a.c);
    }
    if (node.k === "neg") {
      const n = toNumber(evaluate(node.a, from));
      return isError(n) ? n : clean(-n);
    }
    if (node.k === "bin") {
      const a = evaluate(node.a, from);
      const b = evaluate(node.b, from);
      if (Array.isArray(a) || Array.isArray(b)) return error("#VALUE!");
      if (isError(a)) return a;
      if (isError(b)) return b;
      if (node.op === "&") return toText(a) + toText(b);
      if (["=", "<>", "<", ">", "<=", ">="].includes(node.op)) {
        const c = compare(a, b);
        return {
          "=": c === 0,
          "<>": c !== 0,
          "<": c < 0,
          ">": c > 0,
          "<=": c <= 0,
          ">=": c >= 0,
        }[node.op];
      }
      const x = toNumber(a);
      const y = toNumber(b);
      if (isError(x)) return x;
      if (isError(y)) return y;
      if (node.op === "+") return clean(x + y);
      if (node.op === "-") return clean(x - y);
      if (node.op === "*") return clean(x * y);
      if (node.op === "/") return y === 0 ? error("#DIV/0!") : clean(x / y);
      return clean(x ** y);
    }
    const { name, args } = node;
    const need = (n) => {
      if (args.length < n) throw new FormulaError(`${name} needs ${n} values`);
    };
    if (["SUM", "AVERAGE", "MIN", "MAX", "COUNT"].includes(name))
      return aggregate(name, numbers(args, from));
    if (name === "COUNTA")
      return flat(args, from).filter(({ v }) => v !== null && v !== "").length;
    if (name === "SUBTOTAL") {
      need(2);
      const kind = toNumber(evaluate(args[0], from)) % 100;
      const which = { 1: "AVERAGE", 2: "COUNT", 4: "MAX", 5: "MIN", 9: "SUM" }[
        kind
      ];
      if (kind === 3)
        return flat(args.slice(1), from).filter(
          ({ v }) => v !== null && v !== "",
        ).length;
      if (!which)
        throw new FormulaError(
          `SUBTOTAL ${kind} is not one this sheet works out; use 1, 2, 3, 4, 5 or 9`,
        );
      return aggregate(which, numbers(args.slice(1), from));
    }
    if (["SUMIF", "COUNTIF", "AVERAGEIF"].includes(name)) {
      need(2);
      return conditional(name, args, from);
    }
    if (["SUMIFS", "COUNTIFS", "AVERAGEIFS"].includes(name))
      return conditionals(name, args, from);
    if (name === "TODAY") {
      const now = new Date();
      return serialAt(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (name === "DATE") {
      need(3);
      const got = numbersOf(args.slice(0, 3), from);
      if (isError(got)) return got;
      const [y, m, d] = got.map(Math.trunc);
      const serial = serialAt(y < 1900 ? y + 1900 : y, m - 1, d);
      return serial < 1 ? error("#NUM!") : serial;
    }
    if (["YEAR", "MONTH", "DAY"].includes(name)) {
      need(1);
      const got = numbersOf(args.slice(0, 1), from);
      if (isError(got)) return got;
      if (got[0] < 0) return error("#NUM!");
      const at = dayOf(got[0]);
      return name === "YEAR"
        ? at.getUTCFullYear()
        : name === "MONTH"
          ? at.getUTCMonth() + 1
          : at.getUTCDate();
    }
    if (name === "EOMONTH") {
      need(2);
      const got = numbersOf(args.slice(0, 2), from);
      if (isError(got)) return got;
      if (got[0] < 0) return error("#NUM!");
      const at = dayOf(got[0]);
      return serialAt(
        at.getUTCFullYear(),
        at.getUTCMonth() + Math.trunc(got[1]) + 1,
        0,
      );
    }
    if (name === "ROUND") {
      need(1);
      const x = toNumber(evaluate(args[0], from));
      const d = args[1] ? toNumber(evaluate(args[1], from)) : 0;
      if (isError(x)) return x;
      if (isError(d)) return d;
      const f = 10 ** d;
      return clean((Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f);
    }
    if (name === "ABS") {
      need(1);
      const x = toNumber(evaluate(args[0], from));
      return isError(x) ? x : Math.abs(x);
    }
    if (name === "IF") {
      need(2);
      const test = evaluate(args[0], from);
      if (isError(test)) return test;
      const yes =
        typeof test === "string" ? error("#VALUE!") : Boolean(toNumber(test));
      if (isError(yes)) return yes;
      return yes
        ? evaluate(args[1], from)
        : args[2]
          ? evaluate(args[2], from)
          : false;
    }
    if (name === "IFERROR") {
      need(2);
      const v = evaluate(args[0], from);
      return isError(v) ? evaluate(args[1], from) : v;
    }
    if (name === "AND" || name === "OR") {
      const all = flat(args, from)
        .map(({ v }) => v)
        .filter((v) => v !== null);
      if (all.some(isError)) return all.find(isError);
      const truth = all.map((v) => Boolean(toNumber(v)));
      return name === "AND" ? truth.every(Boolean) : truth.some(Boolean);
    }
    if (name === "NOT") {
      need(1);
      const x = toNumber(evaluate(args[0], from));
      return isError(x) ? x : !x;
    }
    // CONCAT
    return flat(args, from)
      .map(({ v }) => toText(v))
      .join("");
  }

  for (const sheet of sheets)
    for (let r = 0; r < sheet.cells.length; r++)
      for (let c = 0; c < (sheet.cells[r]?.length ?? 0); c++)
        if (sheet.cells[r][c]?.f !== undefined) value(sheet, r, c);
  return sheets;
}

// ── changing a formula as the sheet around it changes ──────────────────────

const PIECE = /^\$?([A-Za-z]{1,3})(\$?)(\d*)$/;

/** A formula with each reference in it handed to `change`, which returns the new text or null
 * to keep it; text in quotes, functions and the rest are kept as written. */
function rewrite(formula, change) {
  const text = String(formula);
  const lead = text.startsWith("=") ? "=" : "";
  let rest = text.slice(lead.length);
  let out = lead;
  while (rest) {
    let hit = null;
    for (const [kind, re] of PATTERNS) {
      const m = re.exec(rest);
      if (m) {
        hit = { kind, m };
        break;
      }
    }
    if (!hit) return out + rest;
    const { kind, m } = hit;
    rest = rest.slice(m[0].length);
    if (kind !== "ref") {
      out += m[0];
      continue;
    }
    const sheet = m[1]?.replaceAll("''", "'") ?? m[2] ?? null;
    const prefix = m[0].slice(
      0,
      m[0].length - m[3].length - (m[4] ? m[4].length + 1 : 0),
    );
    const read = (piece) => {
      const [, letters, dollar, digits] = PIECE.exec(piece);
      return {
        colAbs: piece.startsWith("$"),
        c: colIndex(letters),
        rowAbs: dollar === "$",
        r: digits ? Number(digits) - 1 : null,
      };
    };
    const a = read(m[3]);
    const b = m[4] ? read(m[4]) : null;
    const changed = change({ sheet, a, b });
    out +=
      changed === null
        ? m[0]
        : changed === "#REF!"
          ? "#REF!"
          : prefix + changed;
  }
  return out;
}

const write = (p) =>
  `${p.colAbs ? "$" : ""}${colName(p.c)}${p.r === null ? "" : `${p.rowAbs ? "$" : ""}${p.r + 1}`}`;
const both = (a, b) => (b ? `${write(a)}:${write(b)}` : write(a));

/**
 * A formula on sheet `on` after `count` rows (axis "r") or columns ("c") of sheet `target` are
 * put in before index `at` (count > 0) or taken out from `at` (count < 0), counted from 0 as
 * Excel does it: a reference past them moves, a range across them grows or shrinks, and a
 * reference to a cell taken out becomes #REF!.
 */
export function moveRefs(formula, { on, target, axis, at, count }) {
  const mine = (sheet) => (sheet ?? on).toLowerCase() === target.toLowerCase();
  const key = axis === "r" ? "r" : "c";
  return rewrite(formula, ({ sheet, a, b }) => {
    if (!mine(sheet)) return null;
    if (a[key] === null) return null; // a whole column moves no row, a whole row no column
    const shift = (n) => (n >= at ? n + count : n);
    if (count > 0) {
      const next = { ...a, [key]: shift(a[key]) };
      const end = b && { ...b, [key]: shift(b[key]) };
      return both(next, end);
    }
    const gone = (n) => n >= at && n < at - count;
    const after = (n) => (n >= at - count ? n + count : n);
    if (!b)
      return gone(a[key]) ? "#REF!" : both({ ...a, [key]: after(a[key]) });
    let [lo, hi] = [Math.min(a[key], b[key]), Math.max(a[key], b[key])];
    if (gone(lo) && gone(hi)) return "#REF!";
    if (gone(lo)) lo = at;
    else lo = after(lo);
    hi = gone(hi) ? at - 1 : after(hi);
    return both({ ...a, [key]: lo }, { ...b, [key]: hi });
  });
}

/** A formula copied `rows` rows down (up when negative): each row not fixed with `$` moves. */
export function fillDown(formula, rows) {
  return rewrite(formula, ({ a, b }) => {
    const move = (p) =>
      p.r === null || p.rowAbs ? p : { ...p, r: p.r + rows };
    const [x, y] = [move(a), b && move(b)];
    if (x.r < 0 || (y && y.r < 0)) return "#REF!";
    return both(x, y);
  });
}

/**
 * A formula written in Excel row `row` as a column's formula: `{r}` wherever a reference names
 * that row without `$`. Null when one names another row without `$`, which `{r}` cannot say.
 */
export function asColumnFormula(formula, row) {
  let fits = true;
  const one = (p) => {
    if (p.r === null || p.rowAbs) return write(p);
    if (p.r !== row - 1) fits = false;
    return `${p.colAbs ? "$" : ""}${colName(p.c)}{r}`;
  };
  const out = rewrite(formula, ({ a, b }) =>
    b ? `${one(a)}:${one(b)}` : one(a),
  );
  return fits ? out : null;
}

/**
 * The references a formula names, in order, each with where it stands in the text (`start`,
 * `end`) — as far as the formula reads, so one being typed shows what it names so far.
 */
export function referencesIn(formula) {
  const text = String(formula);
  const found = [];
  let at = text.startsWith("=") ? 1 : 0;
  while (at < text.length) {
    const rest = text.slice(at);
    let hit = null;
    for (const [kind, re] of PATTERNS) {
      const m = re.exec(rest);
      if (m) {
        hit = { kind, m };
        break;
      }
    }
    if (!hit) break;
    const { kind, m } = hit;
    if (kind === "ref") {
      const a = part(m[3]);
      const b = m[4] ? part(m[4]) : null;
      if (a && (!m[4] || b) && (b || a.r !== null))
        found.push({
          sheet: m[1]?.replaceAll("''", "'") ?? m[2] ?? null,
          a,
          b,
          start: at,
          end: at + m[0].length,
        });
    }
    at += m[0].length;
  }
  return found;
}
