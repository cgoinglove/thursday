import { readFavicon } from "@/lib/favicon";
import { type RouteContext, serverRoute } from "@/lib/protocol/server-route";

/**
 * A site's icon for a source chip, as an image rather than the JSON envelope
 * (serverRoute passes a Response through). Nothing found is a 404 the chip answers
 * with the site's first letter; both are cached, since a site's icon rarely changes.
 */
export const GET = serverRoute<RouteContext<{ host: string }>>(
  async (_request, { params }) => {
    const icon = await readFavicon((await params).host);
    if (!icon)
      return new Response(null, {
        status: 404,
        headers: { "cache-control": "max-age=86400" },
      });
    return new Response(icon.body, {
      headers: {
        "content-type": icon.type,
        "cache-control": "max-age=604800",
      },
    });
  },
);
