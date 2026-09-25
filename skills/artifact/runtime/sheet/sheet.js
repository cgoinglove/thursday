// What a sheet does in the page: its tabs, cells picked with the mouse or the arrow keys (the
// formula line shows the one the ring is on, the foot the sum of the rest), a column sorted or
// filtered from its heading, the totals worked out again over the rows in view, and the sheet
// copied or saved as CSV. Nothing here changes the workbook: sorting and filtering are a view,
// and the .xlsx beside the page is the file.
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
  const plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

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
    for (const column of columns) {
      const col = document.createElement("col");
      col.style.width = `${Math.round(Math.max(4, column.width) * 7.2 + 18)}px`;
      widths.append(col);
    }

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
        tr.append(
          cell(
            "td",
            shown(v, column),
            error ? "err" : isNumber(v) ? "num" : "",
            r,
            c,
          ),
        );
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
        tr.append(
          cell(
            "td",
            fn ? shown(v, fn === "count" ? null : column) : (v ?? ""),
            fn ? "num" : "",
            "T",
            c,
          ),
        );
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
    const v = valueAt(p.r1, p.c1);
    formula.textContent =
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
        part("Sum", plain.format(sum));
        part("Average", plain.format(sum / numbers.length));
      }
      part("Count", filled.toLocaleString());
    }
  };

  const pickTo = (r, c, extend) => {
    const p = view().pick;
    view().pick = clampPick(
      extend ? { ...p, r2: r, c2: c } : { r1: r, c1: c, r2: r, c2: c },
    );
    paint();
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
    grid.focus({ preventScroll: true });
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
          row.push(valueAt(r, c));
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
      ...rows.map((row) => columns.map((_, c) => row[c]?.v ?? null)),
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

  // The page as a file again: without the grid this session drew
  window.shell.clean = (copy) => {
    copy.querySelector("#table")?.replaceChildren();
    copy.querySelector("#tabs")?.replaceChildren();
    copy.querySelector("#stat")?.replaceChildren();
    copy.querySelector("#menu")?.setAttribute("hidden", "");
    for (const id of ["ref", "formula", "size"]) {
      const el = copy.querySelector(`#${id}`);
      if (el) el.textContent = "";
    }
  };

  draw();
  view().pick = clampPick({ r1: 0, c1: 0, r2: 0, c2: 0 });
  paint();
})();
