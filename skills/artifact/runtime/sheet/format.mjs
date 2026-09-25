// How a column's values read: Excel's own format codes, the ones a sheet needs — grouping,
// decimals, a percent, words or a currency sign before or after, another way for negatives and
// zero after a `;` (in [Red] too), and dates and times. The same code goes into the .xlsx, so
// Excel shows what the page shows. The page's script carries this file too (spreadsheet.mjs
// inlines it), so a total worked out in the page reads the same way.
//
// A date is Excel's: a number of days, 1 being 1900-01-01 (the 1900 date system; before
// 1900-03-01 Excel counts a 29 February that never was, which this does not).

const quote = (text) => (text ? `"${text.replaceAll('"', "")}"` : "");

/** The colours a section may name, as Excel spells them. */
const FORMAT_COLORS = ["Red", "Blue", "Green", "Black"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
/** Days from 1970-01-01 to Excel's day 0. */
const EPOCH = 25569;

/** The parts of a code outside quotes, split on `;`. */
function sectionsOf(code) {
  const out = [""];
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') quoted = !quoted;
    if (ch === "\\" && !quoted) {
      out[out.length - 1] += ch + (code[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === ";" && !quoted) out.push("");
    else out[out.length - 1] += ch;
  }
  return out;
}

/**
 * Words and signs as a section writes them — "quoted", \x, a locale's [$sign-409], _x as a
 * space — and as the .xlsx keeps them (`raw`), in a form Excel reads whole.
 */
function literal(text) {
  let out = "";
  let raw = "";
  const re = /"([^"]*)"|\\(.)|\[\$([^\]-]*)(?:-[0-9A-Fa-f]+)?\]|_(.)|\*(.)|([^"\\[_*])/gsy;
  let m;
  let at = 0;
  while (at < text.length) {
    re.lastIndex = at;
    m = re.exec(text);
    if (!m) return null;
    at = re.lastIndex;
    if (m[1] !== undefined) {
      out += m[1];
      raw += quote(m[1]);
    } else if (m[2] !== undefined) {
      out += m[2];
      raw += `\\${m[2]}`;
    } else if (m[3] !== undefined) {
      out += m[3];
      raw += quote(m[3]);
    } else if (m[4] !== undefined) {
      out += " ";
      raw += `_${m[4]}`;
    } else if (m[5] !== undefined) {
      // A fill: nothing to fill in a cell drawn to fit, and Excel keeps it
      raw += `*${m[5]}`;
    } else if (/[#0?@]/.test(m[6])) return null;
    else {
      out += m[6];
      raw += /[-$+/():!^&'~{}<>= ]/.test(m[6]) ? m[6] : quote(m[6]);
    }
  }
  return { text: out, raw };
}

/** A date or time section as its tokens, or null when it is not one this draws. */
function dateTokens(text) {
  const tokens = [];
  const re =
    /"([^"]*)"|\\(.)|(yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P)|([-/.,: ])/iy;
  let at = 0;
  while (at < text.length) {
    re.lastIndex = at;
    const m = re.exec(text);
    if (!m) return null;
    at = re.lastIndex;
    if (m[3]) tokens.push({ t: m[3].toLowerCase() });
    else tokens.push({ lit: m[1] ?? m[2] ?? m[4] });
  }
  if (!tokens.some((one) => one.t)) return null;
  // m or mm is the minute when it follows an hour or comes before seconds
  const parts = tokens.filter((one) => one.t);
  parts.forEach((one, i) => {
    if (one.t !== "m" && one.t !== "mm") return;
    if (/^h/.test(parts[i - 1]?.t ?? "") || /^s/.test(parts[i + 1]?.t ?? ""))
      one.t = one.t === "m" ? "n" : "nn";
  });
  return tokens;
}

/** One section read: `{ color, date }` or `{ color, prefix, core, group, decimals, percent, suffix }`. */
function parseSection(text) {
  let rest = text;
  let color = null;
  const tag = /^\[(\w+)\]/.exec(rest);
  if (tag) {
    color = FORMAT_COLORS.find(
      (one) => one.toLowerCase() === tag[1].toLowerCase(),
    );
    if (!color) return null;
    rest = rest.slice(tag[0].length);
  }
  if (rest === "General") return { color, general: true };
  const m =
    /^((?:"[^"]*"|\\.|\[\$[^\]]*\]|[^#0"\\[])*)(#,##0|0)(?:\.(0+))?(%?)((?:"[^"]*"|\\.|[^#0"\\%])*)$/s.exec(
      rest,
    );
  if (m) {
    const prefix = literal(m[1]);
    const suffix = literal(m[5]);
    if (prefix === null || suffix === null) return null;
    return {
      color,
      prefix: prefix.text,
      rawPrefix: prefix.raw,
      rawSuffix: suffix.raw,
      core: true,
      group: m[2] === "#,##0",
      decimals: m[3]?.length ?? 0,
      percent: m[4] === "%",
      suffix: suffix.text,
    };
  }
  const date = dateTokens(rest);
  if (date) return { color, date };
  // Words alone, as a zero or a negative may read ("-", "none")
  const words = literal(rest);
  return words === null
    ? null
    : { color, prefix: words.text, rawPrefix: words.raw, core: false };
}

