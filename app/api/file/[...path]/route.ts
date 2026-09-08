import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { decodePath } from "@/app/api/query-key";
import { mimeOf } from "@/features/workspace/file-kind";
import { insideWorkspace } from "@/features/workspace/workspace";
import { type RouteContext, serverRoute } from "@/lib/protocol/server-route";

/**
 * Raw workspace file, the one GET without a JSON envelope (serverRoute passes a
 * Response through). insideWorkspace confines the path: outside is 403, not 404.
 * Streams with ETag and Range so large media and video seeking work.
 */

/** The bot may have just overwritten the file: cache, but revalidate every time. */
const CACHE_CONTROL = "no-cache";

/** `bytes=0-499`, `bytes=500-`, `bytes=-500`. Multiple ranges are not accepted. */
function rangeOf(
  header: string | null,
  size: number,
): [number, number] | "bad" | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, from, to] = match;
  if (!from && !to) return "bad";
  const start = from ? Number(from) : Math.max(0, size - Number(to));
  const end = from
    ? to
      ? Math.min(Number(to), size - 1)
      : size - 1
    : size - 1;
  return start > end || start >= size ? "bad" : [start, end];
}

export const GET = serverRoute(
  async (request, { params }: RouteContext<{ path: string[] }>) => {
    const rel = decodePath((await params).path);
    const full = await insideWorkspace(rel);
    if (!full) return new Response("Outside the workspace", { status: 403 });

    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) return new Response("Not found", { status: 404 });

    // Size and mtime suffice: the bot rewrites files whole.
    const tag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
    const headers = new Headers({
      "content-type": mimeOf(rel),
      "last-modified": info.mtime.toUTCString(),
      etag: tag,
      "accept-ranges": "bytes",
      "cache-control": CACHE_CONTROL,
    });

    const since = Date.parse(request.headers.get("if-modified-since") ?? "");
    if (
      request.headers.get("if-none-match") === tag ||
      (!request.headers.get("if-none-match") &&
        Number.isFinite(since) &&
        info.mtime.getTime() <= since + 999)
    ) {
      return new Response(null, { status: 304, headers });
    }

    if (info.size === 0) {
      headers.set("content-length", "0");
      return new Response(null, { status: 200, headers });
    }

    const range = rangeOf(request.headers.get("range"), info.size);
    if (range === "bad") {
      headers.set("content-range", `bytes */${info.size}`);
      return new Response(null, { status: 416, headers });
    }

    const [start, end] = range ?? [0, info.size - 1];
    headers.set("content-length", String(end - start + 1));
    if (range) {
      headers.set("content-range", `bytes ${start}-${end}/${info.size}`);
    }

    const body = Readable.toWeb(
      createReadStream(full, { start, end }),
    ) as ReadableStream<Uint8Array>;
    return new Response(body, { status: range ? 206 : 200, headers });
  },
);
