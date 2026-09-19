// PDFs: pages drawn to PNG (pdf.js), their text read with positions, pages merged, split,
// picked and turned, form fields listed and filled (pdf-lib), and text printed onto a page.
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";
import { inTab } from "./browser.mjs";
import {
  escapeHtml,
  input,
  kit,
  kitFile,
  output,
  pageList,
  readJson,
  Stop,
  shippedSkill,
  shown,
  workDir,
} from "./kit.mjs";

async function openPdfjs(file) {
  const pdfjs = await kit("pdfjs-dist/legacy/build/pdf.mjs");
  const data = `${kitFile("pdfjs-dist")}/`;
  return pdfjs.getDocument({
    data: new Uint8Array(readFileSync(file)),
    standardFontDataUrl: `${data}standard_fonts/`,
    cMapUrl: `${data}cmaps/`,
    cMapPacked: true,
    verbosity: 0,
  }).promise;
}

/**
 * Draws pages to PNGs `page-01.png`… in `dir`, `width` pixels wide. With `grid`, a line
 * every 50 points and its number, so a position on the page can be read off the picture.
 */
async function renderPages(file, dir, { pages, width = 1100, grid }) {
  const { createCanvas } = await kit("@napi-rs/canvas");
  const doc = await openPdfjs(file);
  const wanted = pageList(pages, doc.numPages);
  const files = [];
  for (const n of wanted) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = width / base.width;
    const view = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(view.width), Math.ceil(view.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: view, canvas }).promise;
    if (grid) drawGrid(ctx, base, scale);
    const path = join(dir, `page-${String(n).padStart(2, "0")}.png`);
    writeFileSync(path, canvas.toBuffer("image/png"));
    files.push(path);
  }
  return { files, total: doc.numPages };
}

function drawGrid(ctx, base, scale) {
  ctx.save();
  ctx.font = `${Math.max(9, 8 * scale)}px sans-serif`;
  for (let x = 0; x <= base.width; x += 50) {
    ctx.strokeStyle = x % 100 ? "rgba(255,0,80,.18)" : "rgba(255,0,80,.45)";
    ctx.beginPath();
    ctx.moveTo(x * scale, 0);
    ctx.lineTo(x * scale, base.height * scale);
    ctx.stroke();
    if (x % 100 === 0) {
      ctx.fillStyle = "rgba(200,0,60,.9)";
      ctx.fillText(String(x), x * scale + 2, 10 * scale);
    }
  }
  for (let y = 0; y <= base.height; y += 50) {
    ctx.strokeStyle = y % 100 ? "rgba(0,90,255,.18)" : "rgba(0,90,255,.45)";
    ctx.beginPath();
    ctx.moveTo(0, y * scale);
    ctx.lineTo(base.width * scale, y * scale);
    ctx.stroke();
    if (y % 100 === 0) {
      ctx.fillStyle = "rgba(0,60,200,.9)";
      ctx.fillText(String(y), 2, y * scale - 2);
    }
  }
  ctx.restore();
}

/** Pictures of a PDF, and one sheet with every page when there are several. */
export async function lookPdf(file, opts, { dir, quiet } = {}) {
  const into = dir ?? workDir(file);
  const done = await renderPages(file, into, {
    pages: opts.pages,
    width: opts.width ? Number(opts.width) : undefined,
    grid: opts.grid,
  });
  let sheet = null;
  if (done.files.length > 1) {
    const { makeSheet } = await import(
      shippedSkill("browser", "scripts", "sheet.mjs")
    );
    sheet = join(into, "sheet.png");
    await makeSheet(
      done.files.map((path, i) => ({ file: path, label: `page ${i + 1}` })),
      sheet,
      Math.min(4, done.files.length),
    );
  }
  if (!quiet) {
    console.log(
      `${done.files.length} of ${done.total} page(s) drawn${opts.grid ? " with a 50pt grid (x across, y down, from the top left)" : ""}:`,
    );
    for (const path of done.files) console.log(`  ${shown(path)}`);
    if (sheet) console.log(`All on one picture: ${shown(sheet)}`);
  }
  return { ...done, sheet };
}

