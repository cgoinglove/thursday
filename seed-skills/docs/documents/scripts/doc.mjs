#!/usr/bin/env node
// Office documents made and read from the shell. Run with no arguments for the list.

import { extname } from "node:path";
import { printPdf } from "./lib/browser.mjs";
import { input, output, parseArgs, SCRIPT, Stop } from "./lib/kit.mjs";
import { report } from "./lib/report.mjs";

// Libraries that probe `globalThis.localStorage` make Node print a warning about nothing here
const warn = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (!String(warning).includes("localStorage"))
    warn.call(process, warning, ...rest);
};

const USAGE = `node ${SCRIPT} <command> …

Make
  new <letter|report|resume> <name>            a styled HTML page in your artifacts folder, to write and print
  pdf <page.html> [--out name]                 print it to PDF; pictures of every page come with it
  invoice <data.json> [--out name]             an invoice, quote or receipt: totals worked out, HTML + PDF
  deck <outline.json> [--out name]             a .pptx deck and its PDF twin from an outline
  docx <text.md> [--out name]                  a Word file and its PDF twin from Markdown
  xlsx <book.json> [--out name]                a spreadsheet: headers, formats, formulas, totals

Read and look
  read <file> [--pages 1-3] [--layout]         the text of a .pdf .docx .pptx .xlsx .csv (a sheet as a summary)
  look <file> [--pages 1-3] [--grid]           a .pdf's pages as pictures to look_at (--grid: 50pt lines)

Change
  pages <a.pdf[:1-3][@90]>... [--out name]    merge, pick, reorder or turn pages
  split <file.pdf> [--every N | --at 4,9]      one PDF into several
  fields <form.pdf>                            a form's fillable fields: name, kind, choices, place
  fill <form.pdf> <values.json> [--flatten]    fill fields by name
  stamp <file.pdf> <marks.json>                print text, ticks or a signature onto pages
  segments <file> [--out segments.json]        the text of a .docx .pptx .xlsx .pdf to translate, numbered
  apply <file> <translated.json>... [--out name]   the same file with the numbered text replaced`;

/** The PDF of an HTML page, with a picture of each page to look at. */
async function pdfCommand(file, opts) {
  const source = input(file, ["html", "htm"]);
  const out = output(
    opts.out,
    source
      .split("/")
      .pop()
      .replace(/\.html?$/i, ""),
    "pdf",
  );
  const { broken, wide } = await printPdf(source, out);
  await report(out, { broken, wide });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  const [a, b] = opts._;
  switch (command) {
    case "pdf":
      return pdfCommand(a, opts);
    case "new":
      return (await import("./lib/templates.mjs")).newPage(a, b);
    case "invoice":
      return (await import("./lib/invoice.mjs")).invoice(a, opts);
    case "deck":
      return (await import("./lib/deck.mjs")).deck(a, opts);
    case "docx":
      return (await import("./lib/word.mjs")).docx(a, opts);
    case "xlsx":
      return (await import("./lib/sheet.mjs")).xlsx(a, opts);
    case "read":
      return console.log(await readAny(a, opts));
    case "look": {
      const file = input(a);
      if (extname(file).toLowerCase() !== ".pdf")
        throw new Stop(
          `look draws PDFs. A .docx or .pptx made here has a PDF twin beside it; for another file, \`read\` it.`,
        );
      return (await import("./lib/pdf.mjs")).lookPdf(file, opts);
    }
    case "pages":
      return (await import("./lib/pdf.mjs")).combine(opts._, opts);
    case "split":
      return (await import("./lib/pdf.mjs")).split(a, opts);
    case "fields":
      return (await import("./lib/pdf.mjs")).listFields(a);
    case "fill":
      return (await import("./lib/pdf.mjs")).fill(a, b, opts);
    case "stamp":
      return (await import("./lib/pdf.mjs")).stamp(a, b, opts);
    case "segments":
      return (await import("./lib/translate.mjs")).segments(a, opts);
    case "apply":
      return (await import("./lib/translate.mjs")).apply(
        a,
        opts._.slice(1),
        opts,
      );
    default:
      console.log(USAGE);
      if (command && command !== "help") process.exitCode = 1;
  }
}

async function readAny(file, opts) {
  const full = input(file);
  const kind = extname(full).slice(1).toLowerCase();
  if (kind === "pdf")
    return (await import("./lib/pdf.mjs")).readPdf(full, opts);
  if (kind === "docx") return (await import("./lib/word.mjs")).readDocx(full);
  if (kind === "pptx") return (await import("./lib/deck.mjs")).readPptx(full);
  if (["xlsx", "xlsm", "csv"].includes(kind))
    return (await import("./lib/sheet.mjs")).summarize(full, opts);
  throw new Stop(`read takes .pdf .docx .pptx .xlsx .csv, not .${kind}`);
}

try {
  await main();
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  process.exit(1);
}
