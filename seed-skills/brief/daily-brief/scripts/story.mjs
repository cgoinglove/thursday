#!/usr/bin/env node
/**
 * The chosen stories, read from the publisher: where the link really goes, the page's own
 * title, description and opening paragraphs, and its picture saved beside the rest with the
 * credit it takes. A publisher that refuses is passed over for the next outlet that carried
 * the same story. Writes <out>/stories.json and prints what each story says, for writing.
 *
 *   node story.mjs <cand.json> <id>... --out <dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { get, host, meta, parseArgs, plain, pool, run, Stop } from "./lib.mjs";

const USAGE = "usage: node story.mjs <cand.json> <id>... --out <dir>";
// Outlets tried for one story before it goes without its page
const TRIES = 3;
// A picture narrower than this is an icon or a logo, not a photo
const MIN_WIDTH = 480;
// What of the article's own words comes back for the summary
const LEAD_CHARS = 900;

const { imageSize } = await import(
  `${process.env.THURSDAY_SKILLS ?? "."}/browser/scripts/image-size.mjs`
).catch(() => ({ imageSize: () => null }));

/**
 * A Google News link, resolved to the publisher's. The article id is signed on the page
 * Google serves for it, and the signature buys the real address from Google's own endpoint.
 */
async function resolveGoogle(link) {
  const id = link.match(/\/articles\/([^?]+)/)?.[1];
  if (!id) return link;
  const page = await get(`https://news.google.com/rss/articles/${id}`);
  if (!page.ok) throw new Error(`Google News answered ${page.status}`);
  const html = await page.text();
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts)
    throw new Error(
      "Google News no longer signs its article page (data-n-a-sg)",
    );
  const req = [
    [
      "Fbv4je",
      JSON.stringify([
        "garturlreq",
        [
          [
            "X",
            "X",
            ["X", "X"],
            null,
            null,
            1,
            1,
            "US:en",
            null,
            1,
            null,
            null,
            null,
            null,
            null,
            0,
            1,
          ],
          "X",
          "X",
          1,
          [1, 1, 1],
          1,
          1,
          null,
          0,
          0,
          null,
          0,
        ],
        id,
        Number(ts),
        sg,
      ]),
      null,
      "generic",
    ],
  ];
  const res = await fetch(
    "https://news.google.com/_/DotsSplashUi/data/batchexecute",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: `f.req=${encodeURIComponent(JSON.stringify([req]))}`,
      signal: AbortSignal.timeout(15000),
    },
  );
  const url = (await res.text()).match(
    /garturlres\\",\\"(https?:[^\\]+)\\"/,
  )?.[1];
  if (!url) throw new Error("Google News did not give the article's address");
  return url;
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

/** One outlet's page: false when it refused, so the next outlet is tried. */
async function readOutlet(outlet, story, out) {
  const url = outlet.link.includes("news.google.com")
    ? await resolveGoogle(outlet.link)
    : outlet.link;
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

  const stories = await pool(
    ids.map((id) => all.find((s) => s.id === id)),
    6,
    async (story) => {
      const tried = [];
      let text = null;
      let image = null;
      for (const outlet of story.outlets.slice(0, TRIES)) {
        let got;
        try {
          got = await readOutlet(outlet, story, out);
        } catch (error) {
          got = { refused: `${outlet.source}: ${error.message}` };
        }
        if (got.refused) {
          tried.push(got.refused);
          continue;
        }
        text ??= got;
        image ??= got.image;
        if (image) break;
        tried.push(`${got.site}: no picture`);
      }
      return {
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
      };
    },
  );

  const file = join(out, "stories.json");
  writeFileSync(file, JSON.stringify(stories, null, 1));
  for (const s of stories) {
    const pic = s.image
      ? `${s.image.w ? `${s.image.w}x${s.image.h}` : "picture"}${s.image.site && s.image.site !== s.site ? ` from ${s.image.site}` : ""}`
      : "NO PICTURE";
    console.log(
      `\n## ${s.id} · ${s.site} · ${pic} · ${s.outlets} outlet(s)\n${s.title}`,
    );
    if (s.description) console.log(`> ${s.description.slice(0, 300)}`);
    if (s.lead) console.log(s.lead);
    if (!s.lead && !s.description)
      console.log(`(the page gave no text: ${s.tried.join("; ") || "empty"})`);
    else if (s.tried.length)
      console.log(`(passed over: ${s.tried.join("; ")})`);
  }
  console.log(
    `\n${file}: ${stories.length} stories, ${stories.filter((s) => s.image).length} with a picture.`,
  );
});
