#!/usr/bin/env node
// An article, a post or a PDF as clean text in a file, in parts that each fit one read.
//
//   node text.mjs <url|file.pdf> --out <file.txt>
//       A web page is read through this job's own browser (opened headless when it is
//       not): the main text only, with headings, lists and quotes, and the title, site,
//       author and date above it. A PDF (a url or a file) is read with pdftotext, else
//       with pypdf installed once into the workspace; each page starts with `[p. N]`.
//       Prints the head, the size and how to read it.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  download,
  oneLine,
  parseArgs,
  readingLine,
  run,
  Stop,
  shown,
  usage,
  WORKSPACE,
  withParts,
} from "./lib.mjs";

/** The shipped browser skill's way into this shell's session. */
async function session() {
  const root = process.env.THURSDAY_SKILLS;
  if (!root)
    throw new Stop(
      "THURSDAY_SKILLS is not set: run this from a bot's shell in the app.",
    );
  const open = spawnSync(
    "playwright-cli",
    ["--raw", "run-code", "async page => 1"],
    {
      encoding: "utf8",
    },
  );
  if (open.status !== 0 && /not open/i.test(`${open.stdout}${open.stderr}`))
    spawnSync("playwright-cli", ["open"], { encoding: "utf8" });
  return import(pathToFileURL(join(root, "browser/scripts/session.mjs")).href);
}

/**
 * Runs in the page. The block holding the most paragraph text wins (a parent scores a
 * paragraph in full, a grandparent half: Readability's core), and its headings,
 * paragraphs, list items, quotes and code come out in order as markdown-ish lines.
 */
function extract() {
  const meta = (...names) => {
    for (const name of names) {
      const el = document.querySelector(
        `meta[property="${name}"], meta[name="${name}"]`,
      );
      if (el?.content) return el.content.trim();
    }
    return null;
  };
  const skip =
    "nav, header, footer, aside, form, script, style, noscript, [role=navigation], [aria-hidden=true]";
  const score = new Map();
  for (const p of document.querySelectorAll("p, pre, blockquote")) {
    if (p.closest(skip)) continue;
    const length = p.innerText.trim().length;
    if (length < 40) continue;
    const parent = p.parentElement;
    const grand = parent?.parentElement;
    if (parent) score.set(parent, (score.get(parent) ?? 0) + length);
    if (grand) score.set(grand, (score.get(grand) ?? 0) + length / 2);
  }
  let best = [...score].sort((a, b) => b[1] - a[1])[0]?.[0] ?? document.body;
  const article = document.querySelector("article");
  if (
    article?.contains(best) &&
    article.innerText.length < best.innerText.length * 3
  )
    best = article;
  const lines = [];
  const seen = new Set();
  for (const el of best.querySelectorAll(
    "h1, h2, h3, h4, p, li, blockquote, pre, figcaption, td",
  )) {
    if (el.closest(skip) && !best.closest(skip)) continue;
    if ([...seen].some((done) => done.contains(el))) continue;
    const text = el.innerText.replace(/\s+/g, " ").trim();
    if (!text) continue;
    seen.add(el);
    const tag = el.tagName;
    if (/^H\d$/.test(tag))
      lines.push(`${"#".repeat(Math.min(Number(tag[1]) + 1, 4))} ${text}`);
    else if (tag === "LI") lines.push(`- ${text}`);
    else if (tag === "BLOCKQUOTE") lines.push(`> ${text}`);
    else lines.push(text);
  }
  // A page with no paragraphs in markup (text between <br>s): its visible text by blank lines
  if (lines.join(" ").length < 500)
    for (const para of document.body.innerText.split(/\n\s*\n/)) {
      const text = para.replace(/\s+/g, " ").trim();
      if (text) lines.push(text);
    }
  const image = meta("og:image");
  const date =
    meta("article:published_time", "og:published_time", "date", "pubdate") ??
    document.querySelector("time[datetime]")?.getAttribute("datetime");
  return {
    title: meta("og:title") ?? document.title,
    site: meta("og:site_name") ?? location.hostname,
    author: meta("author", "article:author", "twitter:creator"),
    date: date ? date.slice(0, 10) : null,
    image: image ? new URL(image, location.href).href : null,
    url: location.href,
    lines,
  };
}

async function webPage(url) {
  const { inPage, orFail } = await session();
  return orFail(
    await inPage(
      async (page, { url, extract }) => {
        const tab = await page.context().newPage();
        try {
          const res = await tab.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          await tab
            .waitForLoadState("networkidle", { timeout: 8_000 })
            .catch(() => {});
          if (res && res.status() >= 400)
            return {
              error: `${url} answered ${res.status()}. A wall for headless browsers: open it --headed --persistent (the browser skill).`,
            };
          // An expression, not a function: it runs even where the page's policy forbids eval
          return await tab.evaluate(`(${extract})()`);
        } finally {
          await tab.close();
        }
      },
      { url, extract: extract.toString() },
    ),
  );
}

