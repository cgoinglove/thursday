// What a document does for itself once it is written: an address on every heading, its
// contents in the pane beside it, its tabs — and, when the reader asks, an editor: the
// paper becomes editable in place, a block gets a handle, a selection gets its
// formatting. What changes is kept by the app when the app is showing the page (the
// shell asks it), and as a downloaded copy when nothing is. Nothing here is content: a
// page runs this and shows no change.
(() => {
  const paper = document.getElementById("paper");
  const toc = document.getElementById("toc");
  const tocButton = document.querySelector("[data-toc]");
  const editButton = document.querySelector("[data-edit]");
  const grip = document.getElementById("grip");
  const bubble = document.getElementById("bubble");
  const tableBar = document.getElementById("table-bar");
  const blockMenu = document.getElementById("block-menu");
  const insertMenu = document.getElementById("insert-menu");
  if (!paper) return;

  /* ── headings, contents, tabs ────────────────────────────────────────────── */

  const slug = (text) =>
    text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "");

  /** The document's spine: headings in a tab panel, a card or a note are not on it. */
  const spine = () =>
    [...paper.querySelectorAll("h2, h3")].filter(
      (heading) => !heading.closest(".tabs, .card, .note, nav"),
    );

  /** Every heading an address of its own; one that already has one keeps it. */
  const address = () => {
    const taken = new Set();
    for (const heading of paper.querySelectorAll("h2, h3")) {
      if (!heading.id || taken.has(heading.id)) {
        const base = slug(heading.textContent) || "section";
        let id = base;
        for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
        heading.id = id;
      }
      taken.add(heading.id);
    }
  };

  let reading = ""; // the section the pane marks, kept across a rebuild
  let drawn = null; // the headings the pane was last drawn from

  /**
   * The contents, in the pane: h2s as the list, each with its h3s under it. Drawn again
   * only when the headings changed: any change to the page while someone types ends the
   * browser's run of typing, and ⌘Z would then take a word back a letter at a time.
   */
  const contents = () => {
    address();
    const headings = spine();
    const now = headings
      .map((h) => `${h.tagName} ${h.id} ${h.textContent}`)
      .join("\n");
    if (now === drawn) return;
    drawn = now;
    const none = headings.filter((h) => h.tagName === "H2").length < 2;
    document.body.classList.toggle("pg-no-toc", none);
    if (tocButton) tocButton.hidden = none;
    const head = document.createElement("p");
    head.className = "sh-pane-h";
    head.textContent = "On this page";
    const list = document.createElement("ol");
    let last = null;
    for (const heading of headings) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;
      link.classList.toggle("pg-on", heading.id === reading);
      item.append(link);
      if (heading.tagName === "H2") {
        list.append(item);
        last = item;
      } else if (last) {
        const sub = last.querySelector("ol") ?? document.createElement("ol");
        sub.append(item);
        last.append(sub);
      }
    }
    toc.replaceChildren(head, list);
    // A page written before the pane carried its own contents box; the pane is that box now
    for (const old of paper.querySelectorAll("nav.contents")) old.remove();
  };

  /** Which section is being read, as the pane marks it. */
  const watch = new IntersectionObserver(
    (entries) => {
      const seen = entries.filter((e) => e.isIntersecting).map((e) => e.target);
      if (!seen.length) return;
      reading = seen.sort((a, b) => a.offsetTop - b.offsetTop)[0].id;
      for (const link of toc.querySelectorAll("a"))
        link.classList.toggle(
          "pg-on",
          link.getAttribute("href") === `#${reading}`,
        );
    },
    { rootMargin: "-10% 0px -70% 0px" },
  );
  const spy = () => {
    watch.disconnect();
    for (const heading of spine()) watch.observe(heading);
  };

  // The button puts the pane away on a wide screen, where it stands open, and brings it
  // over the page on a narrow one, where it is away
  const narrow = matchMedia("(max-width: 900px)");
  tocButton?.addEventListener("click", () => {
    document.body.classList.toggle(
      narrow.matches ? "pg-toc-open" : "pg-toc-shut",
    );
  });
  toc.addEventListener("click", (event) => {
    if (narrow.matches && event.target.closest("a"))
      document.body.classList.remove("pg-toc-open");
  });

  // Tabs: a `.tabs` block whose children are <section data-tab="Name">. One is shown at
  // a time; printing shows them all, one under another, so nothing is lost on paper. A
  // press is heard on the paper, so a block copied in the editor switches as its source does.
  const pickTab = (tabs, n) => {
    const bar = tabs.querySelector(':scope > [role="tablist"]');
    [...tabs.querySelectorAll(":scope > [data-tab]")].forEach((panel, i) => {
      panel.hidden = i !== n;
      bar?.children[i]?.setAttribute("aria-selected", String(i === n));
    });
  };
  for (const tabs of paper.querySelectorAll(".tabs")) {
    const panels = [...tabs.querySelectorAll(":scope > [data-tab]")];
    if (panels.length < 2) continue;
    const bar = document.createElement("div");
    bar.setAttribute("role", "tablist");
    bar.contentEditable = "false";
    for (const panel of panels) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.textContent = panel.dataset.tab;
      bar.append(tab);
      panel.setAttribute("role", "tabpanel");
    }
    tabs.prepend(bar);
    pickTab(tabs, 0);
  }
  paper.addEventListener("click", (event) => {
    const tab = event.target.closest?.(
      '.tabs > [role="tablist"] > [role="tab"]',
    );
    if (tab)
      pickTab(tab.closest(".tabs"), [...tab.parentNode.children].indexOf(tab));
  });

  contents();
  spy();

  /* ── keeping it (shell.edits) ────────────────────────────────────────────── */

  const changed = () => shell.edits.changed();

  // The marks a bot's put writes between (runtime/shell put.mjs), as the page was opened
  // with them. Clearing the whole paper takes them too; the kept file carries them still.
  const marks = [...paper.childNodes].filter(
    (node) =>
      node.nodeType === Node.COMMENT_NODE &&
      /^ put: (start|end)\b/.test(node.data),
  );
  const [startMark, endMark] = marks.map((node) => node.data);

  /** The file as it should be kept: the page without anything the reader's session put on it. */
  shell.clean = (copy) => {
    copy
      .querySelector("body")
      ?.classList.remove(
        "pg-editing",
        "pg-toc-open",
        "pg-toc-shut",
        "pg-no-toc",
      );
    for (const el of copy.querySelectorAll("#paper, #paper [contenteditable]"))
      el.removeAttribute("contenteditable");
    // What the browser's own editing leaves behind when it takes a style back off
    for (const el of copy.querySelectorAll('#paper [style=""]'))
      el.removeAttribute("style");
    copy.querySelector("#toc")?.replaceChildren();
    copy.querySelector("[data-toc]")?.setAttribute("hidden", "");
    for (const id of [
      "grip",
      "bubble",
      "table-bar",
      "block-menu",
      "insert-menu",
    ]) {
      const el = copy.querySelector(`#${id}`);
      el?.setAttribute("hidden", "");
      el?.removeAttribute("style");
    }
    for (const el of copy.querySelectorAll(".pg-hot"))
      el.classList.remove("pg-hot");
    for (const tabs of copy.querySelectorAll(".tabs")) {
      tabs.querySelector('[role="tablist"]')?.remove();
      for (const panel of tabs.querySelectorAll("[role=tabpanel]")) {
        panel.removeAttribute("hidden");
        panel.removeAttribute("role");
      }
    }
    const kept = copy.querySelector("#paper");
    const has = (data) =>
      [...(kept?.childNodes ?? [])].some(
        (node) => node.nodeType === Node.COMMENT_NODE && node.data === data,
      );
    if (kept && startMark && endMark && !(has(startMark) && has(endMark))) {
      for (const node of [...kept.childNodes])
        if (node.nodeType === Node.COMMENT_NODE && /^ put: /.test(node.data))
          node.remove();
      kept.prepend(document.createComment(startMark));
      kept.append(document.createComment(endMark));
    }
  };

  // A tick is a change like any other: the box's state is written onto it, since only
  // what is in the markup survives into the file
  paper.addEventListener("change", (event) => {
    const box = event.target;
    if (!(box instanceof HTMLInputElement) || box.type !== "checkbox") return;
    box.toggleAttribute("checked", box.checked);
    changed();
  });

  /* ── the editor ──────────────────────────────────────────────────────────── */

  if (!editButton) return;
  let block = null; // the block under the handle
  let placed = null; // what the editor itself selected in a block it just made

  let open = null; // the chip whose own words are being written

  /**
   * A checkbox and a chip are one piece each among the words: the caret passes them and
   * Backspace takes them whole, and a checkbox stays something to tick. A chip's own
   * words open with a press (below).
   */
  const seal = () => {
    for (const el of paper.querySelectorAll('input[type="checkbox"], .chip'))
      if (el !== open) el.contentEditable = "false";
  };

  /** The open chip is one piece again; one left without words goes. */
  const shut = () => {
    const chip = open;
    open = null;
    if (!chip?.isConnected) return;
    chip.contentEditable = "false";
    if (!chip.textContent.trim()) {
      chip.remove();
      changed();
    }
  };

  shell.edits.onToggle((on) => {
    document.body.classList.toggle("pg-editing", on);
    paper.contentEditable = on ? "true" : "false";
    seal();
    if (on) return;
    shut();
    hideAll();
    contents();
    spy();
  });

  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && shell.edits.on) hideAll();
  });

  paper.addEventListener("input", () => {
    if (!shell.edits.on) return;
    seal(); // a chip pasted in joins the others
    changed();
    contents();
  });

  // A chip opens where it is pressed, as a field of its own: the browser puts the caret
  // there, and clearing it stays inside the chip. It closes on a press anywhere else, when
  // the caret leaves it (selectionchange, below), or on Enter or Esc with the caret just
  // past it.
  addEventListener("pointerdown", (event) => {
    const chip = shell.edits.on && event.target.closest?.("#paper .chip");
    if (chip === open) return;
    shut();
    if (!chip) return;
    open = chip;
    chip.contentEditable = "true";
  });
  paper.addEventListener("keydown", (event) => {
    if (!open || event.isComposing) return; // mid-composition, a key finishes a character
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      // All is the chip's words while it is open; the browser would take the whole page
      event.preventDefault();
      getSelection().selectAllChildren(open);
      return;
    }
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation(); // one Esc closes the chip and nothing else
    const chip = open;
    shut();
    if (!chip.isConnected) return;
    const past = document.createRange();
    past.setStartAfter(chip);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(past);
  });

  /* ── Tab, and what is pasted ─────────────────────────────────────────────── */

  const caretIn = () => {
    const at = getSelection()?.anchorNode;
    const el = at instanceof Element ? at : at?.parentElement;
    return el && paper.contains(el) ? el : null;
  };
  const selectAll = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  };

  // In a table Tab walks the cells and, past the last one, starts a row; in a list it
  // indents the item. Anywhere else it leaves the page, as Tab does.
  paper.addEventListener("keydown", (event) => {
    if (!shell.edits.on || event.key !== "Tab") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const el = caretIn();
    const cell = el?.closest("td, th");
    if (cell) {
      event.preventDefault();
      const cells = [...cell.closest("table").querySelectorAll("td, th")];
      const to = cells[cells.indexOf(cell) + (event.shiftKey ? -1 : 1)];
      if (to) return selectAll(to);
      if (event.shiftKey) return;
      const row = cell.closest("tr");
      const fresh = row.cloneNode(true);
      for (const one of fresh.children) {
        one.replaceChildren();
        one.removeAttribute("class");
      }
      moveBlock(fresh, () => row.after(fresh));
      return selectAll(fresh.firstElementChild);
    }
    if (el?.closest("li")) {
      event.preventDefault();
      document.execCommand(event.shiftKey ? "outdent" : "indent");
    }
  });

  /** What pasted words may bring with them: the shape of a document, never another page's look. */
  const KEEP = {
    P: "p",
    H1: "h2",
    H2: "h2",
    H3: "h3",
    H4: "h3",
    H5: "h3",
    H6: "h3",
    UL: "ul",
    OL: "ol",
    LI: "li",
    BLOCKQUOTE: "blockquote",
    PRE: "pre",
    HR: "hr",
    BR: "br",
    TABLE: "table",
    THEAD: "thead",
    TBODY: "tbody",
    TR: "tr",
    TH: "th",
    TD: "td",
    A: "a",
    B: "b",
    STRONG: "b",
    I: "i",
    EM: "i",
    U: "u",
    S: "s",
    CODE: "code",
    SPAN: "span",
    INPUT: "input",
  };
  /** What holds no words of its own to keep: it goes whole. */
  const DROP = new Set([
    "SCRIPT",
    "STYLE",
    "LINK",
    "META",
    "TITLE",
    "TEMPLATE",
    "NOSCRIPT",
    "IMG",
    "PICTURE",
    "SVG",
    "VIDEO",
    "AUDIO",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "CANVAS",
    "BUTTON",
    "SELECT",
    "TEXTAREA",
    "FORM",
  ]);
  /** A box a page lays out with: its words become a paragraph, unless it holds blocks. */
  const BOXES = new Set([
    "DIV",
    "SECTION",
    "ARTICLE",
    "MAIN",
    "HEADER",
    "FOOTER",
    "ASIDE",
    "NAV",
    "FIGURE",
    "FIGCAPTION",
    "DETAILS",
    "SUMMARY",
    "DL",
    "DT",
    "DD",
    "ADDRESS",
    "CENTER",
  ]);
  const BLOCKS =
    "p, h1, h2, h3, h4, h5, h6, ul, ol, li, table, blockquote, pre, hr, div, section, article";

  const tidy = (from, into, own) => {
    for (const node of [...from.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) {
        into.append(node.data);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || DROP.has(node.tagName))
        continue;
      const tag = KEEP[node.tagName];
      const classes = [...node.classList].filter((name) => own.has(name));
      if (!tag || (tag === "span" && !classes.length)) {
        // A wrapper: its words stay where they are, a box's as a paragraph of their own
        const box = BOXES.has(node.tagName) && !node.querySelector(BLOCKS);
        if (box && node.textContent.trim())
          tidy(node, into.appendChild(document.createElement("p")), own);
        else tidy(node, into, own);
        continue;
      }
      if (tag === "input" && node.getAttribute("type") !== "checkbox") continue;
      const made = document.createElement(tag);
      const href = node.getAttribute("href");
      if (tag === "a" && href && /^(https?:|mailto:|#)/i.test(href))
        made.setAttribute("href", href);
      if (tag === "input") {
        made.type = "checkbox";
        made.toggleAttribute("checked", node.hasAttribute("checked"));
      }
      for (const name of ["colspan", "rowspan", "data-tab"])
        if (node.hasAttribute(name))
          made.setAttribute(name, node.getAttribute(name));
      if (classes.length) made.className = classes.join(" ");
      tidy(node, made, own);
      into.append(made);
    }
    return into;
  };

  // A paste keeps words, links, lists and tables, and the document's own classes — a chip
  // copied from this page is still a chip — and leaves another page's look and pictures
  // behind: a picture from the web would need the network the page opens without.
  paper.addEventListener("paste", (event) => {
    if (!shell.edits.on) return;
    const html = event.clipboardData?.getData("text/html");
    if (!html) return;
    event.preventDefault();
    const own = new Set(
      [...paper.querySelectorAll("[class]")]
        .flatMap((el) => [...el.classList])
        .filter((name) => !/^(pg|sh)-/.test(name)),
    );
    const came = new DOMParser().parseFromString(html, "text/html").body;
    const kept = tidy(came, document.createElement("div"), own);
    document.execCommand("insertHTML", false, kept.innerHTML);
  });

  /** The block `node` sits in: one of the paper's own children. */
  const blockOf = (node) => {
    const el = node instanceof Element ? node : node?.parentElement;
    return el?.closest("#paper > *") ?? null;
  };

  /** Puts a floating piece at page coordinates, kept inside the window's width. */
  const place = (el, x, y) => {
    el.hidden = false;
    const most = document.documentElement.clientWidth - el.offsetWidth - 4;
    el.style.left = `${Math.max(4, Math.min(x, most))}px`;
    el.style.top = `${Math.max(4, y)}px`;
  };

  const hideAll = () => {
    grip.hidden = true;
    bubble.hidden = true;
    if (tableBar) tableBar.hidden = true;
    blockMenu.hidden = true;
    insertMenu.hidden = true;
    closeSlash();
    for (const el of paper.querySelectorAll(".pg-hot"))
      el.classList.remove("pg-hot");
    block = null;
  };

  paper.addEventListener("pointermove", (event) => {
    if (!shell.edits.on || !blockMenu.hidden || !insertMenu.hidden) return;
    const here = blockOf(event.target);
    if (!here || here === block) return;
    for (const el of paper.querySelectorAll(".pg-hot"))
      el.classList.remove("pg-hot");
    block = here;
    block.classList.add("pg-hot");
    const box = block.getBoundingClientRect();
    place(grip, box.left + scrollX - 64, box.top + scrollY - 2);
  });

  const openMenu = (menu, near) => {
    const box = near.getBoundingClientRect();
    blockMenu.hidden = true;
    insertMenu.hidden = true;
    bubble.hidden = true;
    place(menu, box.left + scrollX, box.bottom + scrollY + 4);
  };
  grip
    .querySelector("[data-block-menu]")
    .addEventListener("click", (event) =>
      openMenu(blockMenu, event.currentTarget),
    );
  grip
    .querySelector("[data-insert-menu]")
    .addEventListener("click", (event) =>
      openMenu(insertMenu, event.currentTarget),
    );
  addEventListener("pointerdown", (event) => {
    if (
      event.target.closest(
        "#grip, #block-menu, #insert-menu, #bubble, #table-bar",
      )
    )
      return;
    blockMenu.hidden = true;
    insertMenu.hidden = true;
    closeSlash();
  });

  /* ── taking a block's move back ──────────────────────────────────────────── */

  // A block moved, copied, deleted or put in is the editor's doing, not the browser's, so
  // the browser's own undo knows nothing of it. Each one is kept here as where its node
  // was and where it went. ⌘Z takes the last one back when the paper stands as that move
  // left it, which is after the typing done since has been taken back — the browser's
  // undo and this one walk back through the same history, each in its turn.
  const done = [];
  const undone = [];

  /** The paper as it reads, without what the editor puts on it for a moment. */
  const shape = () => {
    const copy = paper.cloneNode(true);
    for (const el of copy.querySelectorAll("*")) {
      el.classList.remove("pg-hot");
      if (!el.classList.length) el.removeAttribute("class");
      el.removeAttribute("contenteditable");
    }
    return copy.innerHTML;
  };
  const whereIs = (node) =>
    node.parentNode
      ? { parent: node.parentNode, next: node.nextSibling }
      : null;
  const putAt = (node, at) => {
    if (!at) node.remove();
    else at.parent.insertBefore(node, at.next);
  };
  const settled = () => {
    seal();
    hideAll();
    changed();
    contents();
    spy();
  };

  /** Does `move` to `node`, and keeps it to be taken back. */
  const moveBlock = (node, move) => {
    const before = shape();
    const from = whereIs(node);
    move();
    const to = whereIs(node);
    settled();
    done.push({ node, from, to, before, after: shape() });
    undone.length = 0;
  };

  /** Where the caret stands in `node`: its cell when `node` is a table, else only that it is there. */
  const spotIn = (node) => {
    const cell = caretIn()?.closest("td, th");
    if (!caretIn() || !node.contains(caretIn())) return null;
    if (!cell || !node.contains(cell)) return { end: true };
    return { r: [...node.rows].indexOf(cell.closest("tr")), c: cell.cellIndex };
  };
  /** The caret into `node` at `spot`: the same cell, or the nearest there is; else its end. */
  const caretTo = (node, spot) => {
    if (!spot) return;
    const rows = node.rows ? [...node.rows] : [];
    const row = rows[Math.min(spot.r ?? 0, rows.length - 1)];
    const into = spot.end
      ? node
      : (row?.cells[Math.min(spot.c, row.cells.length - 1)] ?? node);
    const range = document.createRange();
    range.selectNodeContents(into);
    range.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  };

  /** Puts `fresh` where `old` stands — a table with a column more — and keeps it to be taken back. */
  const swapBlock = (old, fresh) => {
    const before = shape();
    old.replaceWith(fresh);
    settled();
    done.push({ node: fresh, old, before, after: shape() });
    undone.length = 0;
  };

  addEventListener("keydown", (event) => {
    if (!shell.edits.on || !(event.metaKey || event.ctrlKey) || event.altKey)
      return;
    const key = event.key.toLowerCase();
    const again = (key === "z" && event.shiftKey) || key === "y";
    if (key !== "z" && !again) return;
    const last = (again ? undone : done).at(-1);
    if (!last || shape() !== (again ? last.before : last.after)) return;
    event.preventDefault();
    (again ? undone : done).pop();
    (again ? done : undone).push(last);
    if (last.old) {
      const [gone, back] = again
        ? [last.old, last.node]
        : [last.node, last.old];
      const spot = spotIn(gone);
      gone.replaceWith(back);
      settled();
      return caretTo(back, spot);
    }
    putAt(last.node, again ? last.to : last.from);
    settled();
  });
  paper.addEventListener("input", (event) => {
    if (!event.inputType?.startsWith("history")) undone.length = 0;
  });

  /** Where a new block goes when no block is under the handle: last, inside the marks. */
  const lastPlace = () => {
    const end = [...paper.childNodes].find(
      (node) => node.nodeType === Node.COMMENT_NODE && node.data === endMark,
    );
    return { parent: paper, next: end ?? null };
  };

  for (const button of blockMenu.querySelectorAll("[data-block]"))
    button.addEventListener("click", () => {
      if (!block) return;
      const one = block;
      const how = button.dataset.block;
      if (how === "up" && one.previousElementSibling)
        moveBlock(one, () => one.previousElementSibling.before(one));
      else if (how === "down" && one.nextElementSibling)
        moveBlock(one, () => one.nextElementSibling.after(one));
      else if (how === "dup") {
        const copy = one.cloneNode(true);
        moveBlock(copy, () => one.after(copy));
      } else if (how === "delete") moveBlock(one, () => one.remove());
      else hideAll();
    });

  /** What the Insert menu makes: each a block to start typing into. */
  const make = (kind) => {
    const html = {
      h2: "<h2>Heading</h2>",
      p: "<p>Text</p>",
      ul: "<ul><li>One</li><li>Two</li></ul>",
      ol: "<ol><li>First</li><li>Second</li></ol>",
      check:
        '<ul class="check"><li><input type="checkbox"> To do</li><li><input type="checkbox"> To do</li></ul>',
      table:
        "<table><thead><tr><th>Column</th><th>Column</th></tr></thead><tbody><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></tbody></table>",
      note: '<p class="note">A note beside the point.</p>',
      hr: "<hr>",
    }[kind];
    const box = document.createElement("template");
    box.innerHTML = html;
    return box.content.firstElementChild;
  };
  /**
   * Puts a new block in: after the block under the handle, or last — or, when it was asked
   * for with `/`, in place of the paragraph the `/` was typed in.
   */
  const insert = (kind) => {
    const made = make(kind);
    const asked = slash;
    closeSlash();
    if (asked) swapBlock(asked, made);
    else {
      const after = block;
      moveBlock(made, () =>
        after ? after.after(made) : putAt(made, lastPlace()),
      );
    }
    // Its words are selected, so the first key typed replaces them — a selection the
    // editor made, which asks for no formatting
    if (!made.matches("hr")) {
      placed = document.createRange();
      placed.selectNodeContents(made.querySelector("li, td, th") ?? made);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(placed.cloneRange());
    }
  };
  for (const button of insertMenu.querySelectorAll("[data-add]"))
    button.addEventListener("click", () => insert(button.dataset.add));

  /*
   * `/` in an empty paragraph opens the Insert menu where it was typed. What is typed after
   * it narrows the menu to what it names — "/tab", "/list" — the arrows walk what is left,
   * Enter puts the one picked in the paragraph's place, and Esc, or words that name
   * nothing, leave the paragraph as it is.
   */
  let slash = null;
  let line = null; // where the `/` was typed, on the page
  /** Under the line, or over it when the window has no room below: at the line either way. */
  const placeSlash = () => {
    place(insertMenu, line.left, line.bottom + 6);
    if (insertMenu.getBoundingClientRect().bottom > innerHeight)
      place(insertMenu, line.left, line.top - insertMenu.offsetHeight - 6);
  };
  const offered = () =>
    [...insertMenu.querySelectorAll("[data-add]")].filter((one) => !one.hidden);
  const pick = (one) => {
    for (const item of insertMenu.querySelectorAll("[data-add]"))
      item.classList.toggle("pg-picked", item === one);
  };
  function closeSlash() {
    if (!slash) return;
    slash = null;
    insertMenu.hidden = true;
    for (const item of insertMenu.querySelectorAll("[data-add]")) {
      item.hidden = false;
      item.classList.remove("pg-picked");
    }
  }
  paper.addEventListener("input", (event) => {
    if (!shell.edits.on) return;
    const here = caretIn()?.closest("#paper > p");
    if (!slash) {
      if (
        event.inputType !== "insertText" ||
        event.data !== "/" ||
        !here ||
        here.className ||
        here.textContent !== "/"
      )
        return;
      slash = here;
      block = here;
      const range = getSelection().getRangeAt(0);
      const box = range.getBoundingClientRect().height
        ? range.getBoundingClientRect()
        : here.getBoundingClientRect();
      line = {
        left: box.left + scrollX,
        top: box.top + scrollY,
        bottom: box.bottom + scrollY,
      };
      blockMenu.hidden = true;
      bubble.hidden = true;
      placeSlash();
      pick(offered()[0]);
      return;
    }
    if (here !== slash || !slash.textContent.startsWith("/"))
      return closeSlash();
    const asked = slash.textContent.slice(1).trim().toLowerCase();
    for (const item of insertMenu.querySelectorAll("[data-add]"))
      item.hidden = !(
        item.textContent.toLowerCase().includes(asked) ||
        item.dataset.add.startsWith(asked)
      );
    const left = offered();
    if (!left.length) return closeSlash();
    pick(left[0]);
    placeSlash();
  });
  paper.addEventListener(
    "keydown",
    (event) => {
      if (!slash || event.isComposing) return;
      const left = offered();
      const at = left.findIndex((one) => one.classList.contains("pg-picked"));
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        pick(left[(at + step + left.length) % left.length]);
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const one = left[Math.max(0, at)];
        if (one) insert(one.dataset.add);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSlash();
      }
    },
    true,
  );

  /*
   * What a paragraph starts with turns it into what it names, as the space after it is
   * typed: `#` a heading, `##` a smaller one, `-` or `*` a list, `1.` a numbered list,
   * `[]` a checklist, `>` a note. The paragraph is swapped for the block with the rest of
   * its words, so ⌘Z gives back the paragraph as it was typed.
   */
  const SHORTHAND = [
    [/^#$/, "h2"],
    [/^##$/, "h3"],
    [/^[-*]$/, "ul"],
    [/^1[.)]$/, "ol"],
    [/^\[ ?\]$/, "check"],
    [/^>$/, "note"],
  ];
  paper.addEventListener("input", (event) => {
    if (
      !shell.edits.on ||
      event.inputType !== "insertText" ||
      event.data !== " "
    )
      return;
    const sel = getSelection();
    const here = caretIn()?.closest("#paper > p");
    if (!here || here.className || !sel?.isCollapsed) return;
    const typed = document.createRange();
    typed.setStart(here, 0);
    typed.setEnd(sel.anchorNode, sel.anchorOffset);
    // A space typed at the end of a line is written as a no-break one
    const mark = typed.toString().replace(/\u00a0/g, " ");
    if (!mark.endsWith(" ")) return;
    const kind = SHORTHAND.find(([rule]) => rule.test(mark.slice(0, -1)))?.[1];
    if (!kind) return;
    const rest = document.createRange();
    rest.setStart(sel.anchorNode, sel.anchorOffset);
    rest.setEnd(here, here.childNodes.length);
    const words = rest.cloneContents();
    const made = document.createElement(
      kind === "note" ? "p" : kind === "check" ? "ul" : kind,
    );
    let into = made;
    if (kind === "note") made.className = "note";
    if (kind === "ul" || kind === "ol" || kind === "check") {
      into = made.appendChild(document.createElement("li"));
      if (kind === "check") {
        made.className = "check";
        const box = into.appendChild(document.createElement("input"));
        box.type = "checkbox";
        into.append(" ");
      }
    }
    into.append(words);
    // An empty block still has a line for the caret
    if (!into.textContent.trim() && !into.querySelector("br"))
      into.append(document.createElement("br"));
    swapBlock(here, made);
    const caret = document.createRange();
    const first = [...into.childNodes].find(
      (node) => !(node instanceof HTMLInputElement),
    );
    // In a checklist the words start after the box and its space
    if (kind === "check") caret.setStart(into.childNodes[1], 1);
    else if (first) caret.setStartBefore(first);
    else caret.setStart(into, 0);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
  });

  /*
   * With the caret in a table, a bar over it adds a row under the caret's or a column
   * after it, and deletes either. The table is changed as a copy put in its place, so
   * ⌘Z takes a whole change back.
   */
  const cellIn = () => (shell.edits.on ? caretIn()?.closest("td, th") : null);
  const tableChange = (how) => {
    const cell = cellIn();
    const table = cell?.closest("table");
    if (!table) return;
    const row = cell.closest("tr");
    const rows = [...table.rows];
    const r = rows.indexOf(row);
    const c = cell.cellIndex;
    const fresh = table.cloneNode(true);
    const copies = [...fresh.rows];
    const blank = (like, inHead) => {
      const one = document.createElement(inHead ? "th" : "td");
      if (like?.className) one.className = like.className;
      return one;
    };
    let to = { r, c };
    if (how === "row") {
      const body = fresh.tBodies[0] ?? fresh.createTBody();
      const next = document.createElement("tr");
      for (let i = 0; i < row.cells.length; i++)
        next.append(blank(null, false));
      if (row.closest("thead")) body.prepend(next);
      else copies[r].after(next);
      to = { r: r + 1, c };
    } else if (how === "column") {
      for (const one of copies)
        one.cells[Math.min(c, one.cells.length - 1)].after(
          blank(null, Boolean(one.closest("thead"))),
        );
      to = { r, c: c + 1 };
    } else if (how === "drop-row") {
      const body = row.closest("tbody");
      if (!body || body.rows.length < 2) return;
      copies[r].remove();
      to = { r: Math.min(r, fresh.rows.length - 1), c };
    } else if (how === "drop-column") {
      if (row.cells.length < 2) return;
      for (const one of copies) one.cells[c]?.remove();
      to = { r, c: Math.max(0, c - 1) };
    }
    swapBlock(table, fresh);
    const into = fresh.rows[to.r]?.cells[to.c];
    if (into) selectAll(into);
  };
  for (const button of tableBar?.querySelectorAll("[data-table]") ?? [])
    button.addEventListener("mousedown", (event) => {
      event.preventDefault(); // the caret stays in its cell
      tableChange(button.dataset.table);
    });
  document.addEventListener("selectionchange", () => {
    if (!tableBar) return;
    const table = cellIn()?.closest("table");
    if (!table) {
      tableBar.hidden = true;
      return;
    }
    tableBar.hidden = false;
    const box = table.getBoundingClientRect();
    place(
      tableBar,
      box.right + scrollX - tableBar.offsetWidth,
      box.top + scrollY - tableBar.offsetHeight - 8,
    );
  });

  /* Some text picked on the paper gets its formatting just above it. execCommand is the
     browser's own editing, and the only one that keeps the undo stack whole. */
  const wrapSelection = (tag, className) => {
    const sel = getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const el = document.createElement(tag);
    if (className) el.className = className;
    try {
      range.surroundContents(el);
    } catch {
      el.append(range.extractContents());
      range.insertNode(el);
    }
  };
  for (const button of bubble.querySelectorAll("[data-fmt]"))
    button.addEventListener("mousedown", (event) => {
      event.preventDefault(); // the selection stays where it is
      const how = button.dataset.fmt;
      if (how === "bold" || how === "italic") document.execCommand(how);
      else if (how === "h2" || how === "p")
        document.execCommand("formatBlock", false, how);
      else if (how === "link") {
        const href = prompt("Link to");
        if (href) document.execCommand("createLink", false, href);
      } else if (how === "chip") {
        wrapSelection("span", "chip");
        seal();
      }
      changed();
      contents();
    });

  document.addEventListener("selectionchange", () => {
    if (!shell.edits.on) return;
    const sel = getSelection();
    if (open && !open.contains(sel?.anchorNode ?? null)) shut();
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    const mine =
      placed &&
      range &&
      range.compareBoundaryPoints(Range.START_TO_START, placed) === 0 &&
      range.compareBoundaryPoints(Range.END_TO_END, placed) === 0;
    if (!mine) placed = null;
    const at = sel?.anchorNode;
    const inChip = (at instanceof Element ? at : at?.parentElement)?.closest(
      ".chip",
    );
    if (
      !range ||
      range.collapsed ||
      mine ||
      inChip ||
      !paper.contains(sel.anchorNode)
    ) {
      bubble.hidden = true;
      return;
    }
    const box = range.getBoundingClientRect();
    if (!box.width) return;
    bubble.hidden = false;
    place(
      bubble,
      box.left + scrollX + box.width / 2 - bubble.offsetWidth / 2,
      box.top + scrollY - bubble.offsetHeight - 8,
    );
  });
})();
