#!/usr/bin/env node
/**
 * The chosen stories, read from the publisher: where the link really goes, the page's own
 * title, description and opening paragraphs, and its picture saved beside the rest with the
 * credit it takes. A publisher that refuses is passed over for the next outlet that carried
 * the same story. Writes <out>/stories.json for the page, each story's own words into
 * <out>/text-<n>.md — files that each fit one read — and prints a line a story.
 *
 *   node story.mjs <cand.json> <id>... --out <dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ago,
  get,
  host,
  meta,
  parseArgs,
  plain,
  pool,
  run,
  Stop,
  shown,
} from "./lib.mjs";

const USAGE = "usage: node story.mjs <cand.json> <id>... --out <dir>";
// Outlets tried for one story before it goes without its page
const TRIES = 3;
// A picture narrower than this is an icon or a logo, not a photo
const MIN_WIDTH = 480;
// What of the article's own words comes back for the summary
const LEAD_CHARS = 900;
/**
 * What one bash call shows before the shell cuts the middle to a file (config TOOL_OUTPUT
 * is 8,000). The stories' words go into files of this size, so each is one whole read.
 */
const PART_CHARS = 7000;

const oneLine = (text, max) => {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

// A kit script reaches the shipped skills through the folder a bot's shell names
const SKILLS = process.env.THURSDAY_SKILLS;
const shipped = (path) => pathToFileURL(join(SKILLS ?? ".", path)).href;

const { imageSize } = await import(
  shipped("browser/scripts/image-size.mjs")
).catch(() => ({ imageSize: () => null }));

const isGoogle = (url) => /^https?:\/\/news\.google\.com\//i.test(url);

/**
 * Google News links followed to the publishers they stand for. The address is not in the
 * link — the page Google serves draws it by script — so the links are opened in this job's
 * browser session, which opens a headless browser itself when none is. Only the stories
 * already chosen come through here, never the whole candidate list. Answers a
 * `{ url } | { error }` per link.
 */
async function resolveGoogle(links) {
  if (!SKILLS)
    throw new Stop(
      "THURSDAY_SKILLS is not set, so the browser skill cannot be found: run this from a bot's shell in the app.",
    );
  const { inPage } = await import(shipped("browser/scripts/session.mjs"));
  const found = await inPage(
    async (page, { links }) => {
      const stillGoogle = (url) =>
        /^https?:\/\/(?:[a-z0-9-]+\.)*google\.com\//i.test(url);
      const tab = await page.context().newPage();
      const out = {};
      try {
        for (const link of links) {
          try {
            await tab.goto(link, {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });
            let url = tab.url();
            // The page navigates to the publisher on its own; 15s is a slow phone's worth
            for (let i = 0; i < 30 && stillGoogle(url); i++) {
              await tab.waitForTimeout(500);
              url = tab.url();
            }
            out[link] = stillGoogle(url)
              ? { error: "Google News stayed on its own page" }
              : { url };
          } catch (error) {
            out[link] = {
              error: String((error && error.message) || error)
                .replace(/\s+/g, " ")
                .slice(0, 160),
            };
          }
        }
      } finally {
        await tab.close();
      }
      return out;
    },
    { links },
  );
  return found ?? {};
}

/** The article's own opening, from its paragraphs: past the navigation, before the footer. */
function leadOf(html) {
  const body = html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? html;
  const paras = [];
  let size = 0;
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = plain(m[1]);
    // Bylines, captions and cookie lines are short; a paragraph of the story is not
    if (text.length < 60 || /cookie|subscribe|newsletter|©/i.test(text))
      continue;
    paras.push(text);
    size += text.length;
    if (size > LEAD_CHARS) break;
  }
  if (paras.length) return paras.join(" ").slice(0, LEAD_CHARS);
  // A page drawn by script keeps its words in its structured data
  const data = html.match(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  if (!data) return "";
  try {
    return plain(JSON.parse(`"${data}"`)).slice(0, LEAD_CHARS);
  } catch {
    return "";
  }
}

const EXT = {
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

async function savePicture(src, referer, file) {
  const res = await get(src, { headers: { referer, accept: "image/*" } });
  if (!res.ok) return null;
  const type = (res.headers.get("content-type") ?? "").split(";")[0];
  if (!type.startsWith("image/")) return null;
  const path = `${file}.${EXT[type] ?? "jpg"}`;
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  const size = imageSize(path);
  if (size && size.w < MIN_WIDTH) return null;
  return { file: path, w: size?.w ?? null, h: size?.h ?? null };
}

/** One outlet's page, at the address its link resolved to; `refused` sends the next outlet. */
async function readOutlet(url, outlet, story, out) {
  const res = await get(url);
  if (!res.ok)
    return { refused: `${host(url)} answered ${res.status || res.error}` };
  const html = await res.text();
  const pageUrl = res.url || url;
  const abs = (src) =>
    src?.startsWith("//")
      ? `https:${src}`
      : src?.startsWith("/")
        ? pageUrl.match(/^https?:\/\/[^/]+/)[0] + src
        : src;
  const src = abs(
    meta(html, "og:image") ??
      meta(html, "twitter:image") ??
      meta(html, "twitter:image:src"),
  );
  const site = meta(html, "og:site_name") ?? outlet.source ?? host(pageUrl);
  const title = meta(html, "og:title") ?? outlet.title;
  const image = src
    ? await savePicture(src, pageUrl, join(out, story.id))
    : null;
  return {
    url: meta(html, "og:url")?.startsWith("http")
      ? meta(html, "og:url")
      : pageUrl,
    site,
    title,
    description:
      meta(html, "og:description") ?? meta(html, "description") ?? "",
    lead: leadOf(html),
    published: meta(html, "article:published_time") ?? outlet.published,
    image: image && {
      ...image,
      site,
      credit: `${site} — ${title}`.slice(0, 140),
    },
  };
}

/** The stories' own words in files of one read each, and which file holds which story. */
function writeParts(stories, out) {
  const parts = [];
  const partOf = new Map();
  for (const s of stories) {
    if (!s.lead && !s.description) continue;
    const block = [
      `## ${s.id} · ${s.site} · ${s.outlets} outlet(s)${s.published ? ` · ${ago(s.published)} old` : ""}`,
      s.title,
      s.url,
      s.description ? `> ${s.description}` : "",
      s.lead,
    ]
      .filter(Boolean)
      .join("\n");
    let part = parts.at(-1);
    if (!part || part.chars + block.length > PART_CHARS) {
      part = { n: parts.length + 1, ids: [], blocks: [], chars: 0 };
      parts.push(part);
    }
    part.ids.push(s.id);
    part.blocks.push(block);
    part.chars += block.length + 2;
    partOf.set(s.id, part.n);
  }
  for (const part of parts) {
    part.file = join(out, `text-${part.n}.md`);
    writeFileSync(part.file, `${part.blocks.join("\n\n")}\n`);
  }
  return { parts, partOf };
}

run(async () => {
  const opts = parseArgs();
  const [candFile, ...ids] = opts._;
  if (!candFile || !ids.length || !opts.out) throw new Stop(USAGE);
  const cand = JSON.parse(readFileSync(candFile, "utf8"));
  const all = cand.topics.flatMap((t) => t.stories);
  const missing = ids.filter((id) => !all.some((s) => s.id === id));
  if (missing.length)
    throw new Stop(
      `No story ${missing.join(", ")} in ${candFile}: use the ids news.mjs printed.`,
    );
  const out = resolve(String(opts.out));
  mkdirSync(out, { recursive: true });

  const reading = ids.map((id) => ({
    story: all.find((s) => s.id === id),
    text: null,
    image: null,
    tried: [],
  }));
  let followed = 0;
  let lost = 0;

  // One outlet a round, so the browser is asked for every story's address in one go and a
  // second outlet is only ever opened for the stories that still want one
  for (let round = 0; round < TRIES; round++) {
    const todo = reading.filter((r) => !r.image && r.story.outlets[round]);
    if (!todo.length) break;
    const links = [
      ...new Set(todo.map((r) => r.story.outlets[round].link).filter(isGoogle)),
    ];
    const found = links.length ? await resolveGoogle(links) : {};
    await pool(todo, 6, async (r) => {
      const outlet = r.story.outlets[round];
      const at = isGoogle(outlet.link)
        ? (found[outlet.link] ?? { error: "no answer from Google News" })
        : { url: outlet.link };
      if (at.error) {
        r.tried.push(`${outlet.source}: ${at.error}`);
        lost++;
        return;
      }
      if (isGoogle(outlet.link)) followed++;
      let got;
      try {
        got = await readOutlet(at.url, outlet, r.story, out);
      } catch (error) {
        got = { refused: `${outlet.source}: ${error.message}` };
      }
      if (got.refused) {
        r.tried.push(got.refused);
        return;
      }
      r.text ??= got;
      if (got.image) r.image = got.image;
      else r.tried.push(`${got.site}: no picture`);
    });
  }

  if (lost && !followed && reading.every((r) => !r.text))
    throw new Stop(
      `No Google News link could be followed to its publisher (${lost} tried). Another story will not help: nothing can be read until this works again. Publisher feeds carry their own addresses — gather with news.mjs --feed "<label>=<rss url>" instead.`,
    );

  const stories = reading.map(({ story, text, image, tried }) => ({
    id: story.id,
    topic: story.topic,
    title: text?.title ?? story.title,
    site: text?.site ?? story.source,
    url: text?.url ?? story.outlets[0].link,
    published: text?.published ?? story.published,
    outlets: story.count ?? story.outlets.length,
    description: text?.description ?? "",
    lead: text?.lead ?? "",
    image,
    tried,
  }));

  const file = join(out, "stories.json");
  writeFileSync(file, JSON.stringify(stories, null, 1));
  const { parts, partOf } = writeParts(stories, out);

  for (const s of stories) {
    const pic = s.image
      ? `${s.image.w ? `${s.image.w}x${s.image.h}` : "picture"}${s.image.site && s.image.site !== s.site ? ` from ${s.image.site}` : ""}`
      : "NO PICTURE";
    const words = partOf.has(s.id)
      ? `text-${partOf.get(s.id)}.md`
      : `NO TEXT (${oneLine(s.tried.join("; ") || "empty", 150)})`;
    console.log(
      `${s.id} · ${s.site} · ${pic} · ${s.outlets} outlet(s) · ${words}\n   ${oneLine(s.title, 120)}`,
    );
  }
  console.log(
    `\n${shown(file)}: ${stories.length} stories, ${stories.filter((s) => s.image).length} with a picture.`,
  );
  for (const part of parts)
    console.log(
      `cat ${shown(part.file)}   # ${part.ids.join(", ")} — ${part.chars.toLocaleString("en")} chars, one read`,
    );
});
