import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Runs `fn(page, args, helpers)` in this shell's own browser session
 * (PLAYWRIGHT_CLI_SESSION) through `playwright-cli run-code`, and resolves to what
 * it returned. `fn` and each helper are sent as source, so they see nothing of
 * their module: what they need comes in `args`. They run in a bare VM beside the
 * browser — no timers, no require — so waits are `page.waitForTimeout` and
 * `page.waitForFunction`, and files are written by the caller from what returns.
 */
export async function inPage(fn, args = {}, helpers = {}) {
  const lib = Object.entries(helpers)
    .map(([name, helper]) => `${name}: ${helper}`)
    .join(", ");
  const code = `async page => (${fn})(page, ${JSON.stringify(args)}, { ${lib} })`;
  // One argument is capped (128 KB on Linux): longer code goes as a file
  const dir = code.length > 64_000 ? mkdtempSync(join(tmpdir(), "run-")) : null;
  if (dir) writeFileSync(join(dir, "code.js"), code);
  const out = await new Promise((resolve) =>
    execFile(
      "playwright-cli",
      dir
        ? ["--raw", "run-code", `--filename=${join(dir, "code.js")}`]
        : ["--raw", "run-code", code],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        if (!error) return resolve(stdout.trim());
        const said = `${stdout ?? ""}${stderr ?? ""}`.trim();
        fail(
          /not open|no (open )?browser/i.test(said)
            ? "No browser is open in this session. `playwright-cli open`, sign in, then run this again."
            : `The browser answered with an error:\n${said.slice(0, 800)}`,
        );
      },
    ),
  );
  if (!out) return undefined;
  try {
    return JSON.parse(out);
  } catch {
    fail(`Unexpected answer from the browser:\n${out.slice(0, 800)}`);
  }
}

/** `--name value` and `--flag` pairs, and the rest as positionals. */
export function parseArgs(argv = process.argv.slice(2)) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      opts._.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split("=", 2);
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
  if (result && typeof result === "object" && result.error) fail(result.error);
  return result;
}

/** Local time, minutes precision: what a person reads, and what `--since` takes. */
export const stamp = (ms) => {
  if (!ms) return "?";
  const d = new Date(Number(ms));
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const oneLine = (text, max) => {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
