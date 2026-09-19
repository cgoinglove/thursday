#!/usr/bin/env node
/**
 * How one account posts: its size, its latest posts (type, slides, ratio, how they
 * did, caption shape), and the pattern across them — read from the data the
 * profile page itself fetches, not from the screen.
 *
 *   node profile.mjs <handle | profile url> [--posts 12] [--out posts.json] [--sheet covers.png]
 */
import { writeFileSync } from "node:fs";
import { shipped } from "./lib.mjs";
import { media, patterns, postLine, short } from "./media.mjs";

const { fail, inPage, orFail, parseArgs } = await shipped(
  "browser/scripts/session.mjs",
);
const { makeSheet } = await shipped("browser/scripts/sheet.mjs");

const opts = parseArgs();
const handle = String(opts._[0] ?? "")
  .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
  .replace(/^@/, "")
  .split(/[/?]/)[0];
if (!handle)
  fail(
    "usage: node profile.mjs <handle> [--posts 12] [--out posts.json] [--sheet covers.png]",
  );
const want = Number(opts.posts ?? 12);

const started = Date.now();
const got = orFail(
  await inPage(
    async (page, { handle, want }, { media }) => {
      const posts = [];
      let profile = null;
      let more = true;
      const first = (text) => JSON.parse(text.split("\n")[0]);
      const listen = async (res) => {
        if (!/\/graphql/.test(res.url())) return;
        let text;
        try {
          text = await res.text();
        } catch {
          return;
        }
        try {
          if (
            text.includes("xdt_api__v1__feed__user_timeline_graphql_connection")
          ) {
            const c =
              first(text).data
                ?.xdt_api__v1__feed__user_timeline_graphql_connection;
            for (const e of c?.edges ?? []) posts.push(media(e.node));
            more = Boolean(c?.page_info?.has_next_page);
          } else if (!profile && text.includes('"follower_count"')) {
            const u = first(text).data?.user;
            if (u?.username?.toLowerCase() === handle.toLowerCase())
              profile = {
                handle: u.username,
                name: u.full_name,
                followers: u.follower_count,
                following: u.following_count ?? null,
                posts: u.media_count ?? null,
                verified: u.is_verified,
                private: u.is_private,
                category: u.category ?? null,
                bio: u.biography ?? "",
                link: u.bio_links?.[0]?.url ?? u.external_url ?? null,
              };
          }
        } catch {}
      };
      page.on("response", listen);
      try {
        await page.goto(`https://www.instagram.com/${handle}/`, {
          waitUntil: "domcontentloaded",
        });
        for (let i = 0; i < 40 && !(profile && posts.length); i++)
          await page.waitForTimeout(250);
        for (
          let tries = 0;
          posts.length < want && more && tries < 12;
          tries++
        ) {
          const had = posts.length;
          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight),
          );
          for (let i = 0; i < 24 && posts.length === had; i++)
            await page.waitForTimeout(250);
          if (posts.length === had) break;
        }
      } finally {
        page.off("response", listen);
      }
      const path = page.url().replace(/^https?:\/\/[^/]+/, "");
      if (/\/accounts\/login|\/challenge\//.test(path))
        return {
          error: `Not signed in (${path}). Borrow the kept sign-in first.`,
        };
      if (!profile && !posts.length)
        return {
          error: `Nothing came back for @${handle}: no such account, a private one, or the page changed (it no longer fetches xdt_api__v1__feed__user_timeline_graphql_connection). Open it and look.`,
        };
      const seen = new Set();
      return {
        profile,
        // Newest first, the pinned ones after: the grid puts old pinned posts on top
        posts: posts
          .filter((p) => !seen.has(p.url) && seen.add(p.url))
          .sort((a, b) => a.pinned - b.pinned || b.at - a.at)
          .slice(0, want),
      };
    },
    { handle, want },
    { media },
  ),
);

const { profile, posts } = got;
if (opts.out)
  writeFileSync(opts.out, JSON.stringify({ profile, posts }, null, 1));
if (profile)
  console.log(
    `@${profile.handle} (${profile.name}) — ${short(profile.followers)} followers, ${profile.posts ?? "?"} posts${profile.verified ? ", verified" : ""}${profile.category ? `, ${profile.category}` : ""}\n` +
      `bio: ${profile.bio.replace(/\s+/g, " ").slice(0, 160)}`,
  );
posts.forEach((p, i) => {
  console.log(postLine(p, i));
});
for (const line of patterns(posts)) console.log(`pattern: ${line}`);
if (opts.sheet) {
  const made = await makeSheet(
    posts.map((p, i) => ({
      src: p.cover,
      label: `#${i + 1} ${p.type}${p.type === "carousel" ? `×${p.slides}` : ""} ${p.ratio ?? ""} likes ${short(p.likes)}`,
    })),
    opts.sheet,
  );
  console.log(`covers: ${made.out}`);
}
console.log(
  `${posts.length} posts in ${((Date.now() - started) / 1000).toFixed(1)}s${opts.out ? ` → ${opts.out} (full captions, every slide's picture url)` : ""}`,
);
