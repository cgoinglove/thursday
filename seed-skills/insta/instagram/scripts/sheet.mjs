#!/usr/bin/env node
/**
 * A feed as one image, each picture with a label under it: the covers of every post
 * `profile.mjs` or `search.mjs` saved, or every slide of one of them. Any other
 * pictures go straight to the browser skill's sheet.
 *
 *   node sheet.mjs --out sheet.png <posts.json>              covers of every post
 *   node sheet.mjs --out sheet.png <posts.json> --post 3     every slide of post 3
 *   node sheet.mjs --out sheet.png <image url | file>...     any pictures
 */
import { readFileSync } from "node:fs";
import { shipped } from "./lib.mjs";
import { short } from "./media.mjs";

const { fail, parseArgs } = await shipped("browser/scripts/session.mjs");
const { makeSheet, pictures } = await shipped("browser/scripts/sheet.mjs");

const opts = parseArgs();
if (!opts.out || !opts._.length)
  fail(
    "usage: node sheet.mjs --out sheet.png <posts.json> [--post N] | <image url | file>...",
  );
let items;
if (opts._[0].endsWith(".json")) {
  const saved = JSON.parse(readFileSync(opts._[0], "utf8"));
  const posts = saved.posts ?? saved;
  if (opts.post) {
    const p = posts[Number(opts.post) - 1];
    if (!p) fail(`No post ${opts.post}; there are ${posts.length}.`);
    items = p.images.map((src, i) => ({
      src,
      label: `${i + 1}/${p.images.length} ${p.ratio ?? ""}`,
    }));
  } else
    items = posts.map((p, i) => ({
      src: p.cover,
      label: `#${i + 1} ${p.type}${p.type === "carousel" ? `×${p.slides}` : ""} ${p.ratio ?? ""} likes ${short(p.likes)}${p.owner ? ` @${p.owner}` : ""}`,
    }));
} else items = pictures(opts._);
const made = await makeSheet(items, opts.out, Number(opts.cols ?? 4));
console.log(
  `${made.out} — ${items.length} pictures${made.missing ? `, ${made.missing} did not load` : ""}`,
);
