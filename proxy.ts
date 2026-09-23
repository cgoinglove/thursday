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

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  let name = "";
  try {
    name = new URL(`http://${host}`).hostname;
  } catch {}
  if (!LOOPBACK.has(name))
    return new NextResponse("This app answers only this computer.", {
      status: 421,
    });
  if (READS.has(request.method)) return NextResponse.next();
  // Browsers say where a request comes from; a script or a tool on this computer says nothing
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const elsewhere =
    (site !== null && site !== "same-origin" && site !== "none") ||
    (origin !== null && origin !== `${request.nextUrl.protocol}//${host}`);
  if (elsewhere) return new NextResponse("Not from this app.", { status: 403 });
  return NextResponse.next();
}
