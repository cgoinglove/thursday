import { mcpManager } from "@/features/connectors/mcp.manager";
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
  { autoClose = false }: { autoClose?: boolean } = {},
) {
  const html = `<!doctype html>
<meta charset="utf-8">
<title>${title}</title>
<body style="font-family: ui-monospace, monospace; display: grid; place-items: center; min-height: 100dvh; margin: 0">
  <div style="text-align: center; max-width: 28rem; padding: 1.5rem">
    <p style="font-size: 1.125rem; margin: 0 0 .5rem">${escapeHtml(title)}</p>
    <p style="color: #666; font-size: .875rem; margin: 0">${escapeHtml(detail)}</p>
  </div>
  ${autoClose ? "<script>setTimeout(() => window.close(), 900)</script>" : ""}
</body>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
