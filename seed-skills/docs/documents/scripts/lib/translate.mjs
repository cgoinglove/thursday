// A file's words out as numbered segments, and back in once translated, with everything
// else — styles, tables, pictures, positions — left as it was.
//
// Word, PowerPoint and Excel files are edited in their own XML: each paragraph (a shared
// string in Excel) is one segment, and a stretch in a different style from the rest of it
// travels as a numbered tag, `<1>…</1>`, so bold words or a link land on the translated
// words. A PDF has no paragraphs to edit: its lines are grouped into blocks, and each
// translated block is printed over the original on a patch of the page's own colour.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { input, kit, output, readJson, Stop, shown, workDir } from "./kit.mjs";

const LETTER = /\p{L}/u;

// ——— Office files ———

const FORMATS = {
  docx: {
    parts:
      /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/,
    para: "w:p",
    run: "w:r",
    props: "w:rPr",
    text: "w:t",
    // Runs holding these are left where they are, never rewritten
    keep: [
      "w:drawing",
      "w:pict",
      "w:object",
      "w:fldChar",
      "w:instrText",
      "w:footnoteReference",
      "w:endnoteReference",
      "w:commentReference",
      "w:sym",
    ],
    wrappers: ["w:hyperlink", "w:smartTag", "w:ins"],
  },
  pptx: {
    parts:
      /^ppt\/(slides\/slide|notesSlides\/notesSlide|diagrams\/(data|drawing))\d*\.xml$/,
    para: "a:p",
    run: "a:r",
    props: "a:rPr",
    text: "a:t",
    keep: [],
    wrappers: [],
  },
  xlsx: {
    parts: /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/,
    para: null, // <si> in shared strings, <is> in a sheet
    run: "r",
    props: "rPr",
    text: "t",
    keep: [],
    wrappers: [],
  },
};

const kindOf = (file) => {
  const kind = extname(file).slice(1).toLowerCase();
  if (!["docx", "pptx", "xlsx", "pdf"].includes(kind))
    throw new Stop("Segments come out of a .docx, .pptx, .xlsx or .pdf.");
  return kind;
};

const XML_NS = "http://www.w3.org/XML/1998/namespace";

/** An element in the namespace its prefix already has in this part. */
function make(doc, name) {
  const prefix = name.includes(":") ? name.split(":")[0] : null;
  return doc.createElementNS(
    doc.documentElement.lookupNamespaceURI(prefix),
    name,
  );
}

const children = (node, name) =>
  Array.from(node.childNodes ?? []).filter((n) => n.nodeName === name);

function closest(node, name) {
  for (let n = node.parentNode; n; n = n.parentNode)
    if (n.nodeName === name) return n;
  return null;
}

/**
 * The paragraphs of one XML part, each with the runs that carry its words: those runs in
 * order, and for each the key of its look (its properties and any link around it).
 */
function paragraphsOf(doc, f, serializer) {
  const units = [];
  const containers = f.para
    ? Array.from(doc.getElementsByTagName(f.para))
    : [
        ...Array.from(doc.getElementsByTagName("si")),
        ...Array.from(doc.getElementsByTagName("is")),
      ];
  for (const p of containers) {
    const runs = [];
    let field = 0;
    const walk = (node) => {
      for (const child of Array.from(node.childNodes ?? [])) {
        const name = child.nodeName;
        if (name === f.para) continue;
        if (name === f.run) {
          const chars = child.getElementsByTagName("w:fldChar")[0];
          if (chars) {
            const type = chars.getAttribute("w:fldCharType");
            if (type === "begin") field++;
            if (type === "end") field = Math.max(0, field - 1);
            continue;
          }
          if (field || f.keep.some((k) => child.getElementsByTagName(k).length))
            continue;
          if (!children(child, f.text).length) continue;
          runs.push(child);
        } else if (name === "a:br" && f.para === "a:p") runs.push(child);
        else if (f.wrappers.includes(name)) walk(child);
      }
    };
    // Plain `<t>` directly in a shared string is its one run
    if (!f.para && children(p, "t").length) runs.push(p);
    else walk(p);
    if (!runs.length) continue;
    const pieces = runs.map((run) => {
      if (run.nodeName === "a:br") return { run, text: "\n", key: null };
      const props = run === p ? null : children(run, f.props)[0];
      const link = closest(run, "w:hyperlink");
      return {
        run,
        text: runText(run, f),
        key: `${props ? serializer.serializeToString(props) : ""}|${link ? link.getAttribute("r:id") || link.getAttribute("w:anchor") : ""}`,
        link,
      };
    });
    const text = pieces.map((x) => x.text).join("");
    if (!LETTER.test(text)) continue;
    units.push({ p, pieces, text });
  }
  return units;
}

