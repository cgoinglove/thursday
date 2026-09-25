#!/usr/bin/env node
/**
 * A document's page as a Word file: the page opened in a headless browser of its own and
 * turned into a .docx there by the page's own converter (docx.js), as Export › Word file does
 * for someone reading it — the kit's converter as it is now, over the copy the page was made
 * with, so a page made before a fix to it gets the fix. Prints the file written, and the
 * pictures that could not be put in.
 *
 *   node word.mjs <page.html> --out <file.docx>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveFolder } from "../../../browser/scripts/serve.mjs";
import {
  fail,
  inPageApart,
  orFail,
  parseArgs,
} from "../../../browser/scripts/session.mjs";

const opts = parseArgs();
const file = opts._[0] && resolve(opts._[0]);
if (!file || typeof opts.out !== "string")
  fail("usage: node word.mjs <page.html> --out <file.docx>");
const converter = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "docx.js"),
  "utf8",
);

// The page's folder, so pictures beside it load
const served = await serveFolder(dirname(file));
try {
  const done = orFail(
    await inPageApart(
      async (page, { url, converter }) => {
        const tab = await page.context().newPage();
        try {
          await tab.setViewportSize({ width: 1024, height: 1400 });
          await tab.goto(url, { waitUntil: "load" });
          await tab.evaluate(() => document.fonts.ready);
          await tab.addScriptTag({ content: converter });
          return await tab.evaluate(async () => {
            if (!window.shell?.docx)
              return { error: "this page is not a document: no #paper in it" };
            const { bytes, missed } = await window.shell.docx();
            let text = "";
            for (let i = 0; i < bytes.length; i += 0x8000)
              text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return { data: btoa(text), missed };
          });
        } finally {
          await tab.close();
        }
      },
      { url: served.url(basename(file)), converter },
    ),
  );
  writeFileSync(opts.out, Buffer.from(done.data, "base64"));
  console.log(
    JSON.stringify({ file: resolve(opts.out), missed: done.missed ?? [] }),
  );
} finally {
  served.close();
}
