/**
 * The page an OAuth redirect lands on: a detour tab that says how it went and closes itself
 * when it went well. Every sign-in that comes back through a browser draws this one.
 */
export function oauthPage(
  title: string,
  detail: string,
  { autoClose = false }: { autoClose?: boolean } = {},
): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<body style="font-family: ui-monospace, monospace; display: grid; place-items: center; min-height: 100dvh; margin: 0">
  <div style="text-align: center; max-width: 28rem; padding: 1.5rem">
    <p style="font-size: 1.125rem; margin: 0 0 .5rem">${escapeHtml(title)}</p>
    <p style="color: #666; font-size: .875rem; margin: 0">${escapeHtml(detail)}</p>
  </div>
  ${autoClose ? "<script>setTimeout(() => window.close(), 900)</script>" : ""}
</body>`;
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
