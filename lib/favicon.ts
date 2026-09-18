import { FAVICON } from "@/config";

/**
 * A site's icon, asked for by this server (config FAVICON). Only a public host name is
 * fetched — letters and dots with a letter TLD, never an address or `localhost` — so a
 * page's URL cannot turn this into a way to reach the machine's own network. What a site
 * answered, icon or nothing, is kept for the life of the process.
 */
export type Favicon = { body: ArrayBuffer; type: string };

const HOST =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Some sites refuse a request that names no browser at all. */
const AGENT = "Mozilla/5.0 (compatible; thursday-agent favicon)";

const kept = new Map<string, Favicon | null>();

export async function readFavicon(host: string): Promise<Favicon | null> {
  const name = host.trim().toLowerCase().replace(/\.$/, "");
  if (!HOST.test(name) || name.endsWith(".local")) return null;
  if (kept.has(name)) return kept.get(name) ?? null;

  const found = await fetchIcon(name).catch(() => null);
  if (kept.size >= FAVICON.kept) {
    const oldest = kept.keys().next().value;
    if (oldest !== undefined) kept.delete(oldest);
  }
  kept.set(name, found);
  return found;
}

/**
 * `/favicon.ico` first; a site without one names its icon in its front page's head
 * (`<link rel="icon" href>`), read from the first FAVICON.pageBytes of it. The icon
 * it names is fetched only from a public host, like the site itself.
 */
async function fetchIcon(host: string): Promise<Favicon | null> {
  const direct = await fetchImage(`https://${host}/favicon.ico`);
  if (direct) return direct;
  const named = await namedIcon(host).catch(() => null);
  return named ? fetchImage(named) : null;
}

async function fetchImage(url: string): Promise<Favicon | null> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FAVICON.timeoutMs),
    headers: { accept: "image/*", "user-agent": AGENT },
  }).catch(() => null);
  if (!response?.ok) return null;
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return null;
  const body = await response.arrayBuffer();
  if (!body.byteLength || body.byteLength > FAVICON.maxBytes) return null;
  return { body, type };
}

/** The icon a front page names, as an absolute https URL on a public host. */
async function namedIcon(host: string): Promise<string | null> {
  const response = await fetch(`https://${host}/`, {
    signal: AbortSignal.timeout(FAVICON.timeoutMs),
    headers: { accept: "text/html", "user-agent": AGENT },
  });
  if (!response.ok || !response.body) return null;
  // The head is at the top; the rest of the page is never read
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  while (html.length < FAVICON.pageBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  void reader.cancel().catch(() => {});

  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel=["']?[^"'>]*\bicon\b/i.test(tag)) continue;
    const href = /\bhref=["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      const url = new URL(href, response.url || `https://${host}/`);
      if (url.protocol === "https:" && HOST.test(url.hostname)) return url.href;
    } catch {
      // not a URL: the next link
    }
  }
  return null;
}