/** Text lines of one page, each with its box in points from the top left. */
async function pageLines(page) {
  const view = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const lines = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const [a, b, , , e, f] = item.transform;
    const size = Math.hypot(a, b) || 10;
    const x = e;
    const y = view.height - f - size;
    const last = lines.at(-1);
    // One line: same baseline, and this piece starts near where the last one ended
    if (
      last &&
      Math.abs(last.y - y) < size * 0.35 &&
      x - (last.x + last.w) < size * 0.6 &&
      x >= last.x
    ) {
      const gap = x - (last.x + last.w) > size * 0.15 ? " " : "";
      last.text += gap + item.str;
      last.w = Math.max(last.w, x + item.width - last.x);
      continue;
    }
    lines.push({
      text: item.str,
      x,
      y,
      w: item.width,
      h: size,
      size,
      font: item.fontName,
      turned: Math.abs(b) > 0.01,
    });
  }
  return { lines, width: view.width, height: view.height };
}

export { openPdfjs, pageLines };

/** The text of a PDF, page by page; with `layout`, each line with where it sits. */
export async function readPdf(file, opts) {
  const doc = await openPdfjs(file);
  const pages = pageList(opts.pages, doc.numPages);
  const out = [];
  let chars = 0;
  for (const n of pages) {
    const page = await doc.getPage(n);
    const { lines, width, height } = await pageLines(page);
    out.push(
      `## Page ${n} (${Math.round(width)}×${Math.round(height)} pt)${lines.length ? "" : " — no text: a scan or a picture; `look` at it"}`,
    );
    for (const line of lines) {
      chars += line.text.length;
      out.push(
        opts.layout
          ? `[x ${Math.round(line.x)} y ${Math.round(line.y)} w ${Math.round(line.w)} size ${Math.round(line.size)}] ${line.text}`
          : line.text,
      );
    }
  }
  const fields = await formFields(file).catch(() => []);
  if (fields.length)
    out.push(
      `\n${fields.length} fillable field(s): \`fields\` lists them, \`fill\` fills them.`,
    );
  if (!chars && pages.length)
    out.push(
      "\nNo text layer on these pages. Their words are only in the picture.",
    );
  return out.join("\n");
}

/**
 * Merges pages from several PDFs, each `file.pdf`, `file.pdf:1-3,5` or `file.pdf:2@90` (those
 * pages turned by 90°); `--rotate` turns every page.
 */
export async function combine(specs, opts) {
  if (!specs.length)
    throw new Stop("Name at least one PDF, each as file.pdf or file.pdf:1-3,5");
  const { PDFDocument, degrees } = await kit("pdf-lib");
  const outDoc = await PDFDocument.create();
  for (const spec of specs) {
    const [, path, range, angle] =
      /^(.*?\.pdf)(?::([\d,\s-]*))?(?:@(\d+))?$/i.exec(spec) ?? [];
    if (!path)
      throw new Stop(
        `"${spec}" is not file.pdf, file.pdf:1-3,5 or file.pdf:2@90`,
      );
    const turn = Number(angle ?? opts.rotate ?? 0);
    if (turn % 90) throw new Stop("A page turns by 90, 180 or 270.");
    const src = await loadPdf(readFileSync(input(path)));
    const wanted = pageList(range, src.getPageCount());
    const copied = await outDoc.copyPages(
      src,
      wanted.map((n) => n - 1),
    );
    for (const page of copied) {
      if (turn)
        page.setRotation(degrees((page.getRotation().angle + turn) % 360));
      outDoc.addPage(page);
    }
  }
  const out = output(opts.out, "combined", "pdf");
  writeFileSync(out, await outDoc.save());
  console.log(`${shown(out)} — ${outDoc.getPageCount()} page(s)`);
}

