// Showing the deck, and editing it. The file holds the deck as data — its title, its
// palette and its slides, as JSON (deck.mjs put) — and every slide is drawn from it here,
// in its layout, then fitted: a slide whose words do not fit has its type made smaller,
// step by step, down to a floor. Then one slide at a time, scaled to the stage the head,
// the notes and the strip leave it. The arrows, space and the Page keys turn it, a tap on
// the right or left of the slide does too, and so do the buttons in the head and the
// strip; `f` fills the screen, `n` shows the presenter's notes, and the address (#3) names
// the slide open so a link or a reload lands there. It always fits, because the app draws
// this file at 1024px wide without scrolling it: at 1:1 a slide would show one corner.
//
// Edit (shell.edits) writes the words where they stand, the notes under the stage, and the
// deck's order and palette from the strip's head. What changes is the data, and the slides
// are drawn from it again; the app keeps it as the file.
(() => {
  const stage = document.getElementById("stage");
  const deck = document.getElementById("deck");
  const source = deck.querySelector("script[data-deck]");
  const notes = document.getElementById("notes");
  const notesText = document.getElementById("notes-text");
  const strip = document.getElementById("strip");
  const thumbs = document.getElementById("thumbs");
  const tools = document.getElementById("slide-tools");
  const at = document.getElementById("at");
  const of = document.getElementById("of");
  const png = document.getElementById("png");

  const w = Number(getComputedStyle(document.body).getPropertyValue("--w"));
  const h = Number(getComputedStyle(document.body).getPropertyValue("--h"));

  let data = null;
  try {
    data = JSON.parse(source?.textContent || "null");
  } catch {}
  if (!Array.isArray(data?.slides)) data = null;

  /* ── drawing ─────────────────────────────────────────────────────────────── */

  /**
   * An element holding `text` as text: nothing a slide says is read as markup. `f` names
   * the field of the slide it shows (`title`, `cards.1.text`), which is what an edit to
   * it writes.
   */
  const el = (tag, className = "", text = null, f = null) => {
    const one = document.createElement(tag);
    if (className) one.className = className;
    if (text !== null) one.textContent = text;
    if (f) one.dataset.f = f;
    return one;
  };

  /** A table column of figures lines up on the right; one that starts with a digit or a sign is taken as one. */
  const FIGURE = /^[-+−±~≈<>]?\p{Sc}?\d/u;
  const figures = (slide) =>
    slide.columns.map(
      (_, i) =>
        i > 0 &&
        slide.rows.some((row) => row[i]?.trim()) &&
        slide.rows.every(
          (row) =>
            !row[i]?.trim() ||
            (FIGURE.test(row[i].trim()) && row[i].trim().length <= 16),
        ),
    );

  /** Quote marks the words came with: the slide sets its own (deck.css), so they are not doubled. */
  const bare = (text) =>
    text.trim().replace(/^["'“”‘’„«»「『]+|["'“”‘’„«»」』]+$/gu, "");

  /** What each layout puts on its slide, and the class that lays it out (deck.css). */
  const LAYOUTS = {
    cover: (s) => [
      s.eyebrow && el("p", "dk-eyebrow", s.eyebrow, "eyebrow"),
      el("h1", "dk-title", s.title, "title"),
      s.subtitle && el("p", "dk-sub", s.subtitle, "subtitle"),
    ],
    statement: (s, section) => {
      section.classList.add("dk-dark");
      return [
        el("h2", "dk-claim", s.title, "title"),
        s.subtitle && el("p", "dk-sub", s.subtitle, "subtitle"),
      ];
    },
    cards: (s) => {
      const row = el("div", "dk-row");
      (s.cards ?? []).forEach((card, i) => {
        const box = el("div", "dk-card");
        box.append(
          el("p", "dk-num", String(i + 1).padStart(2, "0")),
          el("h3", "", card.title, `cards.${i}.title`),
        );
        if (card.text) box.append(el("p", "", card.text, `cards.${i}.text`));
        row.append(box);
      });
      const body = el("div", "dk-body");
      body.append(row);
      return [el("h2", "dk-head", s.title, "title"), body];
    },
    number: (s) => [
      s.label && el("p", "dk-label", s.label, "label"),
      el("p", "dk-figure", s.value, "value"),
      s.subtitle && el("p", "dk-sub", s.subtitle, "subtitle"),
    ],
    table: (s) => {
      const right = figures(s);
      const cell = (tag, text, i, f) =>
        el(
          tag,
          [right[i] && "dk-fig", s.stress === i && "dk-stress"]
            .filter(Boolean)
            .join(" "),
          text,
          f,
        );
      const head = el("tr");
      s.columns.forEach((text, i) =>
        head.append(cell("th", text, i, `columns.${i}`)),
      );
      const thead = el("thead");
      thead.append(head);
      const tbody = el("tbody");
      s.rows.forEach((row, r) => {
        const tr = el("tr");
        s.columns.forEach((_, i) =>
          tr.append(cell("td", row[i] ?? "", i, `rows.${r}.${i}`)),
        );
        tbody.append(tr);
      });
      const table = el("table");
      table.append(thead, tbody);
      const body = el("div", "dk-body");
      body.append(table);
      return [el("h2", "dk-head", s.title, "title"), body];
    },
    quote: (s) => {
      const by = el("div", "dk-by");
      by.append(el("p", "dk-who", s.who, "who"));
      if (s.role) by.append(el("p", "dk-role", s.role, "role"));
      return [el("blockquote", "dk-said", bare(s.quote), "quote"), by];
    },
    image: (s) => {
      const words = el("div", "dk-words");
      words.append(el("h2", "dk-head", s.title, "title"));
      if (s.subtitle) words.append(el("p", "dk-sub", s.subtitle, "subtitle"));
      const img = el("img", s.fit === "whole" ? "dk-pic dk-whole" : "dk-pic");
      img.src = s.image;
      img.alt = s.alt ?? "";
      return [words, img];
    },
    close: (s, section) => {
      section.classList.add("dk-dark");
      const steps = el("div", "dk-steps");
      (s.steps ?? []).forEach((step, i) => {
        const one = el("div", "dk-step");
        one.append(
          el("p", "dk-step-l", step.label, `steps.${i}.label`),
          el("p", "dk-step-t", step.text, `steps.${i}.text`),
        );
        steps.append(one);
      });
      return [
        el("h2", "dk-claim", s.title, "title"),
        steps.children.length && steps,
      ];
    },
  };

  /** Hangul breaks between words, never inside one (deck.css :lang(ko)), so a slide in it says so. */
  const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

  /** One slide of the deck, drawn. A layout this page does not know is drawn as a statement. */
  const draw = (s) => {
    const layout = LAYOUTS[s.layout] ? s.layout : "statement";
    const section = el("section", `dk-${layout}`);
    section.dataset.slide = "";
    if (data.theme) section.dataset.palette = data.theme;
    if (HANGUL.test(JSON.stringify(s))) section.lang = "ko";
    section.append(...LAYOUTS[layout](s, section).filter(Boolean));
    if (s.footer) {
      section.classList.add("dk-footed");
      section.append(el("p", "dk-foot", s.footer, "footer"));
    }
    return section;
  };

  /** The deck's name, in its tab and its head. */
  const title = () => {
    if (!data?.title) return;
    document.title = data.title;
    const named = document.querySelector(".sh-head .sh-title");
    if (named) named.textContent = data.title;
  };

  /** The smallest a slide's type is made to fit; a slide that still does not is cut. */
  const FLOOR = 0.6;
  const over = (slide) =>
    slide.scrollHeight > h + 1 || slide.scrollWidth > w + 1;
  const cut = new Set();

  /**
   * A slide's type as large as the slide holds, in steps of a twentieth: whether it fits.
   * A slide is measured drawn, so one that is not open is drawn for the moment it takes.
   */
  const fitType = (slide) => {
    const hidden = !slide.classList.contains("open");
    if (hidden) slide.classList.add("open");
    slide.style.removeProperty("--dk-fit");
    let scale = 1;
    while (over(slide) && scale > FLOOR) {
      scale = Math.round((scale - 0.05) * 100) / 100;
      slide.style.setProperty("--dk-fit", String(scale));
    }
    const fits = !over(slide);
    if (hidden) slide.classList.remove("open");
    return fits;
  };

  /** The head names the slides that do not fit even at the floor. */
  const sayCut = () => {
    const say = document.getElementById("cut");
    if (!say) return;
    say.hidden = cut.size === 0;
    say.textContent = `cut: ${[...cut].sort((a, b) => a - b).join(", ")}`;
  };

  let slides = data ? data.slides.map(draw) : [];
  const fitAll = () => {
    cut.clear();
    slides.forEach((slide, n) => {
      if (!fitType(slide)) cut.add(n + 1);
    });
    sayCut();
  };
  deck.append(...slides);
  title();
  fitAll();

  // Printing wants what the renderer wants: every slide, flat, at true size
  addEventListener("beforeprint", () => document.body.classList.add("shot"));
  addEventListener("afterprint", () => document.body.classList.remove("shot"));
  if (document.body.classList.contains("shot") || !slides.length) {
    document.querySelector("[data-edit]")?.setAttribute("hidden", "");
    return;
  }

  /* ── showing ─────────────────────────────────────────────────────────────── */

  // Room around the slide on the stage; a face is the slide edge to edge
  const PAD = shell.face ? 0 : 20;
  let open = 0;

  /** The slide as large as the stage takes it, centred. */
  const place = () => {
    const room = document.fullscreenElement
      ? { w: innerWidth, h: innerHeight, pad: 0 }
      : { w: stage.clientWidth, h: stage.clientHeight, pad: PAD };
    const z = Math.min(
      (room.w - room.pad * 2) / w,
      (room.h - room.pad * 2) / h,
    );
    const x = (room.w - w * z) / 2;
    const y = (room.h - h * z) / 2;
    deck.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  };

  const go = (i) => {
    const was = open;
    open = Math.max(0, Math.min(slides.length - 1, i));
    // Landing on the slide already open (a reload, the address bar) is no turn
    deck.dataset.turn = open === was ? "" : open > was ? "on" : "back";
    slides.forEach((slide, n) => slide.classList.toggle("open", n === open));
    at.textContent = String(open + 1);
    if (!notes.hidden) {
      notesText.textContent = data.slides[open].notes ?? "";
      if (!notesText.textContent) notesText.replaceChildren();
    }
    for (const [n, button] of [...thumbs.children].entries()) {
      button.classList.toggle("dk-on", n === open);
      if (n === open) reveal(button);
    }
    // The picture the renderer left for this slide, when it did
    if (png) png.href = `slide-${String(open + 1).padStart(2, "0")}.png`;
    shell.address(`#${open + 1}`);
  };

  /**
   * The strip scrolls to the open slide, and nothing else does: scrollIntoView would
   * move every scrolling box around the page as well, the app's own window among them,
   * when this deck is drawn inside it.
   */
  const reveal = (button) => {
    const row = thumbs.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    if (box.left < row.left) thumbs.scrollLeft -= row.left - box.left + 12;
    else if (box.right > row.right)
      thumbs.scrollLeft += box.right - row.right + 12;
  };

  const toHash = () => {
    const n = Number(location.hash.slice(1));
    go(n >= 1 ? n - 1 : 0);
  };

  const showNotes = (show) => {
    notes.hidden = !show;
    document.querySelector("[data-notes]")?.classList.toggle("sh-on", show);
    go(open);
  };
  const toggleNotes = () => showNotes(notes.hidden);

  const fill = () =>
    document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen?.();

  addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const on = event.target;
    if (
      on instanceof HTMLElement &&
      on.closest("input, textarea, select, [contenteditable]")
    )
      return;
    const step = {
      ArrowRight: 1,
      ArrowDown: 1,
      PageDown: 1,
      " ": event.shiftKey ? -1 : 1,
      ArrowLeft: -1,
      ArrowUp: -1,
      PageUp: -1,
    }[event.key];
    if (step) go(open + step);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(slides.length - 1);
    else if (event.key === "f") fill();
    else if (event.key === "n") toggleNotes();
    else return;
    event.preventDefault();
  });

  deck.addEventListener("click", (event) => {
    // While editing, a press on a slide is a press on its words
    if (shell.edits.on) return;
    if (event.target.closest("a, button, input, select, textarea, summary"))
      return;
    if (getSelection()?.toString()) return;
    const box = deck.getBoundingClientRect();
    go(open + (event.clientX < box.left + box.width / 3 ? -1 : 1));
  });

  /* The head's own buttons, and the strip's. */
  for (const button of document.querySelectorAll("[data-go]"))
    button.addEventListener("click", () =>
      go(open + Number(button.dataset.go)),
    );
  document
    .querySelector("[data-notes]")
    ?.addEventListener("click", toggleNotes);
  document.querySelector("[data-full]")?.addEventListener("click", fill);
  document.querySelector("[data-present]")?.addEventListener("click", () => {
    if (!document.fullscreenElement) fill();
  });
  document.querySelector("[data-strip]")?.addEventListener("click", (event) => {
    const shut = strip.classList.toggle("dk-shut");
    event.currentTarget.setAttribute("aria-expanded", String(!shut));
    event.currentTarget.setAttribute(
      "aria-label",
      shut ? "Show the slides" : "Fold the slides away",
    );
  });

  /**
   * Every slide, small, in the strip: the slides themselves scaled down, so the strip is
   * always what the deck is now. A face has no strip, and no export to offer.
   */
  const tall = 84;
  const wide = Math.min(150, Math.round((tall * w) / h));
  const thumbOf = (n) => {
    const { box, copy } = shell.thumb(slides[n], wide, tall, w, h);
    copy.classList.add("open");
    for (const field of copy.querySelectorAll("[contenteditable]"))
      field.removeAttribute("contenteditable");
    return box;
  };
  const drawStrip = () => {
    of.textContent = String(slides.length);
    document.getElementById("strip-count").textContent = String(slides.length);
    if (shell.face) return;
    thumbs.replaceChildren(
      ...slides.map((_, n) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", `Slide ${n + 1}`);
        const num = document.createElement("em");
        num.textContent = String(n + 1);
        button.append(thumbOf(n), num);
        button.addEventListener("click", () => go(n));
        return button;
      }),
    );
  };
  drawStrip();

  // The renderer leaves slide-01.png and on beside the deck; without them there is no picture to give
  if (!shell.face)
    shell.probe("slide-01.png").then((there) => {
      if (png) png.hidden = !there;
    });

  // What the file keeps of itself: the deck as data, never the slides drawn from it, the
  // strip's copies, the editor or the open state
  shell.clean = (copy) => {
    for (const slide of copy.querySelectorAll("#deck > section[data-slide]"))
      slide.remove();
    copy.querySelector("body")?.classList.remove("dk-editing");
    copy.querySelector("#thumbs")?.replaceChildren();
    copy.querySelector("#notes")?.setAttribute("hidden", "");
    copy.querySelector("[data-notes]")?.classList.remove("sh-on");
    const said = copy.querySelector("#notes-text");
    said?.replaceChildren();
    said?.removeAttribute("contenteditable");
    copy.querySelector("#slide-tools")?.setAttribute("hidden", "");
    for (const swatch of copy.querySelectorAll(".dk-swatch"))
      swatch.removeAttribute("aria-checked");
    copy.querySelector("#cut")?.setAttribute("hidden", "");
    copy.querySelector("#deck")?.removeAttribute("style");
    copy.querySelector("#deck")?.removeAttribute("data-turn");
  };

  new ResizeObserver(place).observe(stage);
  addEventListener("fullscreenchange", place);
  addEventListener("hashchange", toHash);
  toHash();
  place();

  /* ── editing ─────────────────────────────────────────────────────────────── */

  if (shell.face || !source) return;

  /** The deck as the file keeps it: written into its own script, so a save carries it. */
  const changed = () => {
    source.textContent = JSON.stringify(data).replace(/</g, "\\u003c");
    shell.edits.changed();
  };

  /** A field written in place: its words as text, whatever the browser can do. */
  const writable = (node) => {
    try {
      node.contentEditable = "plaintext-only";
    } catch {
      node.contentEditable = "true";
    }
  };
  const fields = (on) => {
    for (const field of deck.querySelectorAll("[data-f]"))
      if (on) writable(field);
      else field.removeAttribute("contenteditable");
  };

  const swatches = () => {
    for (const swatch of document.querySelectorAll(".dk-swatch"))
      swatch.setAttribute(
        "aria-checked",
        String(swatch.dataset.palette === (data.theme || "forest")),
      );
  };

  /** Every slide drawn again from the deck, and everything that shows them. */
  const redraw = () => {
    for (const slide of slides) slide.remove();
    slides = data.slides.map(draw);
    deck.append(...slides);
    fitAll();
    if (shell.edits.on) fields(true);
    drawStrip();
    swatches();
    title();
    go(Math.min(open, slides.length - 1));
  };

  /*
   * What Edit takes back (⌘Z) and puts again (⇧⌘Z): the deck and the slide open, as they
   * were before each change. The words written in one field while it held the caret are
   * one change, however many keys they took.
   */
  const past = [];
  const future = [];
  let before = null; // the deck as a field found it, until the field changes it
  const now = () => ({ deck: JSON.stringify(data), open });
  const remember = (was = now()) => {
    past.push(was);
    if (past.length > 100) past.shift();
    future.length = 0;
  };
  const back = (from, to) => {
    if (!from.length) return;
    to.push(now());
    const was = from.pop();
    data = JSON.parse(was.deck);
    open = was.open;
    before = null;
    redraw();
    changed();
  };

  /** A change to the deck as a whole: remembered, drawn again, kept. */
  const change = (fn) => {
    remember();
    fn();
    redraw();
    changed();
  };

  /** `slide`'s field at `path` (`cards.1.text`) set to `value`. */
  const setField = (slide, path, value) => {
    const keys = path.split(".");
    let into = slide;
    for (const key of keys.slice(0, -1)) into = into[key];
    into[keys.at(-1)] = value;
  };

  let thumbTimer = 0;
  deck.addEventListener("focusin", (event) => {
    if (shell.edits.on && event.target.closest?.("[data-f]")) before = now();
  });
  deck.addEventListener("input", (event) => {
    const field = event.target.closest?.("[data-f]");
    const n = slides.indexOf(field?.closest("section[data-slide]"));
    if (!shell.edits.on || n === -1) return;
    if (before) remember(before);
    before = null;
    setField(data.slides[n], field.dataset.f, field.textContent);
    // Its type follows its words as they are written, and so does its miniature, a moment later
    if (fitType(slides[n])) cut.delete(n + 1);
    else cut.add(n + 1);
    sayCut();
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(
      () => thumbs.children[n]?.firstElementChild?.replaceWith(thumbOf(n)),
      300,
    );
    changed();
  });
  // A field holds one line: Enter and Esc leave it, and what is pasted comes in as words
  deck.addEventListener("keydown", (event) => {
    if (!shell.edits.on || !event.target.closest?.("[data-f]")) return;
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      event.target.blur();
    }
  });
  deck.addEventListener("paste", (event) => {
    if (!shell.edits.on || !event.target.closest?.("[data-f]")) return;
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    document.execCommand("insertText", false, text.replace(/\s*\n\s*/g, " "));
  });

  // What is said over the open slide is written under the stage
  notesText.addEventListener("focus", () => {
    if (shell.edits.on) before = now();
  });
  notesText.addEventListener("input", () => {
    if (!shell.edits.on) return;
    if (before) remember(before);
    before = null;
    const said = notesText.textContent;
    if (said.trim()) data.slides[open].notes = said;
    else {
      delete data.slides[open].notes;
      if (!said) notesText.replaceChildren();
    }
    changed();
  });

  for (const button of document.querySelectorAll("[data-move]"))
    button.addEventListener("click", () => {
      const to = open + Number(button.dataset.move);
      if (to < 0 || to >= data.slides.length) return;
      change(() => {
        [data.slides[open], data.slides[to]] = [
          data.slides[to],
          data.slides[open],
        ];
        open = to;
      });
    });
  document.querySelector("[data-duplicate]")?.addEventListener("click", () =>
    change(() => {
      data.slides.splice(open + 1, 0, structuredClone(data.slides[open]));
      open += 1;
    }),
  );
  document.querySelector("[data-delete]")?.addEventListener("click", () => {
    if (data.slides.length < 2) return;
    change(() => {
      data.slides.splice(open, 1);
      open = Math.min(open, data.slides.length - 1);
    });
  });
  for (const swatch of document.querySelectorAll(".dk-swatch"))
    swatch.addEventListener("click", () => {
      if ((data.theme || "forest") === swatch.dataset.palette) return;
      change(() => {
        data.theme = swatch.dataset.palette;
      });
    });

  addEventListener("keydown", (event) => {
    if (!shell.edits.on || !(event.metaKey || event.ctrlKey) || event.altKey)
      return;
    const key = event.key.toLowerCase();
    const again =
      (key === "z" && event.shiftKey) || (key === "y" && !event.metaKey);
    if (key !== "z" && !again) return;
    event.preventDefault();
    const field = document.activeElement?.closest?.("[data-f]")?.dataset.f;
    if (again) back(future, past);
    else back(past, future);
    // The caret goes back to the field it was in, at the end of its words
    const into = field && slides[open]?.querySelector(`[data-f="${field}"]`);
    if (!into) return;
    into.focus();
    getSelection()?.selectAllChildren(into);
    getSelection()?.collapseToEnd();
  });

  shell.edits.onToggle((on) => {
    document.body.classList.toggle("dk-editing", on);
    fields(on);
    if (tools) tools.hidden = !on;
    swatches();
    if (on) {
      writable(notesText);
      // The notes are written in too, so they show
      if (notes.hidden) showNotes(true);
      return;
    }
    notesText.removeAttribute("contenteditable");
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
})();
