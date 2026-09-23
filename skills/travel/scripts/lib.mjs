export function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** `--name value`, `--name=value` and `--flag`, and the rest as positionals in `_`. */
export function parseArgs(argv = process.argv.slice(2)) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      opts._.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split(/=(.*)/s);
    if (inline !== undefined) opts[key] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--"))
      opts[key] = argv[++i];
    else opts[key] = true;
  }
  return opts;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD the caller passed, checked; `what` names it in the error. */
export function day(value, what) {
  if (typeof value !== "string" || !ISO_DAY.test(value))
    fail(`${what} is a date as YYYY-MM-DD, got "${value ?? ""}".`);
  if (Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    fail(`${what} "${value}" is not a real date.`);
  return value;
}

export const nightsBetween = (from, to) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5,
  );

export const addDays = (iso, n) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5)
    .toISOString()
    .slice(0, 10);

export const money = (amount, code) =>
  amount == null
    ? "?"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        maximumFractionDigits: 0,
      }).format(amount);

/** GET a keyless JSON API, tried twice; a second failure stops the script with the url. */
export async function getJson(url) {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "thursday-agent travel" },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return await res.json();
      // A refused request says why; asking again will not change it
      if (res.status >= 400 && res.status < 500)
        fail(
          `${url.replace(/\?.*/, "")} refused the request: ${(await res.text()).slice(0, 300)}`,
        );
      last = `${res.status} ${res.statusText}`;
    } catch (error) {
      last = error.message;
    }
  }
  fail(
    `${url.replace(/\?.*/, "")} did not answer twice (${last}): it is down, not empty.`,
  );
}