/** One PDF into several: every N pages, or cut before the pages named. */
export async function split(file, opts) {
  const { PDFDocument } = await kit("pdf-lib");
  const src = await loadPdf(readFileSync(input(file, ["pdf"])));
  const total = src.getPageCount();
  const starts = opts.at
    ? [1, ...pageList(opts.at, total)].filter(
        (n, i, all) => all.indexOf(n) === i,
      )
    : Array.from(
        { length: Math.ceil(total / Number(opts.every ?? 1)) },
        (_, i) => i * Number(opts.every ?? 1) + 1,
      );
  starts.sort((a, b) => a - b);
  const stem = output(
    opts.out,
    file
      .split("/")
      .pop()
      .replace(/\.pdf$/i, ""),
    "pdf",
  ).replace(/\.pdf$/, "");
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const to = (starts[i + 1] ?? total + 1) - 1;
    const part = await PDFDocument.create();
    const pages = await part.copyPages(
      src,
      Array.from({ length: to - from + 1 }, (_, k) => from - 1 + k),
    );
    for (const page of pages) part.addPage(page);
    const path = `${stem}-${from === to ? from : `${from}-${to}`}.pdf`;
    writeFileSync(path, await part.save());
    console.log(`${shown(path)} — pages ${from}-${to}`);
  }
}

const FIELD_KIND = {
  PDFTextField: "text",
  PDFCheckBox: "checkbox",
  PDFRadioGroup: "radio",
  PDFDropdown: "dropdown",
  PDFOptionList: "list",
  PDFButton: "button",
  PDFSignature: "signature",
};

/** Every form field: its name, kind, value, choices, and where it sits. */
/** A PDF opened by pdf-lib, without its note about dropping an XFA layer it cannot read. */
async function loadPdf(bytes) {
  const { PDFDocument } = await kit("pdf-lib");
  const { warn, log } = console;
  console.warn = () => {};
  console.log = () => {};
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    doc.getForm();
    return doc;
  } finally {
    Object.assign(console, { warn, log });
  }
}

/** The words printed nearest a field: its label, left of it, above it, or right of a tick box. */
function nearestLabel(box, kind, lines) {
  const mid = box.y + box.h / 2;
  const band = lines.filter(
    (l) => Math.abs(l.y + l.h / 2 - mid) < Math.max(box.h, l.h) * 0.7,
  );
  if (kind === "checkbox" || kind === "radio") {
    const right = band
      .filter((l) => l.x >= box.x + box.w - 2)
      .sort((a, b) => a.x - b.x)[0];
    if (right && right.x - (box.x + box.w) < 30) return right.text;
  }
  const left = band
    .filter((l) => l.x + l.w <= box.x + 6)
    .sort((a, b) => b.x + b.w - (a.x + a.w))[0];
  // A number or a dash beside a box is a line number or a separator, not what it asks for
  if (left && box.x - (left.x + left.w) < 60 && left.text.trim().length > 3)
    return left.text;
  const above = lines
    .filter(
      (l) =>
        l.text.trim().length > 3 &&
        l.y + l.h <= box.y + 3 &&
        box.y - (l.y + l.h) < 24 &&
        l.x < box.x + box.w &&
        l.x + l.w > box.x - 4,
    )
    .sort(
      (a, b) => b.y - a.y || Math.abs(a.x - box.x) - Math.abs(b.x - box.x),
    )[0];
  return above?.text ?? left?.text ?? "";
}

