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
  const state = document.getElementById("state");
  const editButton = document.querySelector("[data-edit]");
  const grip = document.getElementById("grip");
  const bubble = document.getElementById("bubble");
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
  // a time; printing shows them all, one under another, so nothing is lost on paper.
  for (const tabs of paper.querySelectorAll(".tabs")) {
    const panels = [...tabs.querySelectorAll(":scope > [data-tab]")];
    if (panels.length < 2) continue;
    const bar = document.createElement("div");
    bar.setAttribute("role", "tablist");
    bar.contentEditable = "false";
    const pick = (n) =>
      panels.forEach((panel, i) => {
        panel.hidden = i !== n;
        bar.children[i].setAttribute("aria-selected", String(i === n));
      });
    panels.forEach((panel, i) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.textContent = panel.dataset.tab;
      tab.addEventListener("click", () => pick(i));
      bar.append(tab);
      panel.setAttribute("role", "tabpanel");
    });
    tabs.prepend(bar);
    pick(0);
  }

  contents();
  spy();

  /* ── keeping it ──────────────────────────────────────────────────────────── */

  let editing = false;
  let dirty = false;
  let timer = 0;
  let saving = 0; // saves on their way to the app
  let stale = false; // the file was written after this page was opened: nothing more is kept

  // The line's own text changes in place: a node put in its stead while someone types
  // would end their run of typing, as the pane would (contents)
  const say = (text) => {
    if (!state) return;
    const line = state.firstChild;
    if (line?.nodeType === Node.TEXT_NODE) line.data = text;
    else state.textContent = text;
  };

  // The marks a bot's put writes between (skills/shell put.mjs), as the page was opened
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
    copy.querySelector("#state")?.replaceChildren();
    for (const id of ["grip", "bubble", "block-menu", "insert-menu"]) {
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
    copy.querySelector("[data-reload]")?.setAttribute("hidden", "");
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

  /**
   * The file moved on after this page was opened — a bot put new work in, another window
   * saved — and keeping this copy would undo that. Nothing more is kept: Reload shows the
   * file as it is now, and Export still downloads this copy.
   */
  const reload = document.querySelector("[data-reload]");
  reload?.addEventListener("click", () => location.reload());
  const goneStale = () => {
    stale = true;
    clearTimeout(timer);
    timer = 0;
    say("Changed since it opened · not kept");
    if (reload) reload.hidden = false;
  };

  /** Keeps the page now: into the file when the app holds it, as a copy otherwise. */
  const keep = async () => {
    clearTimeout(timer);
    timer = 0;
    if (stale) return;
    const text = shell.serialize(shell.clean);
    if (!shell.host.keeps) {
      shell.download(shell.fileName(), text);
      dirty = false;
      say("Copy downloaded");
      return;
    }
    dirty = false;
    say("Saving…");
    saving++;
    try {
      await shell.host.save(text);
      if (!dirty) say(editing ? "Saved" : "");
    } catch (error) {
      dirty = true;
      if (error.changed) goneStale();
      else say(`Not saved: ${String(error.message || error).slice(0, 60)}`);
    } finally {
      saving--;
    }
  };

  /**
   * Something on the page changed. The app keeps it a moment later, when it is holding
   * the page; nothing else is kept until Done, which downloads the copy — so a checkbox
   * ticked while reading a file opened from disk costs nothing.
   */
  const changed = () => {
    dirty = true;
    if (stale) return;
    if (!shell.host.keeps) {
      if (editing) say("Unsaved · Done keeps a copy");
      return;
    }
    say("Unsaved…");
    clearTimeout(timer);
    timer = setTimeout(keep, 1200);
  };

  // A tick is a change like any other: the box's state is written onto it, since only
  // what is in the markup survives into the file
  paper.addEventListener("change", (event) => {
    const box = event.target;
    if (!(box instanceof HTMLInputElement) || box.type !== "checkbox") return;
    box.toggleAttribute("checked", box.checked);
    changed();
  });

  addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "s" && editing) {
      event.preventDefault();
      keep();
    }
  });

  // Leaving the page keeps what waits at once rather than a moment later: a dialog closed
  // just after the last key takes the frame with it, and the pointer on its way to the
  // close button leaves the page first. A tab closing on words not yet kept asks first; a
  // tick while reading a file from disk was never going to be kept.
  const leaving = () => {
    if (timer) keep();
  };
  addEventListener("blur", leaving);
  document.documentElement.addEventListener("pointerleave", leaving);
  addEventListener("beforeunload", (event) => {
    if (saving || (dirty && (editing || shell.host.keeps)))
      event.preventDefault();
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

  const setEditing = (on) => {
    editing = on;
    document.body.classList.toggle("pg-editing", on);
    paper.contentEditable = on ? "true" : "false";
    seal();
    editButton.classList.toggle("sh-on", on);
    editButton.querySelector(".sh-word").textContent = on ? "Done" : "Edit";
    if (on) {
      shell.host.ask();
      if (stale) return;
      say(
        shell.host.keeps
          ? "Editing · saved as you go"
          : "Editing · Done keeps a copy",
      );
      return;
    }
    shut();
    hideAll();
    if (dirty || timer) keep();
    else say("");
    contents();
    spy();
  };
  editButton.addEventListener("click", () => setEditing(!editing));
  // The app may answer after Edit was pressed: the line under the title catches up
  shell.host.onKeeps(() => {
    if (editing && !dirty && !stale) say("Editing · saved as you go");
  });

  addEventListener("keydown", (event) => {
    if (event.key === "Escape" && editing) hideAll();
  });

  paper.addEventListener("input", () => {
    if (!editing) return;
    seal(); // a chip pasted in joins the others
    changed();
    contents();
  });

  // A chip opens where it is pressed, as a field of its own: the browser puts the caret
  // there, and clearing it stays inside the chip. It closes on a press anywhere else, when
  // the caret leaves it (selectionchange, below), or on Enter or Esc with the caret just
  // past it.
  addEventListener("pointerdown", (event) => {
    const chip = editing && event.target.closest?.("#paper .chip");
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
    blockMenu.hidden = true;
    insertMenu.hidden = true;
    for (const el of paper.querySelectorAll(".pg-hot"))
      el.classList.remove("pg-hot");
    block = null;
  };

  paper.addEventListener("pointermove", (event) => {
    if (!editing || !blockMenu.hidden || !insertMenu.hidden) return;
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
    if (event.target.closest("#grip, #block-menu, #insert-menu, #bubble"))
      return;
    blockMenu.hidden = true;
    insertMenu.hidden = true;
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

  addEventListener("keydown", (event) => {
    if (!editing || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const again = (key === "z" && event.shiftKey) || key === "y";
    if (key !== "z" && !again) return;
    const last = (again ? undone : done).at(-1);
    if (!last || shape() !== (again ? last.before : last.after)) return;
    event.preventDefault();
    (again ? undone : done).pop();
    (again ? done : undone).push(last);
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
  for (const button of insertMenu.querySelectorAll("[data-add]"))
    button.addEventListener("click", () => {
      const made = make(button.dataset.add);
      const after = block;
      moveBlock(made, () =>
        after ? after.after(made) : putAt(made, lastPlace()),
      );
      // Its words are selected, so the first key typed replaces them — a selection the
      // editor made, which asks for no formatting
      if (!made.matches("hr")) {
        placed = document.createRange();
        placed.selectNodeContents(made.querySelector("li, td, th") ?? made);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(placed.cloneRange());
      }
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
    if (!editing) return;
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
