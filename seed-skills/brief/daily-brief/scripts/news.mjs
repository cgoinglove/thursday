#!/usr/bin/env node
/**
 * Candidates for a brief: every topic searched on Google News (and any publisher feeds),
 * kept to the freshness window, the same story from several outlets folded into one line,
 * and anything already in a recent brief dropped. Writes them all to --out and prints the
 * best few a topic, one line each, for choosing.
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
  CLOSED,
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

// Two titles this alike are one story told twice (Dice over character pairs)
const SAME_STORY = 0.6;
// Briefs this recent are what "already told" means
const SEEN_DAYS = 4;
// Stories a topic keeps in the file: the ones printed and the next few, for spares
const KEEP = 15;

const words = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
/** A title's character pairs, less the words every result shares because they were searched for. */
const pairs = (title, searched = new Set()) => {
  const s = words(title)
    .filter((w) => !searched.has(w))
    .join(" ");
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
};
const alike = (a, b) => {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const p of a) if (b.has(p)) both++;
  return (2 * both) / (a.size + b.size);
};

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

/** Titles already told in the bot's recent briefs, read off the pages themselves. */
function seenTitles() {
  const dir = artifactsDir();
  if (!existsSync(dir)) return [];
  const since = Date.now() - SEEN_DAYS * 86_400_000;
  const told = [];
  for (const name of readdirSync(dir)) {
    if (!/^brief-.*\.html$/.test(name)) continue;
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

  const searched = new Set(
    sources
      .filter((s) => !s.feed)
      .flatMap((s) => words(s.query))
      .filter((w) => w !== "or"),
  );
  const told = seenTitles().map((t) => ({
    ...t,
    pairs: pairs(t.title, searched),
  }));
  const kept = [];
  let old = 0;
  let avoided = 0;
  let repeat = 0;
  const topics = fetched.map((s, t) => {
    const letter = String.fromCharCode(97 + (t % 26));
    const stories = [];
    for (const [rank, item] of (s.items ?? []).entries()) {
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
      const p = pairs(item.title, searched);
      if (told.some((x) => alike(p, x.pairs) >= SAME_STORY)) {
        repeat++;
        continue;
      }
      const outlet = { ...item, published };
      // The same story under another topic or from another outlet joins the first telling
      const same = kept.find((k) => alike(p, k.pairs) >= SAME_STORY);
      if (same) {
        same.outlets.push(outlet);
        if (same.topic !== s.label && !same.alsoIn.includes(s.label))
          same.alsoIn.push(s.label);
        continue;
      }
      const story = {
        topic: s.label,
        rank,
        pairs: p,
        outlets: [outlet],
        alsoIn: [],
      };
      kept.push(story);
      stories.push(story);
    }
    // Google's order is relevance; more outlets and a preferred one lift a story, and one
    // nobody can read sinks to the bottom
    const score = (x) =>
      x.rank -
      3 * (x.outlets.length - 1) -
      (x.outlets.some((o) => onDomain(o.sourceUrl, prefer)) ? 6 : 0) +
      (x.outlets.every((o) => onDomain(o.sourceUrl, CLOSED)) ? 100 : 0);
    stories.sort((a, b) => score(a) - score(b));
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
    // A preferred outlet leads, a closed one comes last; otherwise the first to carry it
    const rank = (o) =>
      onDomain(o.sourceUrl, prefer) ? 0 : onDomain(o.sourceUrl, CLOSED) ? 2 : 1;
    const outlets = [...x.outlets]
      .sort((a, b) => rank(a) - rank(b))
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
      closed: outlets.every((o) => onDomain(o.sourceUrl, CLOSED)),
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
      const closed = x.closed ? " [closed: cannot be read]" : "";
      const also = x.alsoIn.length ? ` (also ${x.alsoIn.join(", ")})` : "";
      console.log(
        `${x.id}  ${x.published ? ago(x.published, now) : "?"}  ${x.source}${more}${closed}${also}  ${x.title.slice(0, 130)}`,
      );
      if (x.summary) console.log(`     ${x.summary.slice(0, 160)}`);
    }
  }
  console.log(
    `\n${out}: ${kept.length} stories, the best ${KEEP} a topic kept. Left out: ${old} older than ${hours}h, ${avoided} from avoided sites, ${repeat} already in a brief of the last ${SEEN_DAYS} days.`,
  );
});
