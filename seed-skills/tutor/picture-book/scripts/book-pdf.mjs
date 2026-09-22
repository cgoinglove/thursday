// A picture book printed: the book's folder served on a port the system picks, and
// the page printed through the job's browser, one book page to a sheet.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, join, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

/** Serves the book's folder on a free port; resolves to the book's url and a stop. */
async function serve(root) {
  const server = createServer((req, res) => {
    const path = resolve(
      root,
      `.${decodeURIComponent(new URL(req.url, "http://x").pathname)}`,
    );
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
  // Port 0: the system picks a free one, so two jobs printing at once never meet
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { port: server.address().port, close: () => server.close() };
}

/**
 * Prints `book` (an .html picture book) to `<book>.pdf` beside it: the page's own
 * print rules give one sheet per page, the words under the picture.
 */
export async function bookPdf({ book, shown }, Stop) {
  if (!process.env.THURSDAY_SKILLS)
    throw new Stop(
      "THURSDAY_SKILLS is not set: run this from a bot's shell, where it names the shipped skills.",
    );
  // The shipped browser skill's session, which opens a headless browser when the job has none
  const { inPage, orFail } = await import(
    join(process.env.THURSDAY_SKILLS, "browser", "scripts", "session.mjs")
  );
  const out = book.replace(/\.html$/, ".pdf");
  const server = await serve(dirname(book));
  let done;
  try {
    done = orFail(
      await inPage(
        async (page, a) => {
          const tab = await page.context().newPage();
          try {
            await tab.goto(a.url, { waitUntil: "load" });
            await tab.evaluate(async () => {
              await document.fonts.ready;
              await Promise.all(
                [...document.images].map((i) => i.decode().catch(() => {})),
              );
            });
            const broken = await tab.evaluate(() =>
              [...document.images]
                .filter((i) => !i.naturalWidth)
                .map((i) => i.getAttribute("src")),
            );
            // The book's own @page rule decides the sheet; print media is what pdf() uses
            await tab.pdf({
              path: a.out,
              printBackground: true,
              preferCSSPageSize: true,
            });
            return { broken };
          } catch (error) {
            return { error: String(error?.message ?? error).slice(0, 800) };
          } finally {
            await tab.close();
          }
        },
        {
          url: `http://127.0.0.1:${server.port}/${encodeURIComponent(basename(book))}`,
          out,
        },
      ),
    );
  } finally {
    server.close();
  }
  if (done.broken.length)
    throw new Stop(
      `Pictures that did not load: ${done.broken.join(", ")} — the PDF has their gaps. Fix them and run this again.`,
    );
  const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(
    `Made ${shown(out)}: ${mb} MB, one page a sheet. Hand back this path.`,
  );
}
