import { type NextRequest, NextResponse } from "next/server";

/**
 * The app answers this computer and nothing else. It listens on a loopback address, but a
 * page on any site the user has open can still send it requests: one that renames itself to
 * point at 127.0.0.1 (DNS rebinding) comes with its own name in `Host`, and one that simply
 * posts to the port comes marked as from another site. Neither may reach a route, since a
 * route can start work for a bot that has a shell. Reading is left alone — another site gets
 * no answer it can read — and so is everything the app's own screens send.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Methods that change nothing on their own. */
const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Reads that still do something, so another site may not send them either: a page anywhere
 * that held `/api/events` open counted as the user watching (app-event.server presence) and
 * kept notices and phone questions back, and `/api/favicon` fetches from the network.
 */
const ACTING_READS = ["/api/events", "/api/favicon"];

/**
 * Where the app may be shown in a frame: only in itself. Another site framing it could lay
 * its own page over the call screen's buttons. `/api/file` sets its own (a bot's page goes
 * out sandboxed, and the app's viewer frames it).
 */
function framedByItselfOnly(response: NextResponse, path: string) {
  if (path.startsWith("/api/file")) return response;
  response.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  return response;
}

export function proxy(request: NextRequest) {
  const sent = request.headers.get("host");
  const host = sent ?? "";
  let name = "";
  try {
    name = new URL(`http://${host}`).hostname;
  } catch {}
  // A browser always names a host, so a request without one comes from this server itself:
  // Next's image optimizer asks for /api/file in-process with no headers at all, and turned
  // away it draws every thumbnail as a broken image
  if (sent !== null && !LOOPBACK.has(name))
    return new NextResponse("This app answers only this computer.", {
      status: 421,
    });
  const path = request.nextUrl.pathname;
  // Browsers say where a request comes from; a script or a tool on this computer says nothing
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const elsewhere =
    (site !== null && site !== "same-origin" && site !== "none") ||
    (origin !== null && origin !== `${request.nextUrl.protocol}//${host}`);
  const reading =
    READS.has(request.method) &&
    !ACTING_READS.some((route) => path.startsWith(route));
  if (!reading && elsewhere)
    return new NextResponse("Not from this app.", { status: 403 });
  return framedByItselfOnly(NextResponse.next(), path);
}