/** A format code read into its sections, or null for one this sheet does not draw. */
function parseFormat(code) {
  if (!code || code === "General") return { general: true };
  const sections = sectionsOf(String(code));
  if (sections.length > 3) return null;
  const parsed = sections.map(parseSection);
  if (parsed.some((one) => one === null)) return null;
  if (!parsed[0].core && !parsed[0].date && !parsed[0].general) return null;
  if (parsed.length > 1 && parsed.some((one) => one.date)) return null;
  return { sections: parsed };
}

/** Whether a sheet can draw `code`; the message says what it can. */
export function checkFormat(code) {
  if (parseFormat(code)) return null;
  return `"${code}" is not a format this sheet draws: use #,##0, #,##0.00, 0, 0.0%, words or a sign before or after in quotes ("₩"#,##0, #,##0"원", "$"#,##0.00), another way for negatives and zero after ; ("#,##0;[Red](#,##0);"-""), or a date or time (yyyy-mm-dd, yyyy"년" m"월" d"일", d mmm yyyy, hh:mm)`;
}

/** Whether values in `code` are dates or times. */
export function isDateFormat(code) {
  return Boolean(parseFormat(code)?.sections?.[0]?.date);
}

/** The format code as the .xlsx keeps it: words and signs in quotes, so Excel reads it whole. */
export function xlsxFormat(code) {
  const parts = parseFormat(code);
  if (!parts || parts.general) return "General";
  return parts.sections
    .map((one) => {
      const color = one.color ? `[${one.color}]` : "";
      if (one.general) return `${color}General`;
      if (one.date)
        return (
          color +
          one.date
            .map((token) =>
              token.t
                ? token.t.replace(/n/g, "m").replace("am/pm", "AM/PM").replace("a/p", "A/P")
                : /^[-/.,: ]$/.test(token.lit)
                  ? token.lit
                  : quote(token.lit),
            )
            .join("")
        );
      if (!one.core) return color + one.rawPrefix;
      const core = `${one.group ? "#,##0" : "0"}${one.decimals ? `.${"0".repeat(one.decimals)}` : ""}${one.percent ? "%" : ""}`;
      return `${color}${one.rawPrefix}${core}${one.rawSuffix}`;
    })
    .join(";");
}

/** The section a number is drawn with, and whether its own minus sign is dropped. */
function sectionFor(parts, value) {
  const [first, second, third] = parts.sections;
  if (typeof value !== "number") return { section: first, signless: false };
  if (value === 0 && third) return { section: third, signless: true };
  if (value < 0 && second) return { section: second, signless: true };
  return { section: first, signless: false };
}

/** An Excel date number as the text a date section writes. */
function dateText(serial, tokens) {
  const whole = new Date(Math.round((serial - EPOCH) * 86400) * 1000);
  const [y, mo, d, day] = [
    whole.getUTCFullYear(),
    whole.getUTCMonth(),
    whole.getUTCDate(),
    whole.getUTCDay(),
  ];
  const [h, mi, s] = [
    whole.getUTCHours(),
    whole.getUTCMinutes(),
    whole.getUTCSeconds(),
  ];
  const half = tokens.some((one) => one.t === "am/pm" || one.t === "a/p");
  const hour = half ? h % 12 || 12 : h;
  const two = (n) => String(n).padStart(2, "0");
  return tokens
    .map((one) => {
      if (!one.t) return one.lit;
      return {
        yyyy: String(y),
        yy: two(y % 100),
        mmmm: MONTH_NAMES[mo],
        mmm: MONTH_NAMES[mo].slice(0, 3),
        mm: two(mo + 1),
        m: String(mo + 1),
        dddd: DAY_NAMES[day],
        ddd: DAY_NAMES[day].slice(0, 3),
        dd: two(d),
        d: String(d),
        hh: two(hour),
        h: String(hour),
        nn: two(mi),
        n: String(mi),
        ss: two(s),
        s: String(s),
        "am/pm": h < 12 ? "AM" : "PM",
        "a/p": h < 12 ? "A" : "P",
      }[one.t];
    })
    .join("");
}