function runText(run, f) {
  let out = "";
  for (const child of Array.from(run.childNodes)) {
    if (child.nodeName === f.text) out += child.textContent;
    else if (child.nodeName === "w:tab") out += "\t";
    else if (child.nodeName === "w:br" || child.nodeName === "w:cr")
      out += "\n";
  }
  return out;
}

/**
 * A paragraph as one segment: the look that carries most of its words is plain, every
 * other look a numbered tag around its words.
 */
function tagged(unit) {
  const weight = new Map();
  for (const x of unit.pieces)
    if (x.key !== null)
      weight.set(x.key, (weight.get(x.key) ?? 0) + x.text.length);
  const base = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const tags = new Map();
  let text = "";
  for (const x of unit.pieces) {
    if (x.key === null || x.key === base) text += x.text;
    else {
      if (!tags.has(x.key)) tags.set(x.key, tags.size + 1);
      const n = tags.get(x.key);
      text += `<${n}>${x.text}</${n}>`;
    }
  }
  // Neighbouring stretches in one look read as one: <1>a</1><1>b</1> → <1>ab</1>
  text = text.replace(/<\/(\d+)><\1>/g, "");
  return { text, base, tags };
}

/** A translation cut back into looks; a tag it does not know drops it to the plain look. */
function untag(text, tags) {
  const known = new Set(tags.values());
  const pieces = [];
  const re = /<(\d+)>([\s\S]*?)<\/\1>/g;
  let at = 0;
  let clean = true;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) pieces.push({ tag: null, text: text.slice(at, m.index) });
    if (!known.has(Number(m[1]))) clean = false;
    pieces.push({ tag: Number(m[1]), text: m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) pieces.push({ tag: null, text: text.slice(at) });
  const stray = pieces.some((x) => /<\/?\d+>/.test(x.text));
  if (!clean || stray)
    return {
      pieces: [{ tag: null, text: text.replace(/<\/?\d+>/g, "") }],
      clean: false,
    };
  // Tags in the source and none in the translation: the words came through, their looks did not
  const tagsKept = !tags.size || pieces.some((x) => x.tag !== null);
  return { pieces: pieces.filter((x) => x.text), clean: tagsKept };
}

async function openOffice(file) {
  const kind = kindOf(file);
  const { default: JSZip } = await kit("jszip");
  const { DOMParser, XMLSerializer } = await kit("@xmldom/xmldom");
  const zip = await JSZip.loadAsync(readFileSync(file));
  const f = FORMATS[kind];
  const serializer = new XMLSerializer();
  const parts = [];
  const names = Object.keys(zip.files)
    .filter((n) => f.parts.test(n))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  for (const name of names) {
    const xml = await zip.file(name).async("string");
    // A sheet holds words of its own only in inline strings; the rest are shared
    if (
      kind === "xlsx" &&
      name.includes("worksheets/") &&
      !xml.includes("inlineStr")
    )
      continue;
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    parts.push({ name, doc, units: paragraphsOf(doc, f, serializer) });
  }
  return { kind, zip, f, parts, serializer };
}

