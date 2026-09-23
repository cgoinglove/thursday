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
   * it will keep the page's edits, with a name for the file this page was opened as
   * (`as`); every save carries that name back, and the app keeps it in that file whatever
   * its frame shows by the time it arrives. Anywhere else nobody answers, and a kind keeps
   * a copy instead. Only a page on the app's own origin talks to it: a file opened from
   * disk, or drawn sandboxed as a face, has no host.
   *
   * A save also carries the revision in the page's head: the one it was opened at, then
   * the one each save came back with. A file written since — a bot's put, another
   * window's save — names another, and the save fails with `changed` rather than undo it.
   * Saves go one at a time, so each names the revision the one before it left.
   */
  const host = (() => {
    const parent = window.parent !== window ? window.parent : null;
    const origin = location.origin;
    const reachable = parent && origin && origin !== "null";
    const revision = document.querySelector('meta[name="revision"]');
    let keeps = false;
    let as = "";
    let next = 0;
    let line = Promise.resolve();
    const waiting = new Map();
    const heard = new Set();
    addEventListener("message", (event) => {
      if (!reachable || event.source !== parent || event.origin !== origin)
        return;
      const said = event.data;
      if (!said || typeof said.thursday !== "string") return;
      if (said.thursday === "host") {
        if (keeps || typeof said.as !== "string") return;
        keeps = true;
        as = said.as;
        for (const fn of heard) fn();
        return;
      }
      // An answer meant for another page this frame held before
      if (said.as !== as) return;
      const one = waiting.get(said.id);
      if (!one) return;
      waiting.delete(said.id);
      if (said.thursday === "saved") {
        if (said.revision) revision?.setAttribute("content", said.revision);
        one.ok();
        return;
      }
      const error = new Error(
        said.changed
          ? "changed since it was opened"
          : String(said.error || "not saved"),
      );
      error.changed = said.changed === true;
      one.fail(error);
    });
    const ask = () => {
      if (reachable) parent.postMessage({ thursday: "hello" }, origin);
    };
    ask();
    const send = (html) =>
      new Promise((ok, fail) => {
        const id = ++next;
        waiting.set(id, { ok, fail });
        const base = revision?.getAttribute("content") ?? "";
        parent.postMessage({ thursday: "save", as, id, html, base }, origin);
      });
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
        if (!keeps)
          return Promise.reject(new Error("nothing is keeping this page"));
        const done = line.then(() => send(html));
        line = done.catch(() => {});
        return done;
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
    // A picture of the thing, not a second one: its links, buttons and fields take no keys
    // and are not read out. What holds it names itself (aria-label): a form's labels in
    // the copy still reach a name made from its words.
    box.inert = true;
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
