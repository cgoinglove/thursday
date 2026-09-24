// A picture book printed: the book's folder served on a port the system picks, and the
// page printed in a headless browser of its own, one book page to a sheet.
import { statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Prints `book` (an .html picture book) to `<book>.pdf` beside it: the page's own
 * print rules give one sheet per page, the words under the picture.
 */
export async function bookPdf({ book, shown }, Stop) {
  if (!process.env.THURSDAY_SKILLS)
    throw new Stop(
      "THURSDAY_SKILLS is not set: run this from a bot's shell, where it names the shipped skills.",
    );
  // The shipped browser skill: a browser of its own, since only a headless one prints and
  // the job's may be a window on the user's screen
  const scripts = join(process.env.THURSDAY_SKILLS, "browser", "scripts");
  const { inPageApart, orFail } = await import(
    pathToFileURL(join(scripts, "session.mjs")).href
  );
  const { serveFolder } = await import(
    pathToFileURL(join(scripts, "serve.mjs")).href
  );
  const out = book.replace(/\.html$/, ".pdf");
  const server = await serveFolder(dirname(book));
  let done;
  try {
    done = orFail(
      await inPageApart(
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
        { url: server.url(basename(book)), out },
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
