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

/** `/favicon.ico` only: most sites serve one, and a letter stands in for the rest. */
async function fetchIcon(host: string): Promise<Favicon | null> {
  const response = await fetch(`https://${host}/favicon.ico`, {
    signal: AbortSignal.timeout(FAVICON.timeoutMs),
    headers: { accept: "image/*" },
  });
  if (!response.ok) return null;
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return null;
  const body = await response.arrayBuffer();
  if (!body.byteLength || body.byteLength > FAVICON.maxBytes) return null;
  return { body, type };
}
