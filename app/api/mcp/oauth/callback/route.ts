import { mcpManager } from "@/features/connectors/mcp.manager";
import { oauthPage } from "@/lib/oauth-page";
import { errorToString } from "@/lib/utils";

/**
 * OAuth redirect target. Exchanges the code, connects, syncs tools, then
 * renders a plain page; this tab is a detour and closes itself on success.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const error = params.get("error");
  if (error) {
    const description = params.get("error_description");
    return page(
      "Authorization failed",
      description ? `${error}: ${description}` : error,
    );
  }

  try {
    // The original tab's connector screen updates via the mcp event (mcp.query).
    const name = await mcpManager.finishAuthorization(params);
    return page("Connected", `"${name}" is ready.`, { autoClose: true });
  } catch (cause) {
    const message = errorToString(cause);
    return page("Authorization failed", message);
  }
}

function page(
  title: string,
  detail: string,
  options: { autoClose?: boolean } = {},
) {
  return new Response(oauthPage(title, detail, options), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