/** Every form field: its name, kind, value, choices, where it sits, and what it is labelled. */
async function formFields(file) {
  const { PDFName } = await kit("pdf-lib");
  const doc = await loadPdf(readFileSync(file));
  const pages = doc.getPages();
  const fields = doc.getForm().getFields();
  if (!fields.length) return [];
  const text = await openPdfjs(file);
  const linesOf = new Map();
  const out = [];
  for (const field of fields) {
    const kind = FIELD_KIND[field.constructor.name] ?? "other";
    const widget = field.acroField.getWidgets()[0];
    const rect = widget?.getRectangle();
    const pageRef = widget?.P();
    let page = pages.findIndex((p) => p.ref === pageRef) + 1;
    if (!page && widget)
      page =
        pages.findIndex((p) =>
          p.node
            .Annots()
            ?.asArray()
            .some(
              (a) => a === widget.dict || doc.context.lookup(a) === widget.dict,
            ),
        ) + 1;
    const one = { name: field.getName(), kind, page: page || null };
    if (rect && page) {
      const height = pages[page - 1].getHeight();
      one.box = [
        rect.x,
        height - rect.y - rect.height,
        rect.width,
        rect.height,
      ].map(Math.round);
    }
    const tip = field.acroField.dict.lookup(PDFName.of("TU"));
    let label = tip?.decodeText?.() ?? "";
    if (!label && one.box) {
      if (!linesOf.has(page))
        linesOf.set(page, (await pageLines(await text.getPage(page))).lines);
      const [x, y, w, h] = one.box;
      label = nearestLabel({ x, y, w, h }, kind, linesOf.get(page));
    }
    one.label = label.replace(/\s+/g, " ").trim().slice(0, 90);
    if (kind === "text") one.value = field.getText() ?? "";
    if (kind === "checkbox") one.value = field.isChecked();
    if (kind === "radio" || kind === "dropdown" || kind === "list") {
      one.options = field.getOptions();
      one.value = field.getSelected();
    }
    if (kind === "text" && field.getMaxLength?.())
      one.maxLength = field.getMaxLength();
    out.push(one);
  }
  return out;
}

export async function listFields(file) {
  const fields = await formFields(input(file, ["pdf"]));
  if (!fields.length) {
    console.log(
      "No fillable fields: a flat form. Print the answers onto it with `stamp` — `read --layout` gives each label's position, `look --grid` shows the page with a grid.",
    );
    return;
  }
  console.log(
    `${fields.length} fields, one a line (box: x, y, w, h in points from the top left). Fill by name.`,
  );
  for (const f of fields) console.log(JSON.stringify(f));
}

/** Characters the standard Helvetica of a PDF form can draw. */
const WIN_ANSI = /^[\x20-\x7e\xa0-\xff€‘-„•…–—™\n\r\t]*$/;

/**
 * Fills fields by name from a JSON object: text as a string, a checkbox as true/false, a
 * choice as one of its options. Text Helvetica cannot draw (Korean, Japanese, Arabic…) is
 * printed onto the page where the field was, and that field is taken out.
 */
