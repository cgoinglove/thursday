// What the brief's scripts share: arguments, fetching, reading HTML
// and feeds without a parser, and where the bot's finished work goes.
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// Says what it is: a publisher that turns a script away has said no, and the brief takes
// another outlet rather than pass for a browser
const UA = "thursday-agent daily-brief";

export class Stop extends Error {}

/** Runs `main`, printing a Stop's message alone and exiting 1. */
export async function run(main) {
  try {
    await main();
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

/** `--name value`, `--name=value`, `--flag`; a repeated name collects into a list. */
export function parseArgs(argv = process.argv.slice(2)) {
  const opts = { _: [] };
  const put = (key, value) => {
    if (key in opts)
      opts[key] = [opts[key], value].flat().filter((v) => v !== true);
    else opts[key] = value;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      opts._.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split(/=(.*)/s);
    if (inline !== undefined) put(key, inline);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--"))
      put(key, argv[++i]);
    else put(key, true);
  }
  return opts;
}

export const list = (value) =>
  [value ?? []]
    .flat()
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean);

/** GET with a deadline; resolves to the response, never throws. */
export async function get(url, { timeout = 15000, lang, headers } = {}) {
  try {
    return await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml,*/*",
        ...(lang ? { "accept-language": `${lang},en;q=0.8` } : {}),
        ...headers,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.cause ?? error) };
  }
}

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
};

export const decode = (text = "") =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);

/** Tags stripped, entities decoded, whitespace folded. */
export const plain = (html = "") =>
  decode(decode(html).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** A `<meta property|name="key">` value from raw HTML. */
export function meta(html, key) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = tag.match(
      /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i,
    );
    if (name?.[1].toLowerCase() !== key) continue;
    const content = tag.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i);
    if (content) return decode(content[2]).trim();
  }
  return null;
}

export const host = (url) =>
  String(url)
    .replace(/^https?:\/\//, "")
    .split(/[/?#]/)[0]
    .replace(/^www\./, "")
    .toLowerCase();

/** Whether a url's host is one of `domains` or under one. */
export const onDomain = (url, domains) =>
  domains.some((d) => {
    const h = host(url);
    const want = d.replace(/^www\./, "").toLowerCase();
    return h === want || h.endsWith(`.${want}`);
  });

/** The app's workspace: the nearest folder above holding its fence and a `projects` folder. */
export function workspace() {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (
      existsSync(join(dir, "pnpm-workspace.yaml")) &&
      existsSync(join(dir, "projects"))
    )
      return dir;
    if (dir === dirname(dir)) return process.cwd();
  }
}

/** The bot's folder under `artifacts/`, where the finished brief goes: from the workspace or whole. */
export const artifactsDir = () =>
  resolve(workspace(), process.env.THURSDAY_ARTIFACTS || "artifacts");

export const shown = (path) => relative(workspace(), path) || ".";

/** Runs `fn` over `items`, at most `n` at once, keeping their order. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export const ago = (iso, now = Date.now()) => {
  const h = (now - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(h)) return "?";
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : `${Math.round(h)}h`;
};
