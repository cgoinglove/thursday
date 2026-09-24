#!/usr/bin/env node
/**
 * Candidates for a brief: every topic searched on Google News (and any publisher feeds),
 * kept to the freshness window, copies of one story under one title folded into one line,
 * and the very articles a recent brief carried left out. Writes them all to --out and
 * prints the first few a topic in the source's own order, one line each, then what the
 * recent briefs told, for choosing: which stories are the same news is the reader's call.
 *
 *   node news.mjs "<label>=<query>"... --out cand.json [--lang en] [--country US]
 *     [--hours 30] [--per 8] [--feed "<label>=<rss url>"]... [--avoid a.com,b.com] [--prefer c.com]
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  ago,
  artifactsDir,
  decode,
  get,
  host,
  list,
  onDomain,
  parseArgs,
  plain,
  pool,
  run,
  Stop,
} from "./lib.mjs";

const USAGE =
  'usage: node news.mjs "<label>=<query>"... --out cand.json [--lang en] [--country US] [--hours 30] [--per 8] [--feed "<label>=<rss url>"]... [--avoid a.com] [--prefer b.com]';

// Briefs this recent are what "already told" means
const SEEN_DAYS = 4;
// Stories a topic keeps in the file: the ones printed and the next few, for spares
const KEEP = 15;

/** A title as its copies share it — a wire story run by many outlets — whatever its case and marks. */
const sameTitle = (title = "") =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Items of an RSS or Atom feed, as { title, link, published, source, sourceUrl, summary }. */
function readFeed(xml, fallbackSource) {
  const blocks =
    xml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const tag = (block, name) =>
    block.match(
      new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"),
    )?.[1];
  return blocks.map((b) => {
    const link =
      decode(tag(b, "link") ?? "").trim() ||
      decode(b.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] ?? "");
    const sourceTag = b.match(
      /<source\b[^>]*url=["']([^"']+)["'][^>]*>([\s\S]*?)<\/source>/i,
    );
    let title = plain(tag(b, "title") ?? "");
    const source = sourceTag ? plain(sourceTag[2]) : fallbackSource;
    // Google News ends every title with " - <outlet>"
    if (sourceTag && title.endsWith(` - ${source}`))
      title = title.slice(0, -(source.length + 3));
    const summary = plain(tag(b, "description") ?? tag(b, "summary") ?? "");
    return {
      title,
      link,
      published: plain(
        tag(b, "pubDate") ??
          tag(b, "published") ??
          tag(b, "updated") ??
          tag(b, "dc:date") ??
          "",
      ),
      source,
      sourceUrl: sourceTag ? decode(sourceTag[1]) : link,
      // Google's own description only repeats the title
      summary: sourceTag || summary === title ? "" : summary.slice(0, 300),
    };
  });
}

