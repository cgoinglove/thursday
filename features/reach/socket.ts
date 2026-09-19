/**
 * One outward WebSocket, for as long as it stays up. Discord and Slack both hand their
 * events over a socket the app opens, which is what keeps reach free of any port: this is
 * the little the two share — JSON in, JSON out, a close that says why, an abort that ends it.
 */
export function runSocket(
  url: string,
  on: {
    /** Every frame, parsed. `send` writes one back on the same socket. */
    message(data: unknown, send: (data: unknown) => void): void;
  },
  signal: AbortSignal,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const send = (data: unknown) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(data));
    };
    const abort = () => socket.close(1000);
    signal.addEventListener("abort", abort, { once: true });

    socket.addEventListener("message", (event) => {
      try {
        on.message(JSON.parse(String(event.data)), send);
      } catch {
        // A frame that is not JSON is nothing reach reads
      }
    });
    socket.addEventListener("error", () => {
      // `close` follows and carries the code; an error before `open` has none
      if (socket.readyState !== WebSocket.OPEN)
        reject(new Error(`Could not connect to ${new URL(url).host}`));
    });
    socket.addEventListener("close", (event) => {
      signal.removeEventListener("abort", abort);
      resolve({ code: event.code, reason: event.reason });
    });
  });
}

/** A long answer in pieces a service takes, cut at a paragraph or a line where one is near. */
export function inPieces(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const head = rest.slice(0, max);
    const at = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf("\n"));
    const cut = at > max / 2 ? at : max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}
