#!/usr/bin/env node
/**
 * A folder served to this machine alone, on a port the system picks: the browser refuses
 * `file:` addresses, and a fixed port lets two jobs reach each other's pages.
 *
 *   node serve.mjs <dir>     prints the folder's address, and serves until it is stopped
 *
 * A script imports `serveFolder(dir)` instead: it resolves to the port, the address of a
 * file in the folder, and a close.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
};

/** Serves `dir` on 127.0.0.1; nothing outside it is ever answered. */
export async function serveFolder(dir) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    let path;
    try {
      path = resolve(
        root,
        `.${decodeURIComponent(new URL(req.url, "http://x").pathname)}`,
      );
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (path === root && existsSync(resolve(root, "index.html")))
      path = resolve(root, "index.html");
    if (
      !path.startsWith(root + sep) ||
      !existsSync(path) ||
      statSync(path).isDirectory()
    ) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type":
        TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
    });
    createReadStream(path).pipe(res);
  });
  // Port 0: the system picks a free one
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address();
  return {
    port,
    /** The address of `file`, a path inside the folder. */
    url: (file = "") =>
      `http://127.0.0.1:${port}/${relative(root, resolve(root, file))
        .split(sep)
        .map(encodeURIComponent)
        .join("/")}`,
    close: () => server.close(),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
    process.stderr.write("usage: node serve.mjs <dir>\n");
    process.exit(1);
  }
  const served = await serveFolder(dir);
  console.log(`${served.url()} serves ${resolve(dir)} until this is stopped.`);
}
