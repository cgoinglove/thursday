#!/usr/bin/env node
// One part of a transcript or text file written by this skill's scripts, which fits one read.
//
//   node part.mjs <file> <n>
import { readFileSync } from "node:fs";
import { parseArgs, run, Stop, usage } from "./lib.mjs";

await run(async () => {
  const [file, n] = parseArgs().positional;
  if (!file || !n) throw new Stop(usage(import.meta.url));
  const parts = readFileSync(file, "utf8").split(/^(?=## Part \d+ · )/m);
  const part = parts.find((one) => one.startsWith(`## Part ${Number(n)} · `));
  const last = parts.filter((one) => one.startsWith("## Part ")).length;
  if (!part) throw new Stop(`No part ${n}: ${file} has parts 1-${last}.`);
  console.log(`${part.trimEnd()}\n[part ${Number(n)} of ${last}]`);
});
