#!/usr/bin/env node
/**
 * What Instagram's own search shows for a topic — posts and reels, with how each
 * did — and the accounts behind them, read from the data the search page fetches.
 * One word or a #tag finds more than a phrase.
 *
 *   node search.mjs "<topic>" [--type reel|carousel|image] [--max 24] [--out found.json] [--sheet covers.png]
 */
import { writeFileSync } from "node:fs";
import { fail, inPage, orFail, parseArgs } from "./lib.mjs";
import { media, postLine, short } from "./media.mjs";
import { makeSheet } from "./sheet.mjs";

const opts = parseArgs();
const topic = opts._[0];
if (!topic)
  fail(
    'usage: node search.mjs "<topic>" [--type reel|carousel|image] [--max 24] [--out found.json] [--sheet covers.png]',
  );
const max = Number(opts.max ?? 24);
const type = opts.type ?? null;
if (type && !["reel", "carousel", "image"].includes(type))
  fail("--type is reel, carousel or image");

const started = Date.now();
const got = orFail(
  await inPage(
    async (page, { topic, max, type }, { media }) => {
      const found = [];
      let more = true;
      let pages = 0;
      const listen = async (res) => {
        if (!/\/graphql/.test(res.url())) return;
        let text;
        try {
          text = await res.text();
        } catch {
          return;
        }
        if (!text.includes("xdt_fbsearch__top_serp_graphql")) return;
        try {
          const c = JSON.parse(text.split("\n")[0]).data
            ?.xdt_fbsearch__top_serp_graphql;
          pages++;
          more = Boolean(c?.page_info?.has_next_page);
          const walk = (o) => {
            if (!o || typeof o !== "object") return;
            if (typeof o.code === "string" && "media_type" in o) {
              found.push(media(o));
              return;
            }
            for (const v of Object.values(o)) walk(v);
          };
          walk(c?.edges);
        } catch {}
      };
      const kept = () => found.filter((p) => !type || p.type === type).length;
      page.on("response", listen);
      try {
        await page.goto(
          `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(topic)}`,
          { waitUntil: "domcontentloaded" },
        );
        for (let i = 0; i < 60 && !pages; i++) await page.waitForTimeout(250);
        for (let tries = 0; kept() < max && more && tries < 8; tries++) {
          const had = pages;
          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
          );
          for (let i = 0; i < 32 && pages === had; i++)
            await page.waitForTimeout(250);
          if (pages === had) break;
        }
      } finally {
        page.off("response", listen);
      }
      const path = page.url().replace(/^https?:\/\/[^/]+/, "");
      if (/\/accounts\/login|\/challenge\//.test(path))
        return {
          error: `Not signed in (${path}). Borrow the kept sign-in first.`,
        };
      if (!pages)
        return {
          error:
            "The search page fetched nothing this script knows (xdt_fbsearch__top_serp_graphql): the page changed, or something covers it. Open it and look.",
        };
      const seen = new Set();
      return {
        posts: found
          .filter((p) => !seen.has(p.url) && seen.add(p.url))
          .filter((p) => !type || p.type === type)
          .slice(0, max),
      };
    },
    { topic, max, type },
    { media },
  ),
);

const { posts } = got;
if (opts.out)
  writeFileSync(opts.out, JSON.stringify({ topic, posts }, null, 1));
posts.forEach((p, i) => {
  console.log(postLine(p, i));
});
// The accounts behind the results, by the likes they drew here
const accounts = Object.values(
  posts.reduce((all, p) => {
    const a = (all[p.owner] ??= { owner: p.owner, posts: 0, likes: 0 });
    a.posts++;
    a.likes += p.likes ?? 0;
    return all;
  }, {}),
).sort((a, b) => b.likes - a.likes);
console.log(
  `accounts: ${accounts
    .slice(0, 10)
    .map((a) => `@${a.owner} (${a.posts}, likes ${short(a.likes)})`)
    .join(", ")}`,
);
if (opts.sheet) {
  const made = await makeSheet(
    posts.map((p, i) => ({
      src: p.cover,
      label: `#${i + 1} ${p.type}${p.type === "carousel" ? `×${p.slides}` : ""} likes ${short(p.likes)} @${p.owner}`,
    })),
    opts.sheet,
  );
  console.log(`covers: ${made.out}`);
}
console.log(
  `${posts.length} results for "${topic}"${type ? ` (${type})` : ""} in ${((Date.now() - started) / 1000).toFixed(1)}s${opts.out ? ` → ${opts.out}` : ""}`,
);
