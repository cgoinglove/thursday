// A document as a Word file (.docx), made in the page from what the page shows now, edits and
// all: headings, paragraphs, lists and checklists, tables, quotes and notes, code, dividers,
// pictures and charts, links, bold, italic and the rest. An .docx is a zip of a few XML files
// (Office Open XML, ECMA-376); this writes them and zips them stored, which every reader opens.
// The paper size is left to Word, which takes the reader's own.
//
// `window.shell.docx()` resolves to `{ bytes, missed }`: the file, and the pictures that could
// not be put in (each stands in the file as its words). Export › Word file downloads it;
// document.mjs docx runs the same in a headless browser to hand the file back.
(() => {
  const paper = document.getElementById("paper");
  if (!paper || !window.shell) return;

  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const R =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  /** Pixels at 96 to the inch, as EMU (English metric units) and as twentieths of a point. */
  const EMU = 9525;
  /** The widest a picture is put in, in inches: a page's width inside its margins. */
  const WIDEST_IN = 6;

  const xml = (text) =>
    String(text)
      // Characters XML 1.0 cannot hold
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
      .replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
      );

  /* ── one export's state ──────────────────────────────────────────────── */

  let rels; // [{ id, type, target, external }]
  let media; // [{ name, bytes }]
  let nums; // numbering instances: [{ abstract, restart }]
  let drawings;
  let missed;
  let titled; // the first h1 was the title: headings under it are a level up
  const rel = (type, target, external) => {
    const id = `rId${rels.length + 10}`;
    rels.push({ id, type, target, external });
    return id;
  };

  /* ── pictures ────────────────────────────────────────────────────────── */

  const loaded = (img) =>
    img.complete && img.naturalWidth
      ? Promise.resolve()
      : new Promise((ok) => {
          img.addEventListener("load", ok, { once: true });
          img.addEventListener("error", ok, { once: true });
        });

  /** A PNG of what `source` draws (an image or an SVG), at twice its size for a sharp print. */
  const png = async (source, width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * 2));
    canvas.height = Math.max(1, Math.round(height * 2));
    const g = canvas.getContext("2d");
    g.scale(2, 2);
    g.drawImage(source, 0, 0, width, height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/png"));
    if (!blob) throw new Error("the picture could not be drawn");
    return new Uint8Array(await blob.arrayBuffer());
  };

  /** A picture as a run in the file, its size kept, no wider than the page. */
  const picture = (bytes, ext, width, height, words) => {
    const name = `image${media.length + 1}.${ext}`;
    media.push({ name, bytes });
    const id = rel(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      `media/${name}`,
    );
    const scale = Math.min(1, (WIDEST_IN * 96) / width);
    const cx = Math.round(width * scale * EMU);
    const cy = Math.round(height * scale * EMU);
    const n = ++drawings;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}" descr="${xml(words)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };

  /** An <img>: its own bytes when Word reads them (PNG, JPEG, GIF), else drawn as a PNG. */
  const image = async (img) => {
    await loaded(img);
    const words = img.alt || img.getAttribute("src") || "picture";
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    try {
      if (!width || !height) throw new Error("it did not load");
      const answer = await fetch(img.currentSrc || img.src);
      if (!answer.ok) throw new Error(`it answered ${answer.status}`);
      const blob = await answer.blob();
      const ext = {
        "image/png": "png",
        "image/jpeg": "jpeg",
        "image/gif": "gif",
      }[blob.type];
      const bytes = ext
        ? new Uint8Array(await blob.arrayBuffer())
        : await png(img, width, height);
      return picture(bytes, ext ?? "png", width, height, words);
    } catch (failed) {
      missed.push(`${words}: ${failed.message}`);
      return run(`[${words}]`, {});
    }
  };

  /** An <svg> drawn on the page — a chart — as a PNG of it at the size it is drawn. */
  const svgPicture = async (svg) => {
    const box = svg.getBoundingClientRect();
    const words = svg.getAttribute("aria-label") || "chart";
    try {
      const copy = svg.cloneNode(true);
      copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      copy.setAttribute("width", String(box.width));
      copy.setAttribute("height", String(box.height));
      // Colours the page's stylesheet gives it, written onto each part, as a file has no stylesheet
      const from = svg.querySelectorAll("*");
      const to = copy.querySelectorAll("*");
      from.forEach((el, i) => {
        const style = getComputedStyle(el);
        for (const prop of [
          "fill",
          "stroke",
          "stroke-width",
          "stroke-dasharray",
          "opacity",
          "font-family",
          "font-size",
          "font-weight",
          "text-anchor",
          "dominant-baseline",
        ])
          to[i].style.setProperty(prop, style.getPropertyValue(prop));
      });
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(copy)], {
          type: "image/svg+xml",
        }),
      );
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const bytes = await png(img, box.width, box.height);
        return picture(bytes, "png", box.width, box.height, words);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (failed) {
      missed.push(`${words}: ${failed.message}`);
      return run(`[${words}]`, {});
    }
  };

  /* ── words ───────────────────────────────────────────────────────────── */

  /** A run of text in a format: `{ b, i, u, s, code, sup, sub, mark, color, size }`. */
  const run = (text, f) => {
    if (!text) return "";
    const props = [
      f.style ? `<w:rStyle w:val="${f.style}"/>` : "",
      f.code ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : "",
      f.b ? "<w:b/>" : "",
      f.i ? "<w:i/>" : "",
      f.s ? "<w:strike/>" : "",
      f.color ? `<w:color w:val="${f.color}"/>` : "",
      f.size ? `<w:sz w:val="${f.size}"/>` : "",
      f.mark ? '<w:highlight w:val="yellow"/>' : "",
      f.u ? '<w:u w:val="single"/>' : "",
      f.code ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F4F7"/>' : "",
      f.sup ? '<w:vertAlign w:val="superscript"/>' : "",
      f.sub ? '<w:vertAlign w:val="subscript"/>' : "",
    ].join("");
    const rPr = props ? `<w:rPr>${props}</w:rPr>` : "";
    return text
      .split("\n")
      .map(
        (line, i) =>
          (i ? `<w:r>${rPr}<w:br/></w:r>` : "") +
          line
            .split("\t")
            .map(
              (part, j) =>
                (j ? `<w:r>${rPr}<w:tab/></w:r>` : "") +
                (part
                  ? `<w:r>${rPr}<w:t xml:space="preserve">${xml(part)}</w:t></w:r>`
                  : ""),
            )
            .join(""),
      )
      .join("");
  };

  const hidden = (el) =>
    el.hidden ||
    el.getAttribute("aria-hidden") === "true" ||
    getComputedStyle(el).display === "none";

  const INLINE = new Set([
    "A",
    "ABBR",
    "B",
    "BDI",
    "BR",
    "CITE",
    "CODE",
    "DEL",
    "DFN",
    "EM",
    "I",
    "IMG",
    "INPUT",
    "KBD",
    "LABEL",
    "MARK",
    "Q",
    "S",
    "SAMP",
    "SMALL",
    "SPAN",
    "STRIKE",
    "STRONG",
    "SUB",
    "SUP",
    "TIME",
    "U",
    "VAR",
    "SVG",
  ]);
  const isInline = (node) =>
    node.nodeType === Node.TEXT_NODE ||
    (node.nodeType === Node.ELEMENT_NODE &&
      INLINE.has(node.nodeName.toUpperCase()));

  /** The runs a piece of a paragraph makes, in the format it is in. */
  const inline = async (node, f) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (f.pre) return run(node.data, f);
      // Spaces as the page shows them: runs of them one, as HTML draws them; a box ticked or
      // not brings its own space
      const text = node.data.replace(/\s+/g, " ");
      const box = node.previousSibling?.nodeName?.toUpperCase() === "INPUT";
      return run(box ? text.trimStart() : text, f);
    }
    if (node.nodeType !== Node.ELEMENT_NODE || hidden(node)) return "";
    const tag = node.nodeName.toUpperCase();
    if (tag === "BR") return "<w:r><w:br/></w:r>";
    if (tag === "IMG") return image(node);
    if (tag === "SVG") return svgPicture(node);
    if (tag === "INPUT")
      return node.type === "checkbox" ? run(node.checked ? "☑ " : "☐ ", f) : "";
    // A footnote's way back to where it was cited, and how long the page takes to read on
    // screen: the page's alone (quick.js clean takes the second out of a saved copy too)
    if (node.classList.contains("fn-back") || node.matches(".chip.read"))
      return "";
    const next = { ...f };
    if (tag === "B" || tag === "STRONG") next.b = true;
    if (tag === "I" || tag === "EM" || tag === "CITE" || tag === "DFN")
      next.i = true;
    if (tag === "S" || tag === "DEL" || tag === "STRIKE") next.s = true;
    if (tag === "U") next.u = true;
    if (tag === "CODE" || tag === "KBD" || tag === "SAMP") next.code = true;
    if (tag === "SUP") next.sup = true;
    if (tag === "SUB") next.sub = true;
    if (tag === "MARK") next.mark = true;
    if (tag === "SMALL") next.size = 18;
    let out = "";
    for (const child of node.childNodes) out += await inline(child, next);
    if (tag === "A") {
      const href = node.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) {
        const id = rel(
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
          href,
          true,
        );
        let linked = "";
        for (const child of node.childNodes)
          linked += await inline(child, { ...next, style: "Hyperlink" });
        return `<w:hyperlink r:id="${id}">${linked}</w:hyperlink>`;
      }
    }
    return out;
  };

  /** A paragraph of `runs` in `style`, with more of its properties in `props`. */
  const para = (runs, style, props = "") =>
    `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${props}</w:pPr>${runs}</w:p>`;

  /* ── blocks ──────────────────────────────────────────────────────────── */

  const listNum = (ordered, start) => {
    nums.push({ abstract: ordered ? 1 : 0, start });
    return nums.length;
  };

  /** The paragraphs and tables a block element makes. `at` carries the list or quote it is in. */
  const blocks = async (el, at) => {
    const out = [];
    // Words and inline pieces between blocks gather into one paragraph each
    let pending = [];
    const flush = async () => {
      if (!pending.length) return;
      let runs = "";
      for (const node of pending) runs += await inline(node, at.f ?? {});
      pending = [];
      if (!runs.replace(/<[^>]+>/g, "").trim() && !/w:drawing/.test(runs))
        return;
      // The spaces between the page's tags, at a paragraph's two ends, are not words
      const open = '<w:t xml:space="preserve">';
      const first = runs.indexOf(open) + open.length;
      if (first >= open.length)
        runs = runs.slice(0, first) + runs.slice(first).replace(/^\s+/, "");
      const last = runs.lastIndexOf("</w:t>");
      if (last !== -1)
        runs = runs.slice(0, last).replace(/\s+$/, "") + runs.slice(last);
      // An item's first paragraph carries its number or bullet; the rest sit under it
      // Word reads a paragraph's properties in the schema's order: the number before the rest
      let props = "";
      if (at.list?.first.value && at.list.num) {
        props = `<w:numPr><w:ilvl w:val="${at.list.level}"/><w:numId w:val="${at.list.num}"/></w:numPr>`;
        at.list.first.value = false;
      } else if (at.list)
        props = `<w:ind w:left="${720 + at.list.level * 360}"/>`;
      out.push(para(runs, at.style, props + (at.props ?? "")));
    };
    for (const node of el.childNodes) {
      if (isInline(node)) {
        pending.push(node);
        continue;
      }
      await flush();
      if (node.nodeType === Node.ELEMENT_NODE && !hidden(node))
        out.push(...(await block(node, at)));
    }
    await flush();
    return out;
  };

  const block = async (el, at) => {
    const tag = el.nodeName.toUpperCase();
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) {
      const level = Number(heading[1]);
      let style;
      if (level === 1 && !titled) {
        titled = true;
        style = "Title";
      } else
        style = `Heading${Math.min(4, Math.max(1, level - (titled ? 1 : 0)))}`;
      return blocks(el, { ...at, list: null, style, props: "" });
    }
    if (tag === "P") {
      const kind = el.classList;
      const style = kind.contains("lede")
        ? "Subtitle"
        : kind.contains("stat")
          ? "Stat"
          : kind.contains("byline") || kind.contains("kicker")
            ? "Byline"
            : (at.style ?? null);
      return blocks(el, { ...at, style });
    }
    if (tag === "UL" || tag === "OL") {
      const level = at.list ? at.list.level + 1 : 0;
      // A checklist's boxes are its marks: no bullet beside them
      const checks = [...el.children].every(
        (li) => li.querySelector(":scope > input[type=checkbox]") !== null,
      );
      const num = checks
        ? 0
        : listNum(tag === "OL", Number(el.getAttribute("start")) || 1);
      const out = [];
      for (const li of el.children) {
        if (li.nodeName.toUpperCase() !== "LI" || hidden(li)) continue;
        const first = { value: true };
        out.push(
          ...(await blocks(li, {
            ...at,
            list: { num, level, first },
            style: "ListParagraph",
            props: "",
          })),
        );
      }
      return out;
    }
    if (tag === "TABLE") return [await table(el, at)];
    if (tag === "PRE") {
      const runs = await inline(el, { code: true, pre: true });
      return [para(runs, "Code")];
    }
    if (tag === "HR")
      return [
        para(
          "",
          null,
          '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C9CED6"/></w:pBdr>',
        ),
      ];
    if (tag === "BLOCKQUOTE" || el.classList.contains("note"))
      return blocks(el, { ...at, style: "Quote", props: "" });
    if (tag === "FIGCAPTION" || tag === "CAPTION")
      return blocks(el, { ...at, style: "Caption", props: "" });
    if (tag === "FIGURE")
      return blocks(el, {
        ...at,
        style: null,
        props: '<w:jc w:val="center"/>',
      });
    // A chart's own table and CSV, folded under it on the page: the picture carries the chart
    if (tag === "DETAILS" && el.closest("figure.chart")) return [];
    // A fold is open in Word: what it holds, under its summary
    if (tag === "DETAILS") return blocks(el, at);
    if (tag === "SUMMARY") return blocks(el, { ...at, f: { b: true } });
    if (
      tag === "SCRIPT" ||
      tag === "STYLE" ||
      tag === "TEMPLATE" ||
      tag === "BUTTON"
    )
      return [];
    // A box of blocks: what is in it, in order
    return blocks(el, at);
  };

  const table = async (el, at) => {
    const rows = [...el.rows].filter((row) => !hidden(row));
    const width = Math.max(
      1,
      ...rows.map((row) =>
        [...row.cells].reduce((n, cell) => n + (cell.colSpan || 1), 0),
      ),
    );
    // Even shares of a page's width inside its margins; Word fits them to what they hold
    const grid = `<w:tblGrid>${`<w:gridCol w:w="${Math.floor(9000 / width)}"/>`.repeat(width)}</w:tblGrid>`;
    let body = "";
    for (const row of rows) {
      const head = row.parentElement?.nodeName.toUpperCase() === "THEAD";
      let cells = "";
      for (const cell of row.cells) {
        const inside = await blocks(cell, {
          ...at,
          list: null,
          style: null,
          props: /right|end/.test(getComputedStyle(cell).textAlign)
            ? '<w:jc w:val="right"/>'
            : "",
          f: head || cell.nodeName === "TH" ? { b: true } : {},
        });
        const span =
          cell.colSpan > 1 ? `<w:gridSpan w:val="${cell.colSpan}"/>` : "";
        const shade = head
          ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F4F7"/>'
          : "";
        cells += `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${span}${shade}</w:tcPr>${inside.join("") || "<w:p/>"}</w:tc>`;
      }
      body += `<w:tr>${head ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells}</w:tr>`;
    }
    return `<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>${grid}${body}</w:tbl><w:p/>`;
  };

  /* ── the file ────────────────────────────────────────────────────────── */

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${xml(document.documentElement.lang || "en-US")}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="4B5563"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Byline"><w:name w:val="Byline"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="6B7280"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Stat"><w:name w:val="Stat"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
${[1, 2, 3, 4]
  .map(
    (n) =>
      `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${[360, 280, 240, 200][n - 1]}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[36, 30, 26, 22][n - 1]}"/></w:rPr></w:style>`,
  )
  .join("")}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="C9CED6"/></w:pBdr><w:ind w:left="284"/></w:pPr><w:rPr><w:color w:val="374151"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F4F7"/><w:spacing w:after="160" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:color w:val="6B7280"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="C9CED6"/><w:left w:val="single" w:sz="4" w:color="C9CED6"/><w:bottom w:val="single" w:sz="4" w:color="C9CED6"/><w:right w:val="single" w:sz="4" w:color="C9CED6"/><w:insideH w:val="single" w:sz="4" w:color="C9CED6"/><w:insideV w:val="single" w:sz="4" w:color="C9CED6"/></w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

  const numbering = () => {
    const level = (ordered, n) => {
      const fmt = ordered
        ? ["decimal", "lowerLetter", "lowerRoman"][n % 3]
        : "bullet";
      const text = ordered ? `%${n + 1}.` : ["•", "◦", "▪"][n % 3];
      return `<w:lvl w:ilvl="${n}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + n * 360}" w:hanging="360"/></w:pPr></w:lvl>`;
    };
    const abstract = (id, ordered) =>
      `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, n) => level(ordered, n)).join("")}</w:abstractNum>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}">${abstract(0, false)}${abstract(1, true)}${nums
      .map(
        (one, i) =>
          `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${one.abstract}"/>${one.abstract ? `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${one.start}"/></w:lvlOverride>` : ""}</w:num>`,
      )
      .join("")}</w:numbering>`;
  };

  /* ── a zip, stored ───────────────────────────────────────────────────── */

  const CRC = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  /** Files `{ name: bytes }` as one zip, each stored as it is (method 0). */
  const zip = (files) => {
    const encode = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [name, bytes] of Object.entries(files)) {
      const path = encode.encode(name);
      const crc = crc32(bytes);
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, 0x0800, true); // names in UTF-8
      head.setUint16(8, 0, true);
      head.setUint16(10, 0, true);
      head.setUint16(12, 0x21, true); // 1980-01-01
      head.setUint32(14, crc, true);
      head.setUint32(18, bytes.length, true);
      head.setUint32(22, bytes.length, true);
      head.setUint16(26, path.length, true);
      parts.push(new Uint8Array(head.buffer), path, bytes);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(14, 0x21, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, bytes.length, true);
      entry.setUint32(24, bytes.length, true);
      entry.setUint16(28, path.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), path);
      offset += 30 + path.length + bytes.length;
    }
    const size = central.reduce((n, part) => n + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, Object.keys(files).length, true);
    end.setUint16(10, Object.keys(files).length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of all) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };

  /* ── the whole of it ─────────────────────────────────────────────────── */

  window.shell.docx = async () => {
    rels = [];
    media = [];
    nums = [];
    drawings = 0;
    missed = [];
    titled = false;
    const body = (await blocks(paper, {})).join("");
    const title = document.title || "Document";
    const text = (s) => new TextEncoder().encode(s);
    const files = {
      "[Content_Types].xml":
        text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
      "_rels/.rels":
        text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
      "docProps/core.xml":
        text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`),
      "word/_rels/document.xml.rels":
        text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${R}/numbering" Target="numbering.xml"/>${rels
          .map(
            (one) =>
              `<Relationship Id="${one.id}" Type="${one.type}" Target="${xml(one.target)}"${one.external ? ' TargetMode="External"' : ""}/>`,
          )
          .join("")}</Relationships>`),
      "word/styles.xml": text(STYLES),
      "word/numbering.xml": text(numbering()),
      "word/document.xml":
        text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`),
    };
    for (const one of media) files[`word/media/${one.name}`] = one.bytes;
    return { bytes: zip(files), missed: [...missed] };
  };

  // Export › Word file
  document.querySelector("[data-docx]")?.addEventListener("click", async () => {
    const { bytes, missed: left } = await window.shell.docx();
    const url = URL.createObjectURL(
      new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    const name = `${(document.title || "document").replace(/[\\/:*?"<>|]+/g, "-")}.docx`;
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: name,
    });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (left.length)
      alert(`Pictures not put in the Word file:\n${left.join("\n")}`);
  });
})();
