/**
 * One outward WebSocket, for as long as it stays up. Discord and Slack both hand their
 * events over a socket the app opens, which is what keeps reach free of any port: this is
 * the little the two share — JSON in, JSON out, a close that says why, an abort that ends it.
 */
export function runSocket(
  url: string,
  on: {
    /**
     * Every frame, parsed. `send` writes one back on the same socket; `close` ends it from
     * this side, for a line that has gone quiet without saying so.
     */
    message(
      data: unknown,
      send: (data: unknown) => void,
      close: (code: number, reason: string) => void,
    ): void;
  },
  signal: AbortSignal,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const send = (data: unknown) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify(data));
    };
    // Ended from this side, it is over at once: a dead line never answers the close
    // handshake, and waiting for it would leave reach waiting with it
    let over = false;
    const end = (closed: { code: number; reason: string }) => {
      if (over) return;
      over = true;
      signal.removeEventListener("abort", abort);
      resolve(closed);
    };
    // Settled first, so the reason given here is the one reported, whatever the close says
    const close = (code: number, reason: string) => {
      end({ code, reason });
      socket.close(code, reason);
    };
    const abort = () => close(1000, "");
    signal.addEventListener("abort", abort, { once: true });

    socket.addEventListener("message", (event) => {
      try {
        on.message(JSON.parse(String(event.data)), send, close);
      } catch {
        // A frame that is not JSON is nothing reach reads
      }
    });
    socket.addEventListener("error", () => {
      // `close` follows and carries the code; an error before `open` has none
      if (socket.readyState !== WebSocket.OPEN && !over) {
        over = true;
        signal.removeEventListener("abort", abort);
        reject(new Error(`Could not connect to ${new URL(url).host}`));
      }
    });
    socket.addEventListener("close", (event) =>
      end({ code: event.code, reason: event.reason }),
    );
  });
}