/** Segments, one per distinct text: a line said twice is translated once. */
function numberUnits(parts) {
  const ids = new Map();
  const segments = {};
  for (const part of parts)
    for (const unit of part.units) {
      unit.tag = tagged(unit);
      if (!ids.has(unit.tag.text)) {
        const id = String(ids.size + 1);
        ids.set(unit.tag.text, id);
        segments[id] = unit.tag.text;
      }
      unit.id = ids.get(unit.tag.text);
    }
  return segments;
}

/** Writes one translated paragraph back into its XML, in the looks its words had. */
function rewrite(unit, translated, f, doc) {
  const { pieces, clean } = untag(translated, unit.tag.tags);
  const byTag = new Map([
    [
      null,
      unit.pieces.find((x) => x.key === unit.tag.base) ??
        unit.pieces.find((x) => x.key !== null),
    ],
  ]);
  for (const [key, n] of unit.tag.tags)
    byTag.set(
      n,
      unit.pieces.find((x) => x.key === key),
    );
  const first = unit.pieces.find((x) => x.key !== null).run;
  // Plain `<t>` in a shared string: only its text changes
  if (first === unit.p) {
    const t = children(unit.p, "t")[0];
    while (t.firstChild) t.removeChild(t.firstChild);
    t.appendChild(doc.createTextNode(pieces.map((x) => x.text).join("")));
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    return clean;
  }
  const anchorOf = (run) => {
    let node = run;
    while (node.parentNode && node.parentNode !== unit.p)
      node = node.parentNode;
    return node;
  };
  const anchor = anchorOf(first);
  const parent = anchor.parentNode;
  const made = [];
  const runFor = (model, text) => {
    const run = make(doc, f.run);
    const props = children(model.run, f.props)[0];
    if (props) run.appendChild(props.cloneNode(true));
    const t = make(doc, f.text);
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.appendChild(doc.createTextNode(text));
    run.appendChild(t);
    return run;
  };
  for (const piece of pieces) {
    const model = byTag.get(piece.tag) ?? byTag.get(null);
    const lines = piece.text.split("\n");
    lines.forEach((line, i) => {
      if (i) {
        if (f.para === "a:p") {
          const br = make(doc, "a:br");
          const props = children(model.run, f.props)[0];
          if (props) br.appendChild(props.cloneNode(true));
          made.push(br);
        } else if (f.para === "w:p") {
          const run = make(doc, "w:r");
          run.appendChild(make(doc, "w:br"));
          made.push(run);
        }
      }
      if (!line) return;
      let node = runFor(model, line);
      if (model.link) {
        const link = model.link.cloneNode(false);
        link.appendChild(node);
        node = link;
      }
      made.push(node);
    });
  }
  for (const node of made) parent.insertBefore(node, anchor);
  for (const x of unit.pieces) x.run.parentNode?.removeChild(x.run);
  // A link or tag left with no runs goes too
  for (const x of unit.pieces) {
    const wrap =
      x.link ??
      (x.run.parentNode && f.wrappers.includes(x.run.parentNode.nodeName)
        ? x.run.parentNode
        : null);
    if (
      wrap?.parentNode &&
      !Array.from(wrap.childNodes).some((n) => n.nodeType === 1)
    )
      wrap.parentNode.removeChild(wrap);
  }
  return clean;
}

// ——— PDF ———

