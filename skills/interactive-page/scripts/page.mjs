#!/usr/bin/env node
// Kept where skills installed before 0.14 call it: a document to read is the artifact
// skill's now (artifact/scripts/document.mjs), and every command here runs that one.
await import(
  new URL("../../artifact/scripts/document.mjs", import.meta.url).href
);