/** A cell's value as the page shows it. */
export function formatValue(value, code) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "object" && "error" in value) return value.error;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value !== "number") return String(value);
  const parts = parseFormat(code) ?? { general: true };
  const { section, signless } = parts.general
    ? { section: { general: true }, signless: false }
    : sectionFor(parts, value);
  if (section.general)
    return Number.isInteger(value)
      ? String(value)
      : String(Number(value.toPrecision(10)));
  if (section.date)
    return value < 0 ? "#NUM!" : dateText(value, section.date);
  if (!section.core) return section.prefix;
  const n = section.percent ? value * 100 : value;
  const text = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: section.decimals,
    maximumFractionDigits: section.decimals,
    useGrouping: section.group,
  });
  const shown = `${section.prefix}${text}${section.percent ? "%" : ""}${section.suffix}`;
  return n < 0 && !signless && Number(text.replace(/,/g, "")) !== 0
    ? `-${shown}`
    : shown;
}

/** The colour a section gives a value (`Red`, `Blue`, `Green`, `Black`), or null. */
export function formatColor(value, code) {
  if (typeof value !== "number") return null;
  const parts = parseFormat(code);
  if (!parts || parts.general) return null;
  return sectionFor(parts, value).section.color ?? null;
}

/** A date written YYYY-MM-DD, with hh:mm or hh:mm:ss after it, as Excel's day number; else null. */
export function serialOf(text) {
  const m =
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(
      String(text).trim(),
    );
  if (!m) return null;
  const [y, mo, d, h = 0, mi = 0, s = 0] = m.slice(1).map((x) => Number(x ?? 0));
  const at = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(at);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23)
    return null;
  return Number((at / 86400000 + EPOCH).toPrecision(15));
}

/** An Excel day number written YYYY-MM-DD, and hh:mm or hh:mm:ss when it has a time of day. */
export function isoOf(serial) {
  const at = new Date(Math.round((serial - EPOCH) * 86400) * 1000);
  const iso = at.toISOString();
  if (at.getUTCHours() || at.getUTCMinutes() || at.getUTCSeconds())
    return `${iso.slice(0, 10)} ${at.getUTCSeconds() ? iso.slice(11, 19) : iso.slice(11, 16)}`;
  return iso.slice(0, 10);
}

/**
 * What someone typed into a cell of a column written in `code`: a date in a date column when
 * it is written YYYY-MM-DD; a number when it reads as one — with the format's words or sign
 * around it, grouping commas, a minus or a % — TRUE or FALSE, empty for nothing, and otherwise
 * the text as typed.
 */
export function valueOf(text, code) {
  const typed = String(text).trim();
  if (typed === "") return null;
  if (/^(TRUE|FALSE)$/i.test(typed)) return typed.toUpperCase() === "TRUE";
  const parts = parseFormat(code) ?? { general: true };
  const first = parts.general ? { general: true } : parts.sections[0];
  if (first.date) return serialOf(typed) ?? plainNumber(typed, {}) ?? typed;
  const words = parts.general ? [{}] : parts.sections.filter((one) => one.core);
  for (const one of words) {
    const n = plainNumber(typed, one);
    if (n !== null) return n;
  }
  return typed;
}

/** `typed` as a number with a section's words around it, or null. */
function plainNumber(typed, section) {
  let rest = typed;
  let negative = false;
  const minus = () => {
    if (!negative && rest.startsWith("-")) {
      negative = true;
      rest = rest.slice(1).trim();
    }
  };
  // (1,234) is how accounting writes a negative
  if (/^\(.*\)$/.test(rest)) {
    negative = true;
    rest = rest.slice(1, -1).trim();
  }
  minus();
  if (section.prefix && rest.startsWith(section.prefix.trim()))
    rest = rest.slice(section.prefix.trim().length).trim();
  minus();
  if (section.suffix && rest.endsWith(section.suffix.trim()))
    rest = rest.slice(0, -section.suffix.trim().length).trim();
  const percent = rest.endsWith("%");
  if (percent) rest = rest.slice(0, -1).trim();
  if (
    !/\d/.test(rest) ||
    !/^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d*)?(?:[eE][+-]?\d+)?$/.test(rest)
  )
    return null;
  const n = Number(rest.replaceAll(",", "")) * (negative ? -1 : 1);
  return percent ? Number((n / 100).toPrecision(15)) : n;
}