/** Lines grouped into blocks: the same left edge or centre, the same size, close together. */
function blocksOf(lines) {
  const blocks = [];
  // Turned text (a margin note set sideways) stays as it is
  for (const line of lines.filter((l) => !l.turned)) {
    const b = blocks.at(-1);
    const last = b?.lines.at(-1);
    const joins =
      b &&
      Math.abs(line.size - b.size) < b.size * 0.08 &&
      line.y - (last.y + last.h) < b.size * 0.9 &&
      line.y > last.y &&
      (Math.abs(line.x - b.x) < b.size * 0.6 ||
        Math.abs(line.x + line.w / 2 - (b.x + b.w / 2)) < b.size);
    if (joins) {
      b.lines.push(line);
      const right = Math.max(b.x + b.w, line.x + line.w);
      b.x = Math.min(b.x, line.x);
      b.w = right - b.x;
      b.h = line.y + line.h - b.y;
    } else
      blocks.push({
        lines: [line],
        x: line.x,
        y: line.y,
        w: line.w,
        h: line.h,
        size: line.size,
      });
  }
  for (const b of blocks) {
    let text = "";
    let before = null;
    for (const line of b.lines) {
      const t = line.text.trim();
      // A line ended on purpose when it stopped well short of the block's edge, or when the
      // next line's first word would have fitted after it
      const word = t.split(/\s/)[0];
      const room = before ? b.x + b.w - (before.x + before.w) : 0;
      const hard =
        before &&
        (before.w < b.w * 0.75 ||
          room > (line.w * (word.length + 1)) / Math.max(1, t.length));
      before = line;
      if (!text) text = t;
      else if (hard) text += `\n${t}`;
      // A word broken at the end of a line joins up again; CJK lines join with no space
      else if (/[a-z]-$/.test(text) && /^[a-z]/.test(t))
        text = text.slice(0, -1) + t;
      else if (/[぀-ヿ㐀-鿿가-힯]$/.test(text) && /^[぀-ヿ㐀-鿿]/.test(t))
        text += t;
      else text += ` ${t}`;
    }
    b.text = text;
    b.centred =
      b.lines.length > 1 &&
      b.lines.every(
        (l) =>
          Math.abs(l.x + l.w / 2 - (b.x + b.w / 2)) < b.size * 0.8 &&
          Math.abs(l.x - b.x) > b.size * 0.6,
      );
  }
  return blocks.filter((b) => LETTER.test(b.text));
}

async function pdfBlocks(file) {
  const { openPdfjs, pageLines } = await import("./pdf.mjs");
  const doc = await openPdfjs(file);
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { lines } = await pageLines(page);
    pages.push({ n, page, blocks: blocksOf(lines) });
  }
  return { doc, pages };
}

/**
 * The colour around a block and the colour of its words, read off the page drawn at 2×:
 * the patch that covers the original is painted to match what surrounds it.
 */
