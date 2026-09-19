// What a finished PDF is, said in a few lines: its pages, the pictures to look at, and what went wrong.
import { clearPictures, kit, shown, workDir } from "./kit.mjs";
import { lookPdf, openPdfjs, pageLines } from "./pdf.mjs";

/** What a finished PDF is: its path, pages, pictures, and anything that went wrong. */
export async function report(out, { broken = [], wide = [], twinOf } = {}) {
  const dir = workDir(twinOf ?? out);
  clearPictures(dir);
  const look = await lookPdf(out, {}, { dir, quiet: true });
  const doc = await openPdfjs(out);
  const lines = [
    `${shown(out)} — ${look.total} page(s)${twinOf ? `, the twin of ${shown(twinOf)}` : ""}`,
  ];
  if (look.total > 1) {
    const page = await doc.getPage(look.total);
    const last = await pageLines(page);
    const chars = last.lines.reduce((n, l) => n + l.text.length, 0);
    const { OPS } = await kit("pdfjs-dist/legacy/build/pdf.mjs");
    const ops = (await page.getOperatorList()).fnArray;
    const picture = ops.includes(OPS.paintImageXObject);
    if (chars < 120 && !picture)
      lines.push(
        `The last page holds only ${chars} characters: tighten the page before it or cut a line.`,
      );
  }
  if (broken.length)
    lines.push(`Pictures that did not load: ${broken.join(", ")}`);
  if (wide.length)
    lines.push(
      `Wider than the page, cut in print: ${wide.join(" | ")}. Let it wrap or make it narrower.`,
    );
  lines.push(
    look.sheet
      ? `Look: ${shown(look.sheet)} (every page), one page: ${shown(look.files[0]).replace(/01\.png$/, "NN.png")}`
      : `Look: ${shown(look.files[0])}`,
  );
  console.log(lines.join("\n"));
}