export async function fill(file, valuesPath, opts) {
  const source = input(file, ["pdf"]);
  const values = readJson(valuesPath);
  const doc = await loadPdf(readFileSync(source));
  const form = doc.getForm();
  const fields = await formFields(source);
  const byName = new Map(fields.map((f) => [f.name, f]));
  const unknown = Object.keys(values).filter((name) => !byName.has(name));
  if (unknown.length)
    throw new Stop(
      `No field named ${unknown.map((n) => `"${n}"`).join(", ")}. \`fields\` lists the names.`,
    );
  const printed = [];
  for (const [name, value] of Object.entries(values)) {
    const field = byName.get(name);
    if (field.kind === "text") {
      const text = String(value ?? "");
      if (WIN_ANSI.test(text)) form.getTextField(name).setText(text);
      else if (field.box && field.page)
        printed.push({
          name,
          page: field.page,
          x: field.box[0] + 2,
          y: field.box[1],
          w: field.box[2] - 4,
          h: field.box[3],
          text,
        });
      else throw new Stop(`"${name}" has no place on a page to print into.`);
    } else if (field.kind === "checkbox") {
      const box = form.getCheckBox(name);
      if (value === true || value === "true" || value === "yes") box.check();
      else box.uncheck();
    } else if (field.kind === "radio") {
      if (!field.options.includes(String(value)))
        throw new Stop(`"${name}" takes one of: ${field.options.join(", ")}`);
      form.getRadioGroup(name).select(String(value));
    } else if (field.kind === "dropdown" || field.kind === "list") {
      const pick =
        field.kind === "dropdown"
          ? form.getDropdown(name)
          : form.getOptionList(name);
      const wanted = Array.isArray(value) ? value.map(String) : [String(value)];
      const bad = wanted.filter((v) => !field.options.includes(v));
      if (bad.length && !(field.kind === "dropdown" && pick.isEditable()))
        throw new Stop(`"${name}" takes one of: ${field.options.join(", ")}`);
      pick.select(field.kind === "dropdown" ? wanted[0] : wanted);
    } else
      throw new Stop(
        `"${name}" is a ${field.kind} field; it cannot be filled.`,
      );
  }
  for (const one of printed) dropField(doc, form, form.getField(one.name));
  if (opts.flatten) form.flatten();
  const out = output(
    opts.out,
    `${file
      .split("/")
      .pop()
      .replace(/\.pdf$/i, "")}-filled`,
    "pdf",
  );
  writeFileSync(out, await doc.save());
  if (printed.length)
    await stampMarks(
      out,
      printed.map(({ page, x, y, w, h, text }) => ({
        page,
        x,
        y,
        w,
        h,
        text,
        fit: true,
      })),
      out,
    );
  console.log(
    `${shown(out)} — ${Object.keys(values).length} field(s) filled${printed.length ? `; ${printed.map((p) => `"${p.name}"`).join(", ")} printed onto the page (text the form's font cannot draw)` : ""}${opts.flatten ? ", flattened" : ""}.`,
  );
  await pictures(out);
}

/**
 * Takes a field and its widgets off the form. pdf-lib's own removeField first reads each
 * widget's appearance, and throws on a field that has none — common in forms made elsewhere.
 */
function dropField(doc, form, field) {
  const pages = doc.getPages();
  for (const widget of field.acroField.getWidgets()) {
    const ref = doc.context.getObjectRef(widget.dict) ?? field.ref;
    for (const page of pages) page.node.removeAnnot(ref);
  }
  for (const page of pages) page.node.removeAnnot(field.ref);
  form.acroForm.removeField(field.acroField);
}

/**
 * Prints marks onto pages: `{page, x, y, text, size?, w?, h?, color?, bold?, align?}` with
 * x/y in points from the top left, `{…, check: true}` for a tick, `{…, image, w, h}` for a
 * picture (a signature), `{…, erase: true, w, h}` to paint over what is there (white, or
 * `background`). `fit` shrinks one line to its width, `wrap` shrinks wrapped text to its box.
 * The browser typesets them, so any language prints; the page under them is untouched.
 * Resolves to how far each `wrap` mark had to shrink, by its index.
 */
export async function stampMarks(source, marks, out) {
  const { PDFDocument } = await kit("pdf-lib");
  const doc = await loadPdf(readFileSync(source));
  const pages = doc.getPages();
  const byPage = new Map();
  marks.forEach((mark, index) => {
    const n = Number(mark.page ?? 1);
    if (!pages[n - 1])
      throw new Stop(`Page ${n} is outside 1-${pages.length}.`);
    const { width, height } = pages[n - 1].getSize();
    if (!(mark.x >= 0 && mark.x < width && mark.y >= 0 && mark.y < height))
      throw new Stop(
        `Mark ${index + 1} at x ${mark.x}, y ${mark.y} is off page ${n}, which is ${Math.round(width)}×${Math.round(height)} pt.`,
      );
    if (!byPage.has(n)) byPage.set(n, []);
    byPage.get(n).push({ ...mark, index });
  });
  const work = join(workDir(out), "stamp");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const numbers = [...byPage.keys()];
  const sheets = numbers.map((n, i) => {
    const { width, height } = pages[n - 1].getSize();
    const items = byPage
      .get(n)
      .map((m, k) => {
        const style = [
          `left:${m.x}pt`,
          `top:${m.y}pt`,
          m.w ? `width:${m.w}pt` : "",
          m.h ? `height:${m.h}pt` : "",
          `font-size:${m.size ?? 10}pt`,
          m.color ? `color:${m.color}` : "",
          m.bold ? "font-weight:700" : "",
          m.italic ? "font-style:italic" : "",
          m.align ? `text-align:${m.align}` : "",
          m.serif ? "font-family:var(--serif)" : "",
          m.erase ? `background:${m.background ?? "#fff"}` : "",
        ]
          .filter(Boolean)
          .join(";");
        if (m.image) {
          const name = `img-${i}-${k}${extname(m.image)}`;
          copyFileSync(input(m.image), join(work, name));
          return `<img class="m" style="${style};object-fit:contain" src="${name}">`;
        }
        const body = m.check ? "✓" : escapeHtml(m.text ?? "");
        const kind = m.fit ? " fit" : m.wrap ? " wrap" : "";
        return `<div class="m${kind}" data-i="${m.index}" style="${style}">${body}</div>`;
      })
      .join("");
    return `<section style="width:${width}pt;height:${height}pt">${items}</section>`;
  });
  const size = numbers.map((n) => pages[n - 1].getSize());
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page{margin:0}
:root{--sans:"Inter Variable",-apple-system,"Segoe UI","Noto Sans","Apple SD Gothic Neo","Malgun Gothic","Noto Sans CJK KR","Hiragino Sans","PingFang SC",sans-serif;--serif:Georgia,"Times New Roman","Noto Serif","AppleMyungjo","Noto Serif CJK KR",serif}
html,body{margin:0;background:transparent}
section{position:relative;overflow:hidden;break-after:page}
.m{position:absolute;font-family:var(--sans);color:#111;line-height:1.2;white-space:pre-wrap;overflow-wrap:anywhere}
.fit{display:flex;align-items:center;white-space:nowrap}
.wrap{line-height:1.15;overflow:hidden}
</style><style>${size.map((s, i) => `@page p${i}{size:${s.width}pt ${s.height}pt} section:nth-of-type(${i + 1}){page:p${i}}`).join("\n")}</style></head><body>${sheets.join("")}</body></html>`;
  const htmlPath = join(work, "marks.html");
  writeFileSync(htmlPath, html);
  const overlayPath = join(work, "marks.pdf");
  const done = await inTab(
    htmlPath,
    async (tab, { out }) => {
      // A mark that must fit its box shrinks until it does
      const shrunk = await tab.evaluate(() => {
        const out = {};
        for (const el of document.querySelectorAll(".fit, .wrap")) {
          const base = parseFloat(getComputedStyle(el).fontSize);
          let size = base;
          const over = () =>
            el.scrollWidth > el.clientWidth + 1 ||
            (el.classList.contains("wrap") &&
              el.scrollHeight > el.clientHeight + 1);
          while (over() && size > base * 0.4) {
            size -= 0.25;
            el.style.fontSize = `${size}px`;
          }
          out[el.dataset.i] = size / base;
        }
        return out;
      });
      await tab.pdf({
        path: out,
        preferCSSPageSize: true,
        printBackground: true,
      });
      return shrunk;
    },
    { out: overlayPath },
  );
  const overlay = await PDFDocument.load(readFileSync(overlayPath));
  const embedded = await doc.embedPdf(
    overlay,
    numbers.map((_, i) => i),
  );
  numbers.forEach((n, i) => {
    const page = pages[n - 1];
    const { width, height } = page.getSize();
    page.drawPage(embedded[i], { x: 0, y: 0, width, height });
  });
  writeFileSync(out, await doc.save());
  rmSync(work, { recursive: true, force: true });
  return done.result;
}

/** The pages a fill or a stamp changed, drawn to look at. */
async function pictures(out) {
  const { report } = await import("./report.mjs");
  await report(out);
}

export async function stamp(file, marksPath, opts) {
  const source = input(file, ["pdf"]);
  const marks = readJson(marksPath);
  if (!Array.isArray(marks) || !marks.length)
    throw new Stop("The marks file holds a JSON array of marks.");
  const out = output(
    opts.out,
    `${file
      .split("/")
      .pop()
      .replace(/\.pdf$/i, "")}-filled`,
    "pdf",
  );
  await stampMarks(source, marks, out);
  console.log(`${shown(out)} — ${marks.length} mark(s) printed.`);
  await pictures(out);
}