/** Whether a url with no `.pdf` in it answers with one (arxiv.org/pdf/…). */
async function servesPdf(url) {
  const res = await fetch(url, {
    method: "HEAD",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return /application\/pdf/i.test(res?.headers.get("content-type") ?? "");
}

/** pdftotext on the machine, else pypdf installed once into the workspace. */
function pdfPages(file) {
  const tool = spawnSync("pdftotext", ["-enc", "UTF-8", file, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (tool.status === 0) return tool.stdout.split("\f");
  const dir = join(WORKSPACE, "projects", ".pypdf");
  if (!existsSync(join(dir, "pypdf"))) {
    process.stderr.write(
      "No pdftotext here: installing pypdf into projects/.pypdf, once…\n",
    );
    const pip = spawnSync(
      "python3",
      ["-m", "pip", "install", "--quiet", "--target", dir, "pypdf"],
      { stdio: "inherit" },
    );
    if (pip.status !== 0)
      throw new Stop(
        "No pdftotext, and installing pypdf failed; pip's output above says why.",
      );
  }
  const py = spawnSync(
    "python3",
    [
      "-c",
      "import sys,json;sys.path.insert(0,sys.argv[1]);from pypdf import PdfReader;print(json.dumps([p.extract_text() or '' for p in PdfReader(sys.argv[2]).pages]))",
      dir,
      file,
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (py.status !== 0)
    throw new Stop(`pypdf could not read ${file}:\n${oneLine(py.stderr, 400)}`);
  return JSON.parse(py.stdout);
}

/** The title a PDF's metadata carries, when it carries a real one. */
function pdfTitle(file) {
  const info = spawnSync("pdfinfo", [file], { encoding: "utf8" });
  const title = info.stdout?.match(/^Title:[ \t]*(.+)$/m)?.[1].trim();
  return title && title.length >= 8 ? title : null;
}

async function pdf(input, out) {
  let file = input;
  if (/^https?:\/\//.test(input)) {
    file = out.replace(/\.[^.]*$/, "") + ".pdf";
    const type = await download(input, file).catch(() => null);
    if (type === null)
      throw new Stop(
        `${input} refused a plain download: open it in the browser and save it from there.`,
      );
  }
  const head = readFileSync(file).subarray(0, 5).toString();
  if (head !== "%PDF-")
    throw new Stop(
      `${shown(resolve(file))} is not a PDF (a refused download arrives as an HTML page).`,
    );
  const pages = pdfPages(file);
  const lines = [];
  pages.forEach((page, i) => {
    const paras = page
      .split(/\n\s*\n/)
      .map((para) =>
        para
          .replace(/-\n(?=\p{Ll})/gu, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean);
    paras.forEach((para, j) =>
      lines.push({
        label: `p. ${i + 1}`,
        text: j === 0 ? `[p. ${i + 1}] ${para}` : para,
      }),
    );
  });
  return {
    title: pdfTitle(file) ?? input.split(/[\\/]/).pop(),
    site: /^https?:/.test(input) ? new URL(input).hostname : "file",
    pages: pages.filter((p) => p.trim()).length,
    url: input,
    lines,
  };
}

await run(async () => {
  const { positional, flags } = parseArgs();
  const input = positional[0];
  if (!input || !flags.out) throw new Stop(usage(import.meta.url));
  const out = resolve(flags.out);
  mkdirSync(dirname(out), { recursive: true });
  const isPdf = existsSync(input)
    ? readFileSync(input).subarray(0, 5).toString() === "%PDF-"
    : /\.pdf($|\?)/i.test(input) || (await servesPdf(input));
  let doc;
  let lines;
  if (isPdf) {
    doc = await pdf(input, out);
    lines = doc.lines;
  } else {
    doc = await webPage(input);
    if (doc.lines.join(" ").length < 500)
      throw new Stop(
        `Only ${doc.lines.join(" ").length} chars of text at ${doc.url}: a wall, a sign-in, or a page drawn by script. Look at it with the browser skill.`,
      );
    lines = doc.lines.map((text, i) => ({ label: `¶${i + 1}`, text }));
  }
  const parts = withParts(lines);
  const head = [
    `# ${doc.title}`,
    `# ${[doc.site, doc.author, doc.date].filter(Boolean).join(" · ")}${doc.pages ? ` · ${doc.pages} pages` : ""}`,
    `# ${doc.url}`,
  ].join("\n");
  writeFileSync(out, `${head}\n\n${parts.text}`);
  const chars = lines.reduce((sum, line) => sum + line.text.length, 0);
  console.log(
    [
      `${oneLine(doc.title, 120)} — ${[doc.site, doc.author, doc.date].filter(Boolean).join(", ")}${doc.pages ? `, ${doc.pages} pages` : ""}`,
      `≈${Math.max(1, Math.round(chars / 1400))} min to read. ${readingLine(out, parts.index)}`,
      ...(doc.image ? [`Picture: ${doc.image}`] : []),
      `Opens: ${oneLine(
        lines
          .slice(0, 4)
          .map((l) => l.text)
          .join(" "),
        300,
      )}`,
    ].join("\n"),
  );
});
