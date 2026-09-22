// What a document does for itself once it is written: an address on every heading, its
// contents in the pane beside it, its tabs — and, when the reader asks, an editor: the
// page becomes editable in place, a block gets a handle, a selection gets its formatting,
// and what was changed is saved back to the file when the app is holding it, or kept as
// a copy when it is not. Nothing here is content: a page runs this and shows no change.
(() => {
  const paper = document.getElementById("paper");
  const outline = document.getElementById("outline");
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

  const headings = () =>
    [...paper.querySelectorAll("h2, h3")].filter(
      (heading) => !heading.closest(".tabs, .card, .note, nav"),
    );

  const address = () => {
    const taken = new Set();
    for (const heading of paper.querySelectorAll("h2, h3")) {
      if (!heading.id || taken.has(heading.id)) {
        let id = slug(heading.textContent) || "section";
        for (let n = 2; taken.has(id); n++)
          id = `${slug(heading.textContent)}-${n}`;
        heading.id = id;
      }
      taken.add(heading.id);
    }
  };

  /**
   * The contents, in the pane: h2s as the list, each with its h3s under it. Headings
   * inside a tab panel or a card are left out — they are not the document's spine.
   * A page with fewer than two sections has no spine to show, and the pane stays shut.
   */
  const contents = () => {
    address();
    outline.replaceChildren();
    const spine = headings();
    document.body.classList.toggle(
      "sh-no-toc",
      spine.filter((h) => h.tagName === "H2").length < 2,
    );
    const head = document.createElement("p");
    head.className = "sh-pane-h";
    head.textContent = "On this page";
    const list = document.createElement("ol");
    let last = null;
    for (const heading of spine) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;
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
    outline.append(head, list);
    // An old page carried its own contents box; the pane is that box now
    for (const old of paper.querySelectorAll("nav.contents")) old.remove();
  };

  /** Which section is being read, as the pane marks it. */
  const watch = new IntersectionObserver(
    (entries) => {
      const seen = entries.filter((e) => e.isIntersecting).map((e) => e.target);
      if (!seen.length) return;
      const top = seen.sort((a, b) => a.offsetTop - b.offsetTop)[0];
      for (const link of outline.querySelectorAll("a"))
        link.classList.toggle(
          "sh-on",
          link.getAttribute("href") === `#${top.id}`,
        );
    },
    { rootMargin: "-10% 0px -70% 0px" },
  );
  const spy = () => {
    watch.disconnect();
    for (const heading of headings()) watch.observe(heading);
  };

  document.querySelector("[data-outline]")?.addEventListener("click", () => {
    document.body.classList.toggle("sh-toc-open");
  });

  // Tabs: a `.tabs` block whose children are <section data-tab="Name">. One is shown at
  // a time; printing shows them all, one under another, so nothing is lost on paper.
  for (const tabs of paper.querySelectorAll(".tabs")) {
    const panels = [...tabs.querySelectorAll(":scope > [data-tab]")];
    if (panels.length < 2) continue;
    const bar = document.createElement("div");
    bar.setAttribute("role", "tablist");
    const pick = (n) => {
      panels.forEach((panel, i) => {
        panel.hidden = i !== n;
        bar.children[i].setAttribute("aria-selected", String(i === n));
      });
    };
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

  /* ── the editor ──────────────────────────────────────────────────────────── */

  if (!editButton) return;
  let editing = false;
  let dirty = false;
  let block = null; // the block under the handle

  // The app serves this file from its file route; there it can also take it back
  const inApp =
    location.pathname.startsWith("/api/file/") &&
    location.protocol.startsWith("http");

  const setState = (text) => {
    if (state) state.textContent = text;
  };

  /** The file as it should be kept: the page without the editor on it. */
  shell.clean = (copy) => {
    copy
      .querySelector("body")
      ?.classList.remove("sh-editing", "sh-toc-open", "sh-no-toc");
    copy.querySelector("#paper")?.removeAttribute("contenteditable");
    copy.querySelector("#outline")?.replaceChildren();
    for (const id of ["grip", "bubble", "block-menu", "insert-menu"]) {
      const el = copy.querySelector(`#${id}`);
      el?.setAttribute("hidden", "");
      el?.removeAttribute("style");
    }
    copy.querySelector("#state")?.replaceChildren();
    for (const el of copy.querySelectorAll(".sh-hot"))
      el.classList.remove("sh-hot");
    for (const tabs of copy.querySelectorAll(".tabs")) {
      tabs.querySelector('[role="tablist"]')?.remove();
      for (const panel of tabs.querySelectorAll("[role=tabpanel]")) {
        panel.removeAttribute("hidden");
        panel.removeAttribute("role");
      }
    }
  };

  let saving = null;
  const save = async () => {
    const text = shell.serialize(shell.clean);
    if (!inApp) {
      shell.download(shell.fileName(), text);
      dirty = false;
      setState("Copy downloaded");
      return;
    }
    setState("Saving…");
    try {
      const res = await fetch(location.pathname, {
        method: "PUT",
        headers: { "content-type": "text/html; charset=utf-8" },
        body: text,
      });
      if (!res.ok) throw new Error(await res.text());
      dirty = false;
      setState("Saved · just now");
    } catch (error) {
      setState(`Not saved: ${String(error.message || error).slice(0, 60)}`);
    }
  };
  const saveSoon = () => {
    dirty = true;
    if (!inApp) {
      setState("Unsaved changes");
      return;
    }
    setState("Unsaved…");
    clearTimeout(saving);
    saving = setTimeout(save, 1200);
  };

  const setEditing = (on) => {
    editing = on;
    document.body.classList.toggle("sh-editing", on);
    paper.contentEditable = on ? "true" : "false";
    editButton.classList.toggle("sh-on", on);
    editButton.querySelector(".sh-word").textContent = on ? "Done" : "Edit";
    if (!on) {
      hideAll();
      if (dirty) save();
      else setState("");
      contents();
      spy();
    } else
      setState(
        inApp ? "Editing · saves as you go" : "Editing · Done keeps a copy",
      );
  };
  editButton.addEventListener("click", () => setEditing(!editing));

  addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      if (!editing) return;
      event.preventDefault();
      clearTimeout(saving);
      save();
    } else if (event.key === "Escape" && editing) {
      hideAll();
    }
  });

  paper.addEventListener("input", () => {
    if (!editing) return;
    saveSoon();
    contents();
  });

  /* Blocks: the paper's own children. A block under the pointer gets the handle. */
  const blockOf = (node) => {
    const el = node instanceof Element ? node : node?.parentElement;
    return el?.closest("#paper > *") ?? null;
  };

  const place = (el, x, y) => {
    el.hidden = false;
    el.style.left = `${Math.max(4, x)}px`;
    el.style.top = `${Math.max(4, y)}px`;
  };

  const hideAll = () => {
    grip.hidden = true;
    bubble.hidden = true;
    blockMenu.hidden = true;
    insertMenu.hidden = true;
    for (const el of paper.querySelectorAll(".sh-hot"))
      el.classList.remove("sh-hot");
  };

  paper.addEventListener("pointermove", (event) => {
    if (!editing || !blockMenu.hidden || !insertMenu.hidden) return;
    const here = blockOf(event.target);
    if (!here || here === block) return;
    for (const el of paper.querySelectorAll(".sh-hot"))
      el.classList.remove("sh-hot");
    block = here;
    block.classList.add("sh-hot");
    const box = block.getBoundingClientRect();
    place(grip, box.left - 62, box.top + scrollY - 2);
  });

  const openMenu = (menu, near) => {
    const box = near.getBoundingClientRect();
    hideAll();
    if (block) block.classList.add("sh-hot");
    place(menu, box.left, box.bottom + scrollY + 4);
  };
  grip
    .querySelector("[data-block-menu]")
    .addEventListener("click", (e) => openMenu(blockMenu, e.currentTarget));
  grip
    .querySelector("[data-insert-menu]")
    .addEventListener("click", (e) => openMenu(insertMenu, e.currentTarget));
  addEventListener("pointerdown", (event) => {
    if (event.target.closest("#grip, #block-menu, #insert-menu, #bubble"))
      return;
    blockMenu.hidden = true;
    insertMenu.hidden = true;
  });

  for (const button of blockMenu.querySelectorAll("[data-block]"))
    button.addEventListener("click", () => {
      if (!block) return;
      const how = button.dataset.block;
      if (how === "up") block.previousElementSibling?.before(block);
      else if (how === "down") block.nextElementSibling?.after(block);
      else if (how === "dup") block.after(block.cloneNode(true));
      else if (how === "delete") {
        block.remove();
        block = null;
      }
      hideAll();
      saveSoon();
      contents();
    });

  /** What the Insert menu makes, each a block a person can start typing into. */
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
      if (block) block.after(made);
      else paper.append(made);
      hideAll();
      const range = document.createRange();
      range.selectNodeContents(made.matches("hr") ? paper : made);
      range.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      saveSoon();
      contents();
    });

  /* Selection: some text picked in the paper gets its formatting above it. */
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
      event.preventDefault(); // keeps the selection
      const how = button.dataset.fmt;
      if (how === "bold" || how === "italic") document.execCommand(how);
      else if (how === "h2" || how === "p")
        document.execCommand("formatBlock", false, how);
      else if (how === "link") {
        const href = prompt("Link to");
        if (href) document.execCommand("createLink", false, href);
      } else if (how === "chip") wrapSelection("span", "chip");
      saveSoon();
      contents();
    });

  document.addEventListener("selectionchange", () => {
    if (!editing) return;
    const sel = getSelection();
    if (
      !sel?.rangeCount ||
      sel.isCollapsed ||
      !paper.contains(sel.anchorNode)
    ) {
      bubble.hidden = true;
      return;
    }
    const box = sel.getRangeAt(0).getBoundingClientRect();
    if (!box.width) return;
    place(
      bubble,
      box.left + box.width / 2 - bubble.offsetWidth / 2,
      box.top + scrollY - 40,
    );
  });

  addEventListener("scroll", () => {
    if (editing) {
      grip.hidden = true;
      bubble.hidden = true;
    }
  });
})();
