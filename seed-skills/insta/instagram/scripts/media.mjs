/**
 * One post as these scripts report it, from the media record Instagram's own
 * pages fetch (a profile's timeline, a search). `media` is sent into the browser
 * session as source (lib inPage helpers), so it uses nothing from outside itself.
 */
export function media(o) {
  const slides = o.carousel_media ?? [];
  const first = slides[0] ?? o;
  const w = first.original_width ?? null;
  const h = first.original_height ?? null;
  const named = [
    ["1:1", 1],
    ["4:5", 0.8],
    ["3:4", 0.75],
    ["2:3", 0.667],
    ["9:16", 0.5625],
    ["1.91:1", 1.91],
    ["16:9", 1.778],
  ];
  const r = w && h ? w / h : null;
  const ratio = r
    ? (named.find(([, v]) => Math.abs(v - r) < 0.02)?.[0] ?? r.toFixed(2))
    : null;
  const caption = o.caption?.text ?? "";
  const reel = o.media_type === 2;
  const image = (m) =>
    m.image_versions2?.candidates?.[0]?.url ?? m.display_uri ?? null;
  return {
    url: `https://www.instagram.com/${reel ? "reel" : "p"}/${o.code}/`,
    type: o.media_type === 8 ? "carousel" : reel ? "reel" : "image",
    at: o.taken_at ? o.taken_at * 1000 : null,
    owner: o.user?.username ?? null,
    pinned: (o.timeline_pinned_user_ids ?? []).length > 0,
    likes: o.like_and_view_counts_disabled ? null : (o.like_count ?? null),
    comments: o.comment_count ?? null,
    views: o.play_count ?? o.ig_play_count ?? o.view_count ?? null,
    slides: o.carousel_media_count ?? (slides.length || 1),
    ratio,
    size: w && h ? `${w}x${h}` : null,
    hook: caption.split("\n")[0].slice(0, 140),
    captionChars: caption.length,
    hashtags: (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length,
    caption,
    music: o.clips_metadata?.music_info?.music_asset_info?.title ?? null,
    cover: image(first),
    images: slides.length ? slides.map(image) : [image(o)],
  };
}

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

export const short = (n) =>
  n == null
    ? "-"
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)}M`
      : n >= 1e3
        ? `${(n / 1e3).toFixed(1)}k`
        : String(n);

const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "?");

/** One line a post: what it is, how it did, and its first caption line. */
export const postLine = (p, i) =>
  `${String(i + 1).padStart(2)} ${day(p.at)} ${p.type}${p.type === "carousel" ? `×${p.slides}` : ""} ${p.ratio ?? "?"} ` +
  `likes ${short(p.likes)} comments ${short(p.comments)}${p.views ? ` views ${short(p.views)}` : ""} tags ${p.hashtags} caption ${p.captionChars}` +
  `${p.pinned ? " pinned" : ""}${p.owner ? ` @${p.owner}` : ""} ${p.url} | ${p.hook.replace(/\s+/g, " ").slice(0, 70)}`;

/** How a set of posts is made, in a few lines: the pattern to copy. */
export function patterns(posts) {
  if (!posts.length) return ["no posts"];
  const count = (f) => posts.filter(f).length;
  const tally = (key) =>
    Object.entries(
      posts.reduce((all, p) => {
        all[p[key]] = (all[p[key]] ?? 0) + 1;
        return all;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
  const dated = posts
    .filter((p) => !p.pinned && p.at)
    .map((p) => p.at)
    .sort((a, b) => a - b);
  const weeks = dated.length > 1 ? (dated.at(-1) - dated[0]) / 6048e5 : null;
  const carousels = posts.filter((p) => p.type === "carousel");
  const top = [...posts]
    .filter((p) => p.likes != null)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 3)
    .map((p) => posts.indexOf(p) + 1);
  return [
    `types: ${tally("type")}; ratios: ${tally("ratio")}`,
    `slides per carousel: median ${median(carousels.map((p) => p.slides)) ?? "-"} (of ${carousels.length})`,
    `caption: median ${median(posts.map((p) => p.captionChars))} chars, ${median(posts.map((p) => p.hashtags))} hashtags; ${count((p) => p.hashtags === 0)} with none`,
    `likes: median ${short(median(posts.map((p) => p.likes)))}; best: ${top.map((n) => `#${n}`).join(" ")}`,
    weeks ? `cadence: ${(dated.length / weeks).toFixed(1)} posts a week` : null,
  ].filter(Boolean);
}
