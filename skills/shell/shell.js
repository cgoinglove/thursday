// What the shell does for every kind: the theme button, the menus, export, the app when it
// is the one showing the page, and a few things each kind builds its body from — a
// miniature of an element, whether a picture sits beside the file, a copy of the page to
// keep. Runs before the kind's own script and leaves `shell` on the window for it.
window.shell = (() => {
  const THEME = "thursday-shell-theme";
  const root = document.documentElement;
  const face = root.classList.contains("sh-face");

  /* Theme: device → light → dark → device, kept in this browser. The button draws the
     mode it is in (shell.css); a face is always light and keeps nothing. */
  const theme = {
    get: () => root.dataset.theme || "",
    set(value) {
      if (value) root.dataset.theme = value;
      else delete root.dataset.theme;
      if (face) return;
      try {
        if (value) localStorage.setItem(THEME, value);
        else localStorage.removeItem(THEME);
      } catch {}
      for (const button of document.querySelectorAll("[data-theme-cycle]"))
        button.setAttribute("aria-label", `Theme: ${value || "as the device"}`);
    },
    next() {
      const order = ["", "light", "dark"];
      theme.set(order[(order.indexOf(theme.get()) + 1) % order.length]);
    },
  };
  for (const button of document.querySelectorAll("[data-theme-cycle]")) {
    button.addEventListener("click", theme.next);
    button.setAttribute(
      "aria-label",
      `Theme: ${theme.get() || "as the device"}`,
    );
  }

  /* Menus close when anything else is pressed, when one of their items is, or on Esc —
     and an Esc that closed one does nothing else, so one Esc is one thing. This runs
     before the kind's own listener, which then never hears it. */
  const openMenus = () => document.querySelectorAll("details.sh-menu[open]");
  addEventListener("pointerdown", (event) => {
    for (const menu of openMenus())
      if (!menu.contains(event.target)) menu.open = false;
  });
  addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = openMenus();
    if (!open.length) return;
    for (const menu of open) menu.open = false;
    event.stopImmediatePropagation();
  });
  for (const item of document.querySelectorAll(".sh-menu .sh-item"))
    item.addEventListener("click", () =>
      item.closest("details")?.removeAttribute("open"),
    );

  /** A file named `name` holding `text`, handed to the browser to keep. */
  const download = (name, text, type = "text/html") => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** The name this file was opened as, for a copy of it. */
  const fileName = () =>
    decodeURIComponent(location.pathname.split("/").pop() || "") ||
    `${document.title || "page"}.html`;

  /**
   * The page as a file again: a copy of the document with what only the reader's
   * session put there taken out. `clean` is the kind's own pass over that copy — the
   * state of its editor, its miniatures — before the text is made.
   */
  const serialize = (clean) => {
    const copy = root.cloneNode(true);
    copy.removeAttribute("data-theme");
    for (const el of copy.querySelectorAll("details.sh-menu[open]"))
      el.removeAttribute("open");
    clean?.(copy);
    return `<!doctype html>\n${copy.outerHTML}\n`;
  };

  /* Export: what every kind can do for itself. A kind adds its own items. */
  for (const item of document.querySelectorAll("[data-export]"))
    item.addEventListener("click", () => {
      if (item.dataset.export === "print") print();
      else download(fileName(), serialize(window.shell?.clean));
    });

  /**
   * The app, when it is the one showing this page. It frames the page and, asked, says
   * it will keep the page's edits — and keeps them only in the file it opened, whatever
   * the page sends. Anywhere else nobody answers, and a kind keeps a copy instead. Only
   * a page on the app's own origin talks to it: a file opened from disk, or drawn
   * sandboxed as a face, has no host.
   */
  const host = (() => {
    const parent = window.parent !== window ? window.parent : null;
    const origin = location.origin;
    const reachable = parent && origin && origin !== "null";
    let keeps = false;
    let next = 0;
    const waiting = new Map();
    const heard = new Set();
    addEventListener("message", (event) => {
      if (!reachable || event.source !== parent || event.origin !== origin)
        return;
      const said = event.data;
      if (!said || typeof said.thursday !== "string") return;
      if (said.thursday === "host") {
        if (keeps) return;
        keeps = true;
        for (const fn of heard) fn();
        return;
      }
      const one = waiting.get(said.id);
      if (!one) return;
      waiting.delete(said.id);
      if (said.thursday === "saved") one.ok();
      else one.fail(new Error(String(said.error || "not saved")));
    });
    const ask = () => {
      if (reachable) parent.postMessage({ thursday: "hello" }, origin);
    };
    ask();
    return {
      get keeps() {
        return keeps;
      },
      ask,
      /** `fn` runs once the app has said it keeps edits (at once if it already has). */
      onKeeps(fn) {
        if (keeps) fn();
        else heard.add(fn);
      },
      save(html) {
        return new Promise((ok, fail) => {
          if (!keeps) return fail(new Error("nothing is keeping this page"));
          const id = ++next;
          waiting.set(id, { ok, fail });
          parent.postMessage({ thursday: "save", id, html }, origin);
        });
      },
    };
  })();

  /** Whether a picture sits beside this file: loading it is the only test a file opened from disk allows. */
  const probe = (src) =>
    new Promise((ok) => {
      const img = new Image();
      img.onload = () => ok(true);
      img.onerror = () => ok(false);
      img.src = src;
    });

  /**
   * A miniature of `el`: the element itself cloned, laid out at its true size (`w` by
   * `h`) and scaled to fit a `boxW` by `boxH` box, centred in it — so it is always what
   * the thing looks like now, and a tall one fits beside a wide one. Ids and what is said
   * over it (an <aside>) are dropped from the copy, so the page keeps one of each.
   */
  const thumb = (el, boxW, boxH, w, h) => {
    const scale = Math.min(boxW / w, boxH / h);
    const box = document.createElement("span");
    box.className = "sh-thumb";
    box.style.width = `${boxW}px`;
    box.style.height = `${boxH}px`;
    const stage = document.createElement("span");
    stage.className = "sh-thumb-stage";
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    stage.style.transform = `translate(${(boxW - w * scale) / 2}px, ${(boxH - h * scale) / 2}px) scale(${scale})`;
    const copy = el.cloneNode(true);
    copy.removeAttribute("id");
    for (const inner of copy.querySelectorAll("[id]"))
      inner.removeAttribute("id");
    for (const aside of copy.querySelectorAll(":scope > aside")) aside.remove();
    stage.append(copy);
    box.append(stage);
    return { box, copy };
  };

  /**
   * A word that stands for a moment in place of another — "Copied" — then goes back.
   * What it stands in for is kept here, never on the element, so a copy of the page
   * made meanwhile carries nothing of it.
   */
  const resting = new WeakMap();
  const say = (el, text, hold = 1600) => {
    if (!el) return;
    const rest = resting.get(el) ?? { text: el.textContent, timer: 0 };
    resting.set(el, rest);
    el.textContent = text;
    clearTimeout(rest.timer);
    rest.timer = setTimeout(() => {
      el.textContent = rest.text;
      resting.delete(el);
    }, hold);
  };

  return {
    face,
    theme,
    download,
    fileName,
    serialize,
    host,
    probe,
    thumb,
    say,
  };
})();
