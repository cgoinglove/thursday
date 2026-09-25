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

export const money = (amount, code) =>
  amount == null
    ? "?"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        maximumFractionDigits: 0,
      }).format(amount);