const safeIso = (s) => {
  const t = Date.parse(s ?? "");
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** Today where the reader is, as `page.mjs` names the brief it writes. */
function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * What the bot's recent briefs told, read off the pages themselves. Today's own brief is
 * not one of them: a second run the same day remakes it, over the same news, and
 * `page.mjs` writes it to the same file.
 */
function toldLately() {
  const dir = artifactsDir();
  if (!existsSync(dir)) return [];
  const since = Date.now() - SEEN_DAYS * 86_400_000;
  const mine = `brief-${today()}.html`;
  const told = [];
  for (const name of readdirSync(dir)) {
    if (!/^brief-.*\.html$/.test(name) || name === mine) continue;
    const path = join(dir, name);
    if (statSync(path).mtimeMs < since) continue;
    const data = readFileSync(path, "utf8").match(
      /<script type="application\/json" id="brief-data">([\s\S]*?)<\/script>/,
    )?.[1];
    if (!data) continue;
    try {
      for (const t of JSON.parse(data).told ?? [])
        told.push({ ...t, brief: name });
    } catch {}
  }
  return told;
}

run(async () => {
  const opts = parseArgs();
  if (!opts.out || (!opts._.length && !opts.feed)) throw new Stop(USAGE);
  const lang = String(opts.lang ?? "en").toLowerCase();
  const country = String(opts.country ?? "US").toUpperCase();
  const hours = Number(opts.hours ?? 30);
  const per = Number(opts.per ?? 8);
  const avoid = list(opts.avoid);
  const prefer = list(opts.prefer);
  const edition = `hl=${lang === "en" ? `en-${country}` : lang}&gl=${country}&ceid=${country}:${lang}`;

  const split = (spec) => {
    const at = spec.indexOf("=");
    return at > 0
      ? [spec.slice(0, at).trim(), spec.slice(at + 1).trim()]
      : [spec.trim(), spec.trim()];
  };
  const sources = [
    ...opts._.map((spec) => {
      const [label, query] = split(spec);
      const days = Math.max(1, Math.ceil(hours / 24));
      const url =
        query.toLowerCase() === "top"
          ? `https://news.google.com/rss?${edition}`
          : `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${days}d`)}&${edition}`;
      return { label, query, url };
    }),
    ...list(opts.feed).map((spec) => {
      const [label, url] = split(spec);
      return { label, query: url, url, feed: true };
    }),
  ];

  const now = Date.now();
  const fetched = await pool(sources, 6, async (s) => {
    const res = await get(s.url, { lang });
    if (!res.ok)
      return {
        ...s,
        error: `answered ${res.status}${res.error ? ` (${res.error})` : ""}`,
      };
    const items = readFeed(await res.text(), host(s.url));
    return { ...s, items, total: items.length };
  });
  const broken = fetched.filter((s) => s.error);
  if (broken.length === fetched.length)
    throw new Stop(
      `No source answered: ${broken.map((s) => `${s.label} ${s.error}`).join("; ")}`,
    );

  // The very article, by its link or its title; the same news told again in another is
  // left for the reader of the list, who has the briefs' headlines under it
  const told = toldLately();
  const toldLinks = new Set(told.flatMap((t) => t.links ?? []));
  const toldTitles = new Set(told.map((t) => sameTitle(t.title)));
  const kept = [];
  let old = 0;
  let avoided = 0;
  let repeat = 0;
  const topics = fetched.map((s, t) => {
    const letter = String.fromCharCode(97 + (t % 26));
    const stories = [];
    for (const item of s.items ?? []) {
      const published = safeIso(item.published);
      if (!item.title || !item.link) continue;
      if (published && now - Date.parse(published) > hours * 3_600_000) {
        old++;
        continue;
      }
      if (avoid.length && onDomain(item.sourceUrl, avoid)) {
        avoided++;
        continue;
      }
      const key = sameTitle(item.title);
      if (toldLinks.has(item.link) || toldTitles.has(key)) {
        repeat++;
        continue;
      }
      const outlet = { ...item, published };
      // Another outlet's copy, under this topic or another, joins the first telling
      const same = kept.find((k) => k.key === key);
      if (same) {
        same.outlets.push(outlet);
        if (same.topic !== s.label && !same.alsoIn.includes(s.label))
          same.alsoIn.push(s.label);
        continue;
      }
      const story = { topic: s.label, key, outlets: [outlet], alsoIn: [] };
      kept.push(story);
      stories.push(story);
    }
    // In the source's own order: Google's is its relevance, a feed's is its newest first
    stories.forEach((x, i) => {
      x.id = `${letter}${i + 1}`;
    });
    return {
      label: s.label,
      query: s.query,
      error: s.error,
      total: s.total ?? 0,
      stories,
    };
  });

  const out = resolve(String(opts.out));
  const shape = (x) => {
    // An outlet the user prefers leads; otherwise the first to carry it
    const preferred = (o) => onDomain(o.sourceUrl, prefer);
    const outlets = [...x.outlets]
      .sort((a, b) => Number(preferred(b)) - Number(preferred(a)))
      .slice(0, 4);
    return {
      id: x.id,
      topic: x.topic,
      alsoIn: x.alsoIn,
      title: outlets[0].title,
      source: outlets[0].source,
      published:
        outlets
          .map((o) => o.published)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null,
      summary: outlets.find((o) => o.summary)?.summary ?? "",
      preferred: preferred(outlets[0]),
      count: x.outlets.length,
      outlets: outlets.map(({ title, link, source, sourceUrl, published }) => ({
        title,
        link,
        source,
        sourceUrl,
        published,
      })),
    };
  };
  writeFileSync(
    out,
    JSON.stringify({
      made: new Date(now).toISOString(),
      lang,
      country,
      hours,
      topics: topics.map((t) => ({
        ...t,
        stories: t.stories.slice(0, KEEP).map(shape),
      })),
    }),
  );

  for (const t of topics) {
    const shown = t.stories.slice(0, per);
    console.log(
      `\n## ${t.label}${t.error ? ` — ${t.error}` : ` — ${t.stories.length} stories from ${t.total} results, ${shown.length} shown`}`,
    );
    for (const x of shown.map(shape)) {
      const more = x.count > 1 ? ` +${x.count - 1}` : "";
      const liked = x.preferred ? " [preferred]" : "";
      const also = x.alsoIn.length ? ` (also ${x.alsoIn.join(", ")})` : "";
      console.log(
        `${x.id}  ${x.published ? ago(x.published, now) : "?"}  ${x.source}${more}${liked}${also}  ${x.title.slice(0, 130)}`,
      );
      if (x.summary) console.log(`     ${x.summary.slice(0, 160)}`);
    }
  }
  if (told.length) {
    console.log(
      `\n## Told in the last ${SEEN_DAYS} days — the same news in another article is only worth a place if it moved on`,
    );
    for (const t of told)
      console.log(
        `${t.brief.slice(6, 16)}  ${(t.headline || t.title || "").slice(0, 110)}`,
      );
  }
  console.log(
    `\n${out}: ${kept.length} stories, the first ${KEEP} a topic kept. Left out: ${old} older than ${hours}h, ${avoided} from avoided sites, ${repeat} a brief of the last ${SEEN_DAYS} days already carried — today's own brief does not count, so running this again today offers the same stories again.`,
  );
});
