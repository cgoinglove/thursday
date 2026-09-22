// What the shell does for every kind: the theme button, the menus, export, and a few
// things each kind builds its body from — a miniature of an element, whether a picture
// sits beside the file, a copy of the page to keep. Runs before the kind's own script and
// leaves `shell` on the window for it.
window.shell = (() => {
  const THEME = "thursday-shell-theme";
  const root = document.documentElement;

  /* Theme: device → light → dark → device. Kept in this browser; the head applied it
     before the first paint (the line in <head>), so this only wires the button. */
  const theme = {
    get: () => root.dataset.theme || "",
    set(value) {
      if (value) root.dataset.theme = value;
      else delete root.dataset.theme;
      try {
        if (value) localStorage.setItem(THEME, value);
        else localStorage.removeItem(THEME);
      } catch {}
      for (const button of document.querySelectorAll("[data-theme-cycle]"))
        button.title = `Theme: ${value || "device"}`;
    },
    next() {
      const order = ["", "light", "dark"];
      theme.set(order[(order.indexOf(theme.get()) + 1) % order.length]);
    },
  };
  for (const button of document.querySelectorAll("[data-theme-cycle]"))
    button.addEventListener("click", theme.next);
  theme.set(theme.get());

  /* Menus close when anything else is pressed, or on Esc. */
  addEventListener("pointerdown", (event) => {
    for (const menu of document.querySelectorAll("details.sh-menu[open]"))
      if (!menu.contains(event.target)) menu.open = false;
  });
  addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    for (const menu of document.querySelectorAll("details.sh-menu[open]"))
      menu.open = false;
  });

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
   * session put there taken out. `clean` is the kind's own pass over that copy —
   * the state of its editor, its miniatures — before the text is made.
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
  for (const item of document.querySelectorAll("[data-export]")) {
    item.addEventListener("click", () => {
      const how = item.dataset.export;
      if (how === "print") print();
      else if (how === "html")
        download(fileName(), serialize(window.shell?.clean));
      item.closest("details")?.removeAttribute("open");
    });
  }

  /** Whether a picture sits beside this file, without fetching it as data. */
  const probe = (src) =>
    new Promise((ok) => {
      const img = new Image();
      img.onload = () => ok(true);
      img.onerror = () => ok(false);
      img.src = src;
    });

  /**
   * A miniature of `el` at `width` px: the element itself cloned, laid out at its true
   * size (`w` by `h`) and scaled down, so it is always what the thing looks like now.
   * Ids are dropped from the copy so the page keeps one of each.
   */
  const thumb = (el, width, w, h) => {
    const box = document.createElement("span");
    box.className = "sh-thumb";
    box.style.width = `${width}px`;
    box.style.height = `${Math.round((h * width) / w)}px`;
    const stage = document.createElement("span");
    stage.className = "sh-thumb-stage";
    stage.style.display = "block";
    stage.style.width = `${w}px`;
    stage.style.height = `${h}px`;
    stage.style.transform = `scale(${width / w})`;
    const copy = el.cloneNode(true);
    copy.removeAttribute("id");
    for (const inner of copy.querySelectorAll("[id]"))
      inner.removeAttribute("id");
    for (const aside of copy.querySelectorAll(":scope > aside")) aside.remove();
    stage.append(copy);
    box.append(stage);
    return box;
  };

  /** A word in the head that fades after a moment — "Saved", "Copied". */
  const say = (el, text, hold = 1600) => {
    if (!el) return;
    const was = el.dataset.rest ?? el.textContent;
    el.dataset.rest = was;
    el.textContent = text;
    clearTimeout(el._say);
    el._say = setTimeout(() => {
      el.textContent = el.dataset.rest ?? "";
    }, hold);
  };

  return { theme, download, serialize, probe, thumb, say, fileName };
})();