async function colours(page, blocks) {
  const { createCanvas } = await kit("@napi-rs/canvas");
  const scale = 2;
  const view = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(view.width), Math.ceil(view.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: view, canvas }).promise;
  const { data, width, height } = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const at = (x, y) => {
    const i =
      (Math.min(height - 1, Math.max(0, Math.round(y))) * width +
        Math.min(width - 1, Math.max(0, Math.round(x)))) *
      4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const hex = (c) =>
    `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const bold = new Map();
  for (const b of blocks) {
    const x0 = (b.x - 2) * scale;
    const y0 = (b.y - 2) * scale;
    const x1 = (b.x + b.w + 2) * scale;
    const y1 = (b.y + b.h + 3) * scale;
    const ring = [];
    for (let x = x0; x <= x1; x += 2) ring.push(at(x, y0), at(x, y1));
    for (let y = y0; y <= y1; y += 2) ring.push(at(x0, y), at(x1, y));
    const counts = new Map();
    for (const c of ring) {
      const key = c.map((v) => v >> 3).join(",");
      counts.set(key, [(counts.get(key)?.[0] ?? 0) + 1, c]);
    }
    const bg = [...counts.values()].sort((a, b) => b[0] - a[0])[0][1];
    let ink = null;
    let far = 0;
    for (let y = y0 + 4; y < y1 - 4; y += 2)
      for (let x = x0 + 4; x < x1 - 4; x += 2) {
        const c = at(x, y);
        const d =
          Math.abs(c[0] - bg[0]) +
          Math.abs(c[1] - bg[1]) +
          Math.abs(c[2] - bg[2]);
        if (d > far) {
          far = d;
          ink = c;
        }
      }
    b.background = hex(bg);
    b.color = ink ? hex(ink) : "#111111";
    // How far the page stays plain background to the right (and left): room the translation may take
    const plain = (x) => {
      for (let y = y0; y <= y1; y += 2) {
        const c = at(x, y);
        if (
          Math.abs(c[0] - bg[0]) +
            Math.abs(c[1] - bg[1]) +
            Math.abs(c[2] - bg[2]) >
          24
        )
          return false;
      }
      return true;
    };
    const edge = 18 * scale;
    let right = x1;
    while (right + 2 < width - edge && plain(right + 2)) right += 2;
    let left = x0;
    while (left - 2 > edge && plain(left - 2)) left -= 2;
    b.roomRight = Math.max(0, (right - x1) / scale - 4);
    b.roomLeft = Math.max(0, (x0 - left) / scale - 4);
  }
  // Whether a block's font is bold is in the font's own name, known once the page is drawn
  try {
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!item.fontName || bold.has(item.fontName)) continue;
      const font = page.commonObjs.has(item.fontName)
        ? page.commonObjs.get(item.fontName)
        : null;
      // Weights and slants as font names spell them: Bold, Bd, Black, Blk, Demi, Heavy; Italic, It
      const name = font?.name ?? "";
      bold.set(item.fontName, {
        bold: /bold|black|heavy|demi|[-,](bd|blk|hv|sb)/i.test(name),
        italic: /italic|oblique|[-,](\w*It)$/i.test(name),
        serif: content.styles[item.fontName]?.fontFamily === "serif",
      });
    }
  } catch {}
  return bold;
}

/**
 * The box a translated block is printed in: its own, and wider into the plain page beside it
 * when the translation is longer — to the right, or both ways for centred text.
 */
function place(b, text) {
  // Length says little across scripts (CJK glyphs are wide): offer room, the browser takes what it needs
  const want = b.w * 1.5 + b.size * 4 + (text.length > b.text.length ? b.w : 0);
  let x = b.x - 1;
  let w = b.w + 2;
  if (b.centred) {
    const side = Math.min(b.roomLeft ?? 0, b.roomRight ?? 0, want / 2);
    x -= side;
    w += 2 * side;
  } else w += Math.min(b.roomRight ?? 0, want);
  return { x, y: b.y - 1.5, w, h: b.h + b.size * 0.3 + 2.5 };
}

// ——— Commands ———

export async function segments(file, opts) {
  const source = input(file);
  const kind = kindOf(source);
  let map;
  if (kind === "pdf") {
    const { pages } = await pdfBlocks(source);
    map = {};
    let id = 0;
    for (const page of pages)
      for (const b of page.blocks) map[String(++id)] = b.text;
    if (!id)
      throw new Stop(
        "No text in this PDF: it is a scan. Read it with look_at and make a new document instead.",
      );
  } else map = numberUnits((await openOffice(source)).parts);
  const out = opts.out
    ? output(opts.out, "segments", "json")
    : `${workDir(source)}/segments.json`;
  writeFileSync(
    out,
    `${JSON.stringify({ file: shown(source), segments: map }, null, 1)}\n`,
  );
  const count = Object.keys(map).length;
  const chars = Object.values(map).reduce((n, t) => n + t.length, 0);
  console.log(
    `${count} segments, ${chars} characters: ${shown(out)}
Write the translation as one JSON object, the same ids to translated text ({"1": "…", "2": "…"}), keeping every <1>…</1> tag around the words it marks and every line break. A long file can go in several files, each with some of the ids.
Then: apply ${shown(source)} <translation.json>...`,
  );
}

function readTranslations(paths) {
  if (!paths.length) throw new Stop("Name the translated JSON file(s).");
  const all = {};
  for (const path of paths) {
    const data = readJson(path);
    Object.assign(all, data.segments ?? data);
  }
  return all;
}

export async function apply(file, translations, opts) {
  const source = input(file);
  const kind = kindOf(source);
  const translated = readTranslations(translations);
  const stem = basename(source).replace(/\.[a-z]+$/i, "");
  const out = output(opts.out, `${stem}-${opts.lang ?? "translated"}`, kind);
  const missing = new Set();
  let untagged = 0;
  const grew = [];

  if (kind === "pdf") {
    const { pages } = await pdfBlocks(source);
    const marks = [];
    let id = 0;
    for (const page of pages) {
      const fonts = await colours(page.page, page.blocks);
      for (const b of page.blocks) {
        const text = translated[String(++id)];
        if (text == null) {
          missing.add(id);
          continue;
        }
        const first = b.lines[0];
        const look = fonts.get(first.font) ?? {};
        marks.push({
          id,
          page: page.n,
          // Down to the last line's descenders, and across whatever plain room is beside it
          ...place(b, String(text)),
          size: b.size,
          text: String(text),
          wrap: true,
          erase: true,
          background: b.background,
          color: b.color,
          bold: look.bold,
          italic: look.italic,
          serif: look.serif,
          align: b.centred ? "center" : undefined,
        });
      }
    }
    const { stampMarks } = await import("./pdf.mjs");
    const shrunk = await stampMarks(source, marks, out);
    marks.forEach((m, i) => {
      const ratio = shrunk[i] ?? 1;
      if (ratio < 0.75) grew.push(`#${m.id} (${Math.round(ratio * 100)}%)`);
    });
  } else {
    const { zip, f, parts, serializer } = await openOffice(source);
    numberUnits(parts);
    for (const part of parts) {
      if (!part.units.length) continue;
      for (const unit of part.units) {
        const text = translated[unit.id];
        if (text == null) {
          missing.add(unit.id);
          continue;
        }
        if (!rewrite(unit, String(text), f, part.doc)) untagged++;
        const before = unit.text.length;
        if (
          kind === "pptx" &&
          before > 12 &&
          String(text).replace(/<\/?\d+>/g, "").length > before * 1.3
        )
          grew.push(`#${unit.id}`);
      }
      if (kind === "pptx")
        // Text that grew may shrink to its box where the reader supports it
        for (const body of Array.from(
          part.doc.getElementsByTagName("a:bodyPr"),
        ))
          if (
            !Array.from(body.childNodes).some((n) =>
              /Autofit$|AutoFit$/.test(n.nodeName ?? ""),
            )
          )
            body.appendChild(make(part.doc, "a:normAutofit"));
      zip.file(part.name, serializer.serializeToString(part.doc));
    }
    writeFileSync(
      out,
      await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    );
  }

  const lines = [`${shown(out)}`];
  if (missing.size)
    lines.push(
      `${missing.size} segment(s) had no translation and kept their original words.`,
    );
  if (untagged)
    lines.push(
      `${untagged} segment(s) lost their <n> tags, so their bold or linked words came out plain.`,
    );
  if (grew.length)
    lines.push(
      kind === "pdf"
        ? `Shrunk to fit their place, so they read small — say them shorter: ${grew.join(", ")}`
        : `Much longer than the original, and may overflow its box on the slide — say them shorter: ${[...new Set(grew)].join(", ")}`,
    );
  if (kind === "pdf") {
    const { report } = await import("./report.mjs");
    console.log(lines.join("\n"));
    await report(out);
  } else {
    lines.push(
      kind === "pptx"
        ? "Charts and pictures of text keep their original words."
        : kind === "xlsx"
          ? "Sheet names and formulas are as they were."
          : "Charts and pictures of text keep their original words.",
    );
    console.log(lines.join("\n"));
  }
}
