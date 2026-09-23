/**
 * A script's way into this shell's own browser session (PLAYWRIGHT_CLI_SESSION): every
 * call is one `playwright-cli --raw run-code`, and what the code returns comes back parsed.
 *
 * The code runs in a bare VM beside the browser, not in Node and not in the page: no
 * `URL`, `URLSearchParams`, `fetch`, `setTimeout` or `require`. Build addresses with
 * string work and `encodeURIComponent`, fetch with `page.request` (it carries the
 * session's cookies), wait with `page.waitForTimeout` / `page.waitForFunction`, and do
 * DOM work inside `page.evaluate`. Files are written by the caller from what returns.
 *
 * A skill's own script reaches it through the shipped skills folder, which a bot's shell
 * names in THURSDAY_SKILLS:
 *
 *   const { inPage } = await import(`${process.env.THURSDAY_SKILLS}/browser/scripts/session.mjs`);
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = (args) =>
  new Promise((done) =>
    execFile(
      "playwright-cli",
      args,
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) =>
        done({
          error,
          out: (stdout ?? "").trim(),
          said: `${stdout ?? ""}${stderr ?? ""}`.trim(),
        }),
    ),
  );

/**
 * Runs `code` — the source of one `async page => …` — and resolves to what it returned,
 * parsed; undefined when it returned nothing. A job that has not opened its browser yet
 * gets a headless one here, once, so every kit script shares this one way in; a browser
 * already open, headed or not, is left as it is. Stops the script with a readable line
 * when the code threw.
 */
export async function runCode(code) {
  // One argument is capped (E2BIG past 128 KB on Linux, less with a big environment)
  const dir = code.length > 64_000 ? mkdtempSync(join(tmpdir(), "run-")) : null;
  if (dir) writeFileSync(join(dir, "code.js"), code);
  const args = dir
    ? ["--raw", "run-code", `--filename=${join(dir, "code.js")}`]
    : ["--raw", "run-code", code];
  let got = await cli(args);
  if (got.error?.code === "ENOENT")
    fail(
      "playwright-cli is not on this shell's PATH: the browser skill's Install section.",
    );
  if (got.error && /not open|no (open )?browser/i.test(got.said)) {
    const opened = await cli(["open"]);
    if (opened.error)
      fail(
        "No browser is open in this session and one could not be opened (`playwright-cli open` failed): the browser skill's Install section.",
      );
    got = await cli(args);
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (got.error)
    fail(
      `The browser answered with an error:\n${got.said
        .replace(/^### Error\s*/, "")
        .replace(/^Error:\s*/, "")
        .slice(0, 800)}`,
    );
  const out = got.out;
  if (!out) return undefined;
  try {
    return JSON.parse(out);
  } catch {
    fail(`Unexpected answer from the browser:\n${out.slice(0, 800)}`);
  }
}

/**
 * Runs `fn(page, args, helpers)` in the session and resolves to what it returned. `fn`
 * and each helper cross as source, so they see nothing of their module: what they need
 * comes in `args` (JSON) or as another helper.
 */
export function inPage(fn, args = {}, helpers = {}) {
  const lib = Object.entries(helpers)
    .map(([name, helper]) => `${JSON.stringify(name)}: ${helper}`)
    .join(", ");
  return runCode(
    `async page => (${fn})(page, ${JSON.stringify(args)}, { ${lib} })`,
  );
}

/**
 * `inPage`, in a browser of its own: headless, opened for this one run and closed after.
 * For work on the bot's own files, which should never be drawn in the session's browser —
 * that one may be a window on the user's screen. Its name carries the session's, so the
 * app closes it with the job's others if a run dies before closing it.
 */
export async function inPageApart(fn, args = {}, helpers = {}) {
  const own = process.env.PLAYWRIGHT_CLI_SESSION;
  process.env.PLAYWRIGHT_CLI_SESSION = `${own || "default"}-apart`;
  try {
    return await inPage(fn, args, helpers);
  } finally {
    await cli(["close"]);
    if (own === undefined) delete process.env.PLAYWRIGHT_CLI_SESSION;
    else process.env.PLAYWRIGHT_CLI_SESSION = own;
  }
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

export function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** A page-side answer `{ error }` stops the script with that message. */
export function orFail(result) {
  if (result && typeof result === "object" && result.error) {
    // Chromium prints only headless: a job whose browser is a window on the user's
    // screen closes it, and the next run opens a headless one by itself
    if (/only supported for Headless/i.test(result.error))
      fail(
        "A PDF is printed by a headless browser, and this job's is a window on the user's screen: `playwright-cli close`, then run this again.",
      );
    fail(result.error);
  }
  return result;
}
