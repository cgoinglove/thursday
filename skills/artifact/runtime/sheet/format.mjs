// How a column's numbers read: Excel's own format codes, the few a sheet needs — grouping,
// decimals, a percent, and words or a currency sign before or after. The same code goes into
// the .xlsx, so Excel shows what the page shows. The page's script carries this file too
// (spreadsheet.mjs inlines it), so a total worked out in the page reads the same way.

/** A format code read into its parts, or null for one this sheet does not draw. */
function parseFormat(code) {
  if (!code || code === "General") return { general: true };
  const m =
    /^((?:"[^"]*"|[^#0"])*)(#,##0|0)(?:\.(0+))?(%?)((?:"[^"]*"|[^#0"%])*)$/.exec(
      code,
    );
  if (!m) return null;
  const literal = (text) =>
    text.replace(/"([^"]*)"/g, "$1").replaceAll("\\", "");
  return {
    prefix: literal(m[1]),
    group: m[2] === "#,##0",
    decimals: m[3]?.length ?? 0,
    percent: m[4] === "%",
    suffix: literal(m[5]),
  };
}

/** Whether a sheet can draw `code`; the message says what it can. */
export function checkFormat(code) {
  if (parseFormat(code)) return null;
  return `"${code}" is not a number format this sheet draws: use #,##0, #,##0.00, 0, 0.0%, and words or a sign before or after in quotes ("₩"#,##0, #,##0"원", "$"#,##0.00)`;
}

/** The format code as the .xlsx keeps it: words and signs in quotes, so Excel reads it whole. */
export function xlsxFormat(code) {
  const parts = parseFormat(code);
  if (!parts || parts.general) return "General";
  const quote = (text) => (text ? `"${text.replaceAll('"', "")}"` : "");
  const core = `${parts.group ? "#,##0" : "0"}${parts.decimals ? `.${"0".repeat(parts.decimals)}` : ""}${parts.percent ? "%" : ""}`;
  return `${quote(parts.prefix)}${core}${quote(parts.suffix)}`;
}

/** A cell's value as the page shows it. */
export function formatValue(value, code) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "object" && "error" in value) return value.error;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value !== "number") return String(value);
  const parts = parseFormat(code) ?? { general: true };
  if (parts.general)
    return Number.isInteger(value)
      ? String(value)
      : String(Number(value.toPrecision(10)));
  const n = parts.percent ? value * 100 : value;
  const text = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: parts.decimals,
    maximumFractionDigits: parts.decimals,
    useGrouping: parts.group,
  });
  const shown = `${parts.prefix}${text}${parts.percent ? "%" : ""}${parts.suffix}`;
  return n < 0 && Number(text.replace(/,/g, "")) !== 0 ? `-${shown}` : shown;
}
