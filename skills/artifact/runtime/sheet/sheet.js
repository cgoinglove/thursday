// What a sheet does in the page: its tabs, cells picked with the mouse or the arrow keys (the
// formula line shows the one the ring is on, the foot the sum of the rest), a column sorted or
// filtered from its heading, the totals worked out again over the rows in view, and the sheet
// copied or saved as CSV. Sorting and filtering are a view. Edit changes the workbook itself:
// cells, the header's names, rows and columns put in or taken out with the formulas moved as
// Excel moves them, all worked out again here (formula.mjs), and kept by the app into the page
// and the .xlsx beside it (spreadsheet.mjs sync).
(() => {
  const source = document.getElementById("sheet-data");
  let book = null;
  try {
    book = JSON.parse(source?.textContent || "null");
  } catch {}
  if (!Array.isArray(book?.sheets)) return;

  const table = document.getElementById("table");
  const grid = document.getElementById("grid");
  const tabs = document.getElementById("tabs");
  const ref = document.getElementById("ref");
  const formula = document.getElementById("formula");
  const stat = document.getElementById("stat");
  const size = document.getElementById("size");
  const more = document.getElementById("more");
  const menu = document.getElementById("menu");
  const find = document.getElementById("find");
  const picks = document.getElementById("picks");
  const tools = document.getElementById("tools");
  const formatPick = document.getElementById("format");
  const note = document.getElementById("note");
  const fxBox = document.getElementById("fx-box");
  const fxShow = document.getElementById("fx-show");

  /** The most rows drawn at once; the .xlsx holds the rest. */
  const MOST = 10000;
  const colName = (index) => {
    let name = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
      name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
  };
  const isNumber = (v) => typeof v === "number";
  const shown = (v, column) => formatValue(v, column?.format);
  // A format's colour in the shell's own, so it reads in light and dark alike
  const COLORS = {
    Red: "var(--sh-bad)",
    Green: "var(--sh-good)",
    Blue: "var(--sh-brand)",
    Black: "var(--sh-ink)",
  };
  const paintColor = (el, v, code) => {
    const color = formatColor(v, code);
    if (color) el.style.color = COLORS[color];
  };
  /** A value as it is copied or typed: a date, in a column of dates, as YYYY-MM-DD. */
  const plain = (v, column) =>
    isNumber(v) && isDateFormat(column?.format) ? isoOf(v) : v;
  const figure = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  });

  // Each sheet's view: its sort, its filters, the cells picked
  const views = book.sheets.map(() => ({
    sort: null, // { c, dir: 1 | -1 }
    filters: new Map(), // column → the shown values kept
    pick: { r1: 0, c1: 0, r2: 0, c2: 0 }, // rows counted in view: -1 the header
  }));
  let at = 0;
  const sheet = () => book.sheets[at];
  const view = () => views[at];

  /** The rows in view, by their index in the sheet, sorted and filtered. */
  const order = () => {
    const { rows, columns } = sheet();
    const { sort, filters } = view();
    let list = rows.map((_, i) => i);
    for (const [c, kept] of filters)
      list = list.filter((i) =>
        kept.has(shown(rows[i][c]?.v ?? null, columns[c])),
      );
    if (sort) {
      const collator = new Intl.Collator(undefined, { numeric: true });
      list.sort((a, b) => {
        const [x, y] = [rows[a][sort.c]?.v ?? null, rows[b][sort.c]?.v ?? null];
        // Empty cells stay last whichever way it is sorted
        if (x === null || y === null)
          return x === y ? a - b : x === null ? 1 : -1;
        const c =
          isNumber(x) && isNumber(y)
            ? x - y
            : isNumber(x) !== isNumber(y)
              ? isNumber(x)
                ? -1
                : 1
              : collator.compare(String(x), String(y));
        return c * sort.dir || a - b;
      });
    }
    return list;
  };

  /** A totals cell worked out over the rows in view, as Excel's SUBTOTAL does over a filter. */
  const total = (fn, c, list) => {
    const values = list.map((i) => sheet().rows[i][c]?.v).filter(isNumber);
    if (fn === "count") return values.length;
    if (!values.length) return fn === "sum" ? 0 : null;
    if (fn === "sum")
      return Number(values.reduce((s, n) => s + n, 0).toPrecision(15));
    if (fn === "average")
      return Number(
        (values.reduce((s, n) => s + n, 0) / values.length).toPrecision(15),
      );
    return fn === "min" ? Math.min(...values) : Math.max(...values);
  };

  const cell = (tag, text, className, r, c) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    if (r !== undefined) {
      el.dataset.r = r;
      el.dataset.c = c;
    }
    return el;
  };
  const FUNNEL =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4Z"/></svg>';
  const ARROW_UP =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  const ARROW_DOWN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';
  const CHEVRON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';

  let list = [];
  const draw = () => {
    const { columns, rows, totals } = sheet();
    const { sort, filters } = view();
    list = order();
    table.replaceChildren();

    const widths = document.createElement("colgroup");
    widths.append(
      Object.assign(document.createElement("col"), { style: "width:48px" }),
    );
    let wide = 48;
    for (const column of columns) {
      const col = document.createElement("col");
      const px = Math.round(Math.max(4, column.width) * 7.2 + 18);
      col.style.width = `${px}px`;
      wide += px;
      widths.append(col);
    }
    // Its whole width, so a narrow window scrolls it rather than squeezing every column
    table.style.width = `${wide}px`;

    const head = document.createElement("thead");
    const letters = document.createElement("tr");
    letters.className = "ss-letters";
    letters.append(cell("th", "", "ss-row"));
    columns.forEach((_, c) =>
      letters.append(cell("th", colName(c), "", "L", c)),
    );
    const names = document.createElement("tr");
    names.className = "ss-names";
    names.append(cell("th", "1", "ss-row", -1, -1));
    columns.forEach((column, c) => {
      const th = cell("th", "", column.num ? "num" : "", -1, c);
      const name = document.createElement("span");
      name.className = "ss-name";
      const words = document.createElement("span");
      words.textContent = column.name;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `ss-col${sort?.c === c || filters.has(c) ? " on" : ""}`;
      button.dataset.col = c;
      button.setAttribute("aria-label", `Sort or filter ${column.name}`);
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-expanded", "false");
      button.innerHTML = filters.has(c)
        ? FUNNEL
        : sort?.c === c
          ? sort.dir > 0
            ? ARROW_UP
            : ARROW_DOWN
          : CHEVRON;
      name.append(words, button);
      th.append(name);
      names.append(th);
    });
    head.append(letters, names);

    const body = document.createElement("tbody");
    const drawn = list.slice(0, MOST);
    drawn.forEach((i, r) => {
      const tr = document.createElement("tr");
      tr.append(cell("th", String(i + 2), "ss-row", r, -1));
      columns.forEach((column, c) => {
        const v = rows[i][c]?.v ?? null;
        const error = v !== null && typeof v === "object";
        const td = cell(
          "td",
          shown(v, column),
          error ? "err" : isNumber(v) ? "num" : "",
          r,
          c,
        );
        paintColor(td, v, column.format);
        if (rows[i][c]?.f !== undefined) td.classList.add("fx");
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(widths, head, body);

    if (totals) {
      const foot = document.createElement("tfoot");
      const tr = document.createElement("tr");
      tr.append(cell("th", String(rows.length + 2), "ss-row", "T", -1));
      columns.forEach((column, c) => {
        const fn = totals.cells[c];
        const v = fn ? total(fn, c, list) : c === 0 ? totals.label : null;
        const td = cell(
          "td",
          fn ? shown(v, fn === "count" ? null : column) : (v ?? ""),
          fn ? "num" : "",
          "T",
          c,
        );
        if (fn && fn !== "count") paintColor(td, v, column.format);
        tr.append(td);
      });
      foot.append(tr);
      table.append(foot);
    }

    more.hidden = list.length <= MOST;
    more.textContent = `The first ${MOST.toLocaleString()} of ${list.length.toLocaleString()} rows are shown; the .xlsx holds them all.`;
    const filtered = filters.size
      ? ` · ${list.length.toLocaleString()} shown`
      : "";
    size.textContent = `${rows.length.toLocaleString()} rows${filtered}`;
    tabs.querySelectorAll("button").forEach((one, i) => {
      one.setAttribute("aria-selected", String(i === at));
      one.tabIndex = i === at ? 0 : -1;
    });
    paint();
  };

  /* ── picking cells ──────────────────────────────────────────────────────── */

  const clampPick = (p) => {
    const last = Math.min(list.length, MOST) - 1;
    const width = sheet().columns.length - 1;
    const fit = (r) => Math.max(-1, Math.min(last, r));
    const fitC = (c) => Math.max(0, Math.min(width, c));
    return { r1: fit(p.r1), c1: fitC(p.c1), r2: fit(p.r2), c2: fitC(p.c2) };
  };
  const inside = (p, r, c) =>
    r >= Math.min(p.r1, p.r2) &&
    r <= Math.max(p.r1, p.r2) &&
    c >= Math.min(p.c1, p.c2) &&
    c <= Math.max(p.c1, p.c2);

  /** The raw value at a picked position: the header's name, or a row's cell. */
  const valueAt = (r, c) =>
    r === -1
      ? sheet().columns[c].name
      : (sheet().rows[list[r]]?.[c]?.v ?? null);
  /** The value at a picked position as it is copied: a date as YYYY-MM-DD. */
  const plainAt = (r, c) =>
    r === -1 ? valueAt(r, c) : plain(valueAt(r, c), sheet().columns[c]);

  const paint = () => {
    const p = view().pick;
    for (const el of table.querySelectorAll(".in, .at"))
      el.classList.remove("in", "at");
    for (const el of table.querySelectorAll("[data-r]")) {
      const { r, c } = el.dataset;
      if (r === "L" || r === "T") {
        if (
          r === "L" &&
          Number(c) >= Math.min(p.c1, p.c2) &&
          Number(c) <= Math.max(p.c1, p.c2)
        )
          el.classList.add("in");
        continue;
      }
      const [row, col] = [Number(r), Number(c)];
      if (col === -1) {
        if (row >= Math.min(p.r1, p.r2) && row <= Math.max(p.r1, p.r2))
          el.classList.add("in");
        continue;
      }
      if (inside(p, row, col))
        el.classList.add(row === p.r1 && col === p.c1 ? "at" : "in");
    }
    // The cell the ring is on, as Excel names it, with its formula or its value
    const excelRow = p.r1 === -1 ? 1 : list[p.r1] + 2;
    ref.textContent = `${colName(p.c1)}${excelRow}`;
    const picked = p.r1 === -1 ? null : sheet().rows[list[p.r1]]?.[p.c1];
    const v = plainAt(p.r1, p.c1);
    formula.value =
      picked?.f ??
      (v === null
        ? ""
        : typeof v === "object"
          ? v.error
          : typeof v === "boolean"
            ? v
              ? "TRUE"
              : "FALSE"
            : String(v));
    // What the picked cells add up to, when more than one is picked
    const numbers = [];
    let filled = 0;
    for (let r = Math.min(p.r1, p.r2); r <= Math.max(p.r1, p.r2); r++)
      for (let c = Math.min(p.c1, p.c2); c <= Math.max(p.c1, p.c2); c++) {
        const one = valueAt(r, c);
        if (one === null || one === "") continue;
        filled++;
        if (isNumber(one) && r !== -1) numbers.push(one);
      }
    stat.replaceChildren();
    if (filled > 1) {
      const part = (label, value) => {
        const span = document.createElement("span");
        const b = document.createElement("b");
        b.textContent = value;
        span.append(`${label} `, b);
        stat.append(span);
      };
      if (numbers.length) {
        const sum = Number(numbers.reduce((s, n) => s + n, 0).toPrecision(15));
        part("Sum", figure.format(sum));
        part("Average", figure.format(sum / numbers.length));
      }
      part("Count", filled.toLocaleString());
    }
    if (editing && !typing) {
      place();
      drawFormat();
    }
    showRefs(picked?.f ?? null);
  };

  /* ── what a formula names ───────────────────────────────────────────────── */

  /** A colour for each reference a formula names, as Excel gives them. */
  const REF_COLORS = [
    "#2563eb",
    "#dc2626",
    "#16a34a",
    "#9333ea",
    "#ea580c",
    "#0891b2",
  ];
  let marked = [];
  /**
   * The cells `text` names on this sheet, each reference edged in its colour, and the formula
   * line with its references in the same colours. Null clears them.
   */
  function showRefs(text) {
    for (const el of marked) {
      el.removeAttribute("data-ref");
      el.removeAttribute("style");
      if (el.dataset.color) el.style.color = el.dataset.color;
    }
    marked = [];
    fxShow.replaceChildren();
    fxBox.classList.remove("colored");
    if (!text || !String(text).startsWith("=")) return;
    const refs = Formula.referencesIn(text);
    if (!refs.length) return;
    const colors = new Map();
    const colorOf = (ref) => {
      const key = text
        .slice(ref.start, ref.end)
        .replaceAll("$", "")
        .toUpperCase();
      if (!colors.has(key))
        colors.set(key, REF_COLORS[colors.size % REF_COLORS.length]);
      return colors.get(key);
    };
    // The line: the formula's text, each reference in its colour
    let from = 0;
    for (const ref of refs) {
      fxShow.append(text.slice(from, ref.start));
      const b = document.createElement("b");
      b.style.color = colorOf(ref);
      b.textContent = text.slice(ref.start, ref.end);
      fxShow.append(b);
      from = ref.end;
    }
    fxShow.append(text.slice(from));
    if (document.activeElement !== formula) fxBox.classList.add("colored");
    // The cells: where each reference on this sheet lands among the rows drawn
    const here = sheet().name.toLowerCase();
    const { rows } = sheet();
    const excelRow = (r) =>
      r === "-1" ? 0 : r === "T" ? rows.length + 1 : list[Number(r)] + 1;
    const boxes = refs
      .filter((ref) => (ref.sheet ?? sheet().name).toLowerCase() === here)
      .map((ref) => {
        const b = ref.b ?? ref.a;
        return {
          color: colorOf(ref),
          top: Math.min(ref.a.r ?? 0, b.r ?? 0),
          bottom:
            ref.a.r === null || b.r === null
              ? Infinity
              : Math.max(ref.a.r, b.r),
          left: Math.min(ref.a.c, b.c),
          right: Math.max(ref.a.c, b.c),
        };
      });
    if (!boxes.length) return;
    const lastRow = rows.length + (sheet().totals ? 1 : 0);
    for (const el of table.querySelectorAll(
      "td[data-r], .ss-names th[data-r]",
    )) {
      const c = Number(el.dataset.c);
      if (c < 0) continue;
      const r = excelRow(el.dataset.r);
      const box = boxes.find(
        (one) =>
          r >= one.top && r <= one.bottom && c >= one.left && c <= one.right,
      );
      if (!box) continue;
      if (el.style.color) el.dataset.color = el.style.color;
      el.dataset.ref = "";
      el.style.setProperty("--ref", box.color);
      if (r === box.top) el.style.setProperty("--rt", "2px");
      if (r === Math.min(box.bottom, lastRow))
        el.style.setProperty("--rb", "2px");
      if (c === box.left) el.style.setProperty("--rl", "2px");
      if (c === box.right) el.style.setProperty("--rr", "2px");
      marked.push(el);
    }
  }

  const pickTo = (r, c, extend) => {
    const p = view().pick;
    view().pick = clampPick(
      extend ? { ...p, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c },
    );
    paint();
    closeNote();
    const target = table.querySelector(
      `[data-r="${view().pick.r2}"][data-c="${view().pick.c2}"]`,
    );
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  let dragging = false;
  table.addEventListener("mousedown", (event) => {
    if (event.target.closest(".ss-col")) return;
    const el = event.target.closest("[data-r]");
    if (!el || el.dataset.r === "T") return;
    const { r, c } = el.dataset;
    if (typing) finish(true);
    // The grid would take the focus after this, from the editor that types into the cell
    event.preventDefault();
    focusGrid();
    if (r === "L") {
      // A column letter picks the whole column
      const last = Math.min(list.length, MOST) - 1;
      view().pick = clampPick({
        r1: -1,
        c1: Number(c),
        r2: last,
        c2: Number(c),
      });
      paint();
      return;
    }
    if (Number(c) === -1) {
      const width = sheet().columns.length - 1;
      view().pick = clampPick({
        r1: Number(r),
        c1: 0,
        r2: Number(r),
        c2: width,
      });
      paint();
      return;
    }
    pickTo(Number(r), Number(c), event.shiftKey);
    dragging = true;
  });
  table.addEventListener("mouseover", (event) => {
    if (!dragging) return;
    const el = event.target.closest("[data-r]");
    if (!el || ["L", "T"].includes(el.dataset.r) || Number(el.dataset.c) === -1)
      return;
    pickTo(Number(el.dataset.r), Number(el.dataset.c), true);
  });
  addEventListener("mouseup", () => {
    dragging = false;
  });

  /** Rows and columns as tab-separated text, which every spreadsheet pastes into cells. */
  const tsv = (rows) =>
    rows
      .map((row) =>
        row
          .map((v) => {
            const text =
              v === null
                ? ""
                : typeof v === "object"
                  ? v.error
                  : typeof v === "boolean"
                    ? v
                      ? "TRUE"
                      : "FALSE"
                    : String(v);
            return /[\t\n"]/.test(text)
              ? `"${text.replaceAll('"', '""')}"`
              : text;
          })
          .join("\t"),
      )
      .join("\n");
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = Object.assign(document.createElement("textarea"), {
        value: text,
      });
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
  };

  grid.addEventListener("keydown", (event) => {
    const p = view().pick;
    const step = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }[event.key];
    if (step) {
      event.preventDefault();
      const [r, c] = event.shiftKey ? [p.r2, p.c2] : [p.r1, p.c1];
      pickTo(r + step[0], c + step[1], event.shiftKey);
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "c") {
      event.preventDefault();
      const out = [];
      for (let r = Math.min(p.r1, p.r2); r <= Math.max(p.r1, p.r2); r++) {
        const row = [];
        for (let c = Math.min(p.c1, p.c2); c <= Math.max(p.c1, p.c2); c++)
          row.push(plainAt(r, c));
        out.push(row);
      }
      copy(tsv(out));
    } else if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault();
      view().pick = clampPick({
        r1: -1,
        c1: 0,
        r2: list.length,
        c2: sheet().columns.length,
      });
      paint();
    }
  });

  /* ── a column's sort and filter ─────────────────────────────────────────── */

  let open = null; // the column whose menu is open
  const closeMenu = () => {
    menu.hidden = true;
    table
      .querySelector('.ss-col[aria-expanded="true"]')
      ?.setAttribute("aria-expanded", "false");
    open = null;
  };
  const drawPicks = () => {
    const { rows, columns } = sheet();
    const kept = view().filters.get(open);
    const counts = new Map();
    for (const row of rows) {
      const text = shown(row[open]?.v ?? null, columns[open]);
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
    const word = find.value.trim().toLowerCase();
    const values = [...counts.keys()].sort(
      new Intl.Collator(undefined, { numeric: true }).compare,
    );
    picks.replaceChildren();
    for (const text of values.slice(0, 500)) {
      if (word && !text.toLowerCase().includes(word)) continue;
      const label = document.createElement("label");
      const box = Object.assign(document.createElement("input"), {
        type: "checkbox",
        checked: !kept || kept.has(text),
      });
      box.dataset.value = text;
      const name = document.createElement("span");
      name.textContent = text === "" ? "(empty)" : text;
      const count = document.createElement("small");
      count.textContent = counts.get(text).toLocaleString();
      label.append(box, name, count);
      picks.append(label);
    }
  };
  table.addEventListener("click", (event) => {
    const button = event.target.closest(".ss-col");
    if (!button) return;
    const c = Number(button.dataset.col);
    if (open === c) return closeMenu();
    closeMenu();
    open = c;
    button.setAttribute("aria-expanded", "true");
    const box = button.getBoundingClientRect();
    menu.hidden = false;
    menu.style.top = `${box.bottom + 4}px`;
    menu.style.left = `${Math.max(8, Math.min(box.left - 8, innerWidth - menu.offsetWidth - 8))}px`;
    const sort = view().sort;
    for (const one of menu.querySelectorAll("[data-sort]"))
      one.classList.toggle(
        "on",
        one.dataset.sort ===
          (sort?.c === c ? (sort.dir > 0 ? "up" : "down") : "none"),
      );
    find.value = "";
    drawPicks();
  });
  menu.addEventListener("click", (event) => {
    const sort = event.target.closest("[data-sort]")?.dataset.sort;
    if (sort) {
      view().sort =
        sort === "none" ? null : { c: open, dir: sort === "up" ? 1 : -1 };
      closeMenu();
      draw();
      return;
    }
    const pick = event.target.closest("[data-pick]")?.dataset.pick;
    if (pick) {
      if (pick === "all") view().filters.delete(open);
      const c = open;
      draw();
      open = c;
      drawPicks();
    }
  });
  menu.addEventListener("change", (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const { rows, columns } = sheet();
    const all = new Set(
      rows.map((row) => shown(row[open]?.v ?? null, columns[open])),
    );
    const kept = new Set(view().filters.get(open) ?? all);
    if (event.target.checked) kept.add(event.target.dataset.value);
    else kept.delete(event.target.dataset.value);
    if (kept.size === all.size) view().filters.delete(open);
    else view().filters.set(open, kept);
    const c = open;
    draw();
    open = c;
    table
      .querySelector(`.ss-col[data-col="${c}"]`)
      ?.setAttribute("aria-expanded", "true");
  });
  find.addEventListener("input", drawPicks);
  addEventListener("mousedown", (event) => {
    if (
      !menu.hidden &&
      !menu.contains(event.target) &&
      !event.target.closest(".ss-col")
    )
      closeMenu();
  });
  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) closeMenu();
  });

  /* ── tabs, and the sheet out as text ────────────────────────────────────── */

  book.sheets.forEach((one, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.textContent = one.name;
    button.addEventListener("click", () => {
      closeMenu();
      at = i;
      draw();
    });
    tabs.append(button);
  });
  tabs.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!step) return;
    at = (at + step + book.sheets.length) % book.sheets.length;
    draw();
    tabs.children[at].focus();
  });

  /** The sheet as written, every row: the header, the rows, the totals as the file has them. */
  const whole = () => {
    const { columns, rows, totals } = sheet();
    const all = rows.map((_, i) => i);
    const out = [
      columns.map((column) => column.name),
      ...rows.map((row) =>
        columns.map((column, c) => plain(row[c]?.v ?? null, column)),
      ),
    ];
    if (totals)
      out.push(
        columns.map((_, c) =>
          totals.cells[c]
            ? total(totals.cells[c], c, all)
            : c === 0
              ? totals.label
              : null,
        ),
      );
    return out;
  };
  document
    .querySelector("[data-copy-sheet]")
    ?.addEventListener("click", () => copy(tsv(whole())));
  document.querySelector("[data-csv]")?.addEventListener("click", () => {
    const csv = whole()
      .map((row) =>
        row
          .map((v) => {
            const text =
              v === null ? "" : typeof v === "object" ? v.error : String(v);
            return /[",\n]/.test(text)
              ? `"${text.replaceAll('"', '""')}"`
              : text;
          })
          .join(","),
      )
      .join("\r\n");
    // A byte-order mark, so Excel reads the file as UTF-8 and Korean or Japanese stays whole
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `${sheet().name}.csv`,
    });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  /* ── editing ────────────────────────────────────────────────────────────── */

  /** How each totals function is written into the .xlsx (spreadsheet.mjs TOTALS). */
  const TOTALS = { sum: 109, average: 101, count: 102, max: 104, min: 105 };
  /** How many changes Undo goes back through. */
  const UNDO_MOST = 100;
  const edits = window.shell?.edits;
  let editing = false;
  let typing = false; // the cell editor is open over a cell
  let typingAt = null; // { s, r, c } the cell it is open over, r in view (-1 the header)
  const undone = [];
  const redone = [];

  const editor = document.createElement("input");
  editor.className = "ss-edit";
  editor.spellcheck = false;
  editor.autocomplete = "off";
  editor.setAttribute("aria-label", "Cell");
  grid.append(editor);

  const say = (text, bad) => {
    note.textContent = text;
    note.classList.toggle("bad", Boolean(bad));
  };
  function closeNote() {
    if (!note.classList.contains("bad")) say("");
  }
  function focusGrid() {
    (editing ? editor : grid).focus({ preventScroll: true });
  }

  /** The whole book worked out again, as the .xlsx will hold it, and the columns' kind with it. */
  const recompute = () => {
    const sheets = book.sheets.map((one) => {
      const cells = [
        one.columns.map((column) => ({ v: column.name })),
        ...one.rows.map((row) =>
          one.columns.map((_, c) => {
            const x = row[c] ?? { v: null };
            return x.f !== undefined ? { f: x.f } : { v: x.v ?? null };
          }),
        ),
      ];
      if (one.totals) {
        const last = Math.max(2, one.rows.length + 1);
        cells.push(
          one.columns.map((_, c) => {
            const fn = one.totals.cells[c];
            if (fn)
              return {
                f: `=SUBTOTAL(${TOTALS[fn]},${colName(c)}2:${colName(c)}${last})`,
              };
            return { v: c === 0 ? one.totals.label : null };
          }),
        );
      }
      return { name: one.name, cells };
    });
    const problems = [];
    Formula.workOut(sheets, { problems });
    sheets.forEach((worked, s) => {
      const one = book.sheets[s];
      one.rows = worked.cells
        .slice(1, 1 + one.rows.length)
        .map((row) =>
          row.map((x) =>
            x.f !== undefined ? { v: x.v ?? null, f: x.f } : { v: x.v ?? null },
          ),
        );
      one.columns.forEach((column, c) => {
        const values = one.rows
          .map((row) => row[c]?.v ?? null)
          .filter((v) => v !== null);
        column.num =
          values.length > 0 &&
          values.filter(isNumber).length >= values.length / 2;
      });
    });
    return problems;
  };

  /** One change: kept for Undo, worked out, drawn, and handed to the app to keep. */
  const change = (fn, { resets } = {}) => {
    const before = JSON.stringify(book.sheets);
    const refused = fn();
    if (refused) {
      say(refused, true);
      return false;
    }
    undone.push(before);
    if (undone.length > UNDO_MOST) undone.shift();
    redone.length = 0;
    settle(resets);
    return true;
  };
  const settle = (resets) => {
    const problems = recompute();
    // A sort or filter names columns by their place, which a column put in or taken out moves
    if (resets) {
      view().sort = null;
      view().filters.clear();
    }
    draw();
    view().pick = clampPick(view().pick);
    paint();
    say(
      problems.length
        ? `${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}`
        : "",
      problems.length > 0,
    );
    edits?.changed();
  };
  const back = (from, to) => {
    if (!from.length) return;
    to.push(JSON.stringify(book.sheets));
    book.sheets = JSON.parse(from.pop());
    settle(true);
  };

  /** A cell's text to edit: its formula, or its value as typed. */
  const rawAt = (r, c) => {
    if (r === -1) return sheet().columns[c].name;
    const x = sheet().rows[list[r]]?.[c];
    if (!x) return "";
    if (x.f !== undefined) return x.f;
    const v = x.v ?? null;
    if (v === null) return "";
    if (typeof v === "object") return v.error;
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (isNumber(v) && isDateFormat(sheet().columns[c].format)) return isoOf(v);
    if (isNumber(v) && /%/.test(sheet().columns[c].format ?? ""))
      return `${Number((v * 100).toPrecision(12))}%`;
    return String(v);
  };

  /** What `text` puts in a cell, or why it cannot: a formula has to read. */
  const cellFrom = (text, column) => {
    const typed = String(text);
    if (typed.startsWith("=") && typed.trim().length > 1) {
      try {
        Formula.parse(typed.trim());
      } catch (failed) {
        return { refused: `${typed.trim()}: ${failed.message}` };
      }
      return { cell: { v: null, f: typed.trim() } };
    }
    return { cell: { v: valueOf(typed, column.format) } };
  };

  /** A column's name set, unless it is empty or another column has it. */
  const rename = (c, text) => {
    const name = String(text).trim();
    if (!name) return "A column needs a name.";
    const taken = sheet().columns.some(
      (column, i) =>
        i !== c && column.name.toLowerCase() === name.toLowerCase(),
    );
    if (taken) return `Another column is named "${name}".`;
    sheet().columns[c].name = name;
    return null;
  };

  /** Text put into the cell at (r, c) in view; a row past the last is a new one. */
  const putAt = (r, c, text) => {
    if (r === -1) return rename(c, text);
    const { cell: made, refused } = cellFrom(text, sheet().columns[c]);
    if (refused) return refused;
    while (r >= list.length) {
      addRow(sheet().rows.length);
      list.push(sheet().rows.length - 1);
    }
    sheet().rows[list[r]][c] = made;
    return null;
  };

  /** Every formula in the book moved as rows or columns of the sheet named move. */
  const moveAll = (axis, at, count) => {
    const target = sheet().name;
    for (const one of book.sheets)
      for (const row of one.rows)
        for (const x of row)
          if (x?.f !== undefined)
            x.f = Formula.moveRefs(x.f, {
              on: one.name,
              target,
              axis,
              at,
              count,
            });
  };

  /**
   * A row put in at `i` (a row's index in the sheet), the formulas moved round it; a column
   * the row next to it works out by formula is worked out the same way in the new one.
   */
  const addRow = (i) => {
    const { rows, columns } = sheet();
    moveAll("r", i + 1, 1);
    const [near, step] = i > 0 ? [rows[i - 1], 1] : [rows[i], -1];
    rows.splice(
      i,
      0,
      columns.map((_, c) =>
        near?.[c]?.f !== undefined
          ? { v: null, f: Formula.fillDown(near[c].f, step) }
          : { v: null },
      ),
    );
  };

  const picked = () => {
    const p = view().pick;
    return {
      top: Math.min(p.r1, p.r2),
      bottom: Math.max(p.r1, p.r2),
      left: Math.min(p.c1, p.c2),
      right: Math.max(p.c1, p.c2),
    };
  };

  const act = {
    row() {
      const { bottom } = picked();
      const i = bottom === -1 ? 0 : list[bottom] + 1;
      const done = change(() => addRow(i));
      if (done) {
        const r = list.indexOf(i);
        if (r !== -1) pickTo(r, view().pick.c1);
      }
    },
    unrow() {
      const { top, bottom } = picked();
      const gone = [];
      for (let r = Math.max(0, top); r <= bottom; r++) gone.push(list[r]);
      if (!gone.length) return say("Pick the rows to take out.", true);
      change(() => {
        for (const i of gone.sort((a, b) => b - a)) {
          moveAll("r", i + 1, -1);
          sheet().rows.splice(i, 1);
        }
      });
    },
    col() {
      const c = picked().right + 1;
      let n = sheet().columns.length + 1;
      const names = new Set(
        sheet().columns.map((one) => one.name.toLowerCase()),
      );
      while (names.has(`column ${n}`.toLowerCase())) n++;
      const done = change(
        () => {
          moveAll("c", c, 1);
          const { columns, rows, totals } = sheet();
          columns.splice(c, 0, {
            name: `Column ${n}`,
            format: null,
            num: false,
            width: 12,
          });
          for (const row of rows) row.splice(c, 0, { v: null });
          totals?.cells.splice(c, 0, null);
        },
        { resets: true },
      );
      if (done) {
        pickTo(-1, c);
        openEditor(rawAt(-1, c));
        // Its made-up name picked, so the first key names it
        editor.select();
      }
    },
    uncol() {
      const { left, right } = picked();
      const { columns, totals } = sheet();
      if (right - left + 1 >= columns.length)
        return say("A sheet keeps one column at least.", true);
      if (left === 0 && totals?.cells[right + 1])
        return say(
          "The first column holds the totals' label, and the next one is totalled.",
          true,
        );
      change(
        () => {
          for (let c = right; c >= left; c--) {
            moveAll("c", c, -1);
            sheet().columns.splice(c, 1);
            for (const row of sheet().rows) row.splice(c, 1);
            totals?.cells.splice(c, 1);
          }
        },
        { resets: true },
      );
    },
    undo: () => back(undone, redone),
    redo: () => back(redone, undone),
  };
  tools.addEventListener("click", (event) => {
    const what = event.target.closest("[data-do]")?.dataset.do;
    if (!what) return;
    if (typing) finish(true);
    act[what]();
    focusGrid();
  });

  const drawFormat = () => {
    const code = sheet().columns[view().pick.c1]?.format || "General";
    let option = [...formatPick.options].find((one) => one.value === code);
    if (!option) {
      formatPick.querySelector("[data-own]")?.remove();
      option = new Option(
        formatValue(
          isDateFormat(code) ? serialOf("2026-07-02") : -1234.5,
          code,
        ),
        code,
      );
      option.dataset.own = "";
      formatPick.append(option);
    }
    formatPick.value = code;
  };
  formatPick.addEventListener("change", () => {
    const { left, right } = picked();
    const code = formatPick.value === "General" ? null : formatPick.value;
    change(() => {
      for (let c = left; c <= right; c++) {
        sheet().columns[c].format = code;
        // Made a column of dates: the dates written in it as text become dates
        if (!isDateFormat(code)) continue;
        for (const row of sheet().rows) {
          const v = row[c]?.v;
          if (
            typeof v === "string" &&
            row[c].f === undefined &&
            serialOf(v) !== null
          )
            row[c] = { v: serialOf(v) };
        }
      }
    });
    focusGrid();
  });

  /** The editor over the ring's cell, drawn where the cell is, or out of the way when closed. */
  const place = () => {
    if (!editing) return;
    const at = typingAt ?? { r: view().pick.r1, c: view().pick.c1 };
    const td = table.querySelector(`[data-r="${at.r}"][data-c="${at.c}"]`);
    if (!td) return;
    const g = grid.getBoundingClientRect();
    const b = td.getBoundingClientRect();
    editor.style.left = `${b.left - g.left + grid.scrollLeft}px`;
    editor.style.top = `${b.top - g.top + grid.scrollTop}px`;
    editor.dataset.base = String(Math.max(b.width, 80));
    editor.style.width = `${editor.dataset.base}px`;
    editor.style.height = `${b.height}px`;
    grow();
  };
  /** The editor as wide as what is typed in it, as Excel's is, up to the grid's right edge. */
  const grow = () => {
    if (!typing) return;
    const room = grid.scrollLeft + grid.clientWidth - editor.offsetLeft - 4;
    const base = Number(editor.dataset.base) || 80;
    editor.style.width = `${base}px`;
    editor.style.width = `${Math.max(base, Math.min(room, editor.scrollWidth + 2))}px`;
  };

  /** The editor opened on the ring's cell, holding `text` (null keeps what was just typed). */
  function openEditor(text) {
    const p = view().pick;
    if (p.r1 === -1 && sheet().columns[p.c1] === undefined) return;
    typing = true;
    typingAt = { s: at, r: p.r1, c: p.c1 };
    if (text !== null) editor.value = text;
    editor.classList.add("open");
    place();
    editor.focus({ preventScroll: true });
    formula.value = editor.value;
  }
  /** The editor closed: what it holds kept, or let go. False when it could not be kept. */
  function finish(keep) {
    if (!typing) return true;
    const where = typingAt;
    const text = editor.value;
    typing = false;
    typingAt = null;
    editor.classList.remove("open");
    editor.value = "";
    if (keep && where.s === at && text !== rawAt(where.r, where.c)) {
      const done = change(() => putAt(where.r, where.c, text));
      if (!done) {
        // Back to what was being typed, so a formula that does not read is put right, not lost
        typing = true;
        typingAt = where;
        editor.value = text;
        editor.classList.add("open");
        place();
        editor.focus({ preventScroll: true });
        return false;
      }
    } else paint();
    return true;
  }

  const clearPicked = () => {
    const { top, bottom, left, right } = picked();
    change(() => {
      for (let r = Math.max(0, top); r <= bottom; r++)
        for (let c = left; c <= right; c++)
          sheet().rows[list[r]][c] = { v: null };
    });
  };

  /** Tab-separated text read into rows of cells, as a spreadsheet copies them. */
  const readTsv = (text) => {
    const rows = [[]];
    let cellText = "";
    let quoted = false;
    const body = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (quoted) {
        if (ch === '"' && body[i + 1] === '"') {
          cellText += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cellText += ch;
      } else if (ch === '"' && cellText === "") quoted = true;
      else if (ch === "\t") {
        rows.at(-1).push(cellText);
        cellText = "";
      } else if (ch === "\n") {
        rows.at(-1).push(cellText);
        cellText = "";
        rows.push([]);
      } else cellText += ch;
    }
    rows.at(-1).push(cellText);
    return rows;
  };
  editor.addEventListener("paste", (event) => {
    if (typing) return;
    event.preventDefault();
    const rows = readTsv(event.clipboardData?.getData("text/plain") ?? "");
    const { top, left } = picked();
    const width = sheet().columns.length;
    let cut = 0;
    const done = change(() => {
      for (let i = 0; i < rows.length; i++)
        for (let j = 0; j < rows[i].length; j++) {
          if (left + j >= width) {
            cut = Math.max(cut, left + j - width + 1);
            continue;
          }
          const refused = putAt(top + i, left + j, rows[i][j]);
          if (refused) return refused;
        }
    });
    if (done && cut)
      say(
        `${cut} column${cut > 1 ? "s" : ""} past the last were left out; add columns first.`,
        true,
      );
  });

  editor.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    const mod = event.metaKey || event.ctrlKey;
    if (typing) {
      event.stopPropagation();
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const { r, c } = typingAt;
        if (!finish(true)) return;
        const back = event.shiftKey ? -1 : 1;
        if (event.key === "Enter") pickTo(r + back, c);
        else pickTo(r, c + back);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
      return;
    }
    const p = view().pick;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      act[event.shiftKey ? "redo" : "undo"]();
    } else if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      act.redo();
    } else if (event.key === "F2") {
      event.preventDefault();
      openEditor(rawAt(p.r1, p.c1));
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const back = event.shiftKey ? -1 : 1;
      if (event.key === "Enter") pickTo(p.r1 + back, p.c1);
      else pickTo(p.r1, p.c1 + back);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      clearPicked();
    }
    // The rest reaches the grid: arrows, copy, select all
  });
  // A key that types opens the editor with what it typed, a word being composed too
  editor.addEventListener("input", () => {
    if (!typing) openEditor(null);
    else formula.value = editor.value;
    grow();
    showRefs(editor.value);
  });
  editor.addEventListener("compositionstart", () => {
    if (!typing) openEditor(null);
  });
  editor.addEventListener("blur", () => {
    if (!typing) return;
    // The formula line takes over what was being typed
    requestAnimationFrame(() => {
      if (typing && document.activeElement !== formula) finish(true);
    });
  });
  table.addEventListener("dblclick", (event) => {
    if (!editing) return;
    const el = event.target.closest("[data-r]");
    if (!el || ["L", "T"].includes(el.dataset.r) || Number(el.dataset.c) === -1)
      return;
    openEditor(rawAt(Number(el.dataset.r), Number(el.dataset.c)));
  });

  // The formula line edits the ring's cell as well
  formula.addEventListener("focus", () => {
    // Typed into, the line shows its own text
    fxBox.classList.remove("colored");
    if (!editing || typing) return;
    openEditor(rawAt(view().pick.r1, view().pick.c1));
    formula.focus();
  });
  formula.addEventListener("input", () => {
    if (typing) editor.value = formula.value;
    grow();
    showRefs(formula.value);
  });
  formula.addEventListener("keydown", (event) => {
    if (!typing || event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      const { r, c } = typingAt;
      if (finish(true)) pickTo(r + 1, c);
      focusGrid();
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
      focusGrid();
    }
  });
  formula.addEventListener("blur", () => {
    requestAnimationFrame(() => {
      if (typing && document.activeElement !== editor) finish(true);
    });
  });

  edits?.onToggle((on) => {
    if (!on) finish(true);
    editing = on;
    tools.hidden = !on;
    formula.readOnly = !on;
    grid.classList.toggle("editing", on);
    editor.hidden = !on;
    if (on) {
      drawFormat();
      place();
    }
    focusGrid();
  });
  editor.hidden = true;

  // The page as a file again: without the grid this session drew, the workbook as it now is
  window.shell.clean = (copy) => {
    const data = copy.querySelector("#sheet-data");
    if (data)
      data.textContent = JSON.stringify(book).replaceAll("<", "\\u003c");
    copy.querySelector(".ss-edit")?.remove();
    copy.querySelector("#tools")?.setAttribute("hidden", "");
    copy.querySelector("#formula")?.setAttribute("readonly", "");
    copy.querySelector("#grid")?.classList.remove("editing");
    copy.querySelector("#note")?.replaceChildren();
    copy.querySelector("#fx-show")?.replaceChildren();
    copy.querySelector("#fx-box")?.classList.remove("colored");
    copy.querySelector("#table")?.replaceChildren();
    copy.querySelector("#table")?.removeAttribute("style");
    copy.querySelector("#tabs")?.replaceChildren();
    copy.querySelector("#stat")?.replaceChildren();
    copy.querySelector("#menu")?.setAttribute("hidden", "");
    for (const id of ["ref", "size"]) {
      const el = copy.querySelector(`#${id}`);
      if (el) el.textContent = "";
    }
  };

  draw();
  view().pick = clampPick({ r1: 0, c1: 0, r2: 0, c2: 0 });
  paint();
})();
