// Showing the deck. The file holds the deck as data — its title, its palette and its
// slides, as JSON (deck.mjs put) — and every slide is drawn from it here, in its layout,
// then fitted: a slide whose words do not fit has its type made smaller, step by step,
// down to a floor. Then one slide at a time, scaled to the stage the head, the notes and
// the strip leave it. The arrows, space and the Page keys turn it, a tap on the right or
// left of the slide does too, and so do the buttons in the head and the strip; `f` fills
// the screen, `n` shows the presenter's notes, and the address (#3) names the slide open
// so a link or a reload lands there. It always fits, because the app draws this file at
// 1024px wide without scrolling it: at 1:1 a slide would show one corner.
(() => {
  const stage = document.getElementById("stage");
  const deck = document.getElementById("deck");
  const notes = document.getElementById("notes");
  const notesText = document.getElementById("notes-text");
  const strip = document.getElementById("strip");
  const thumbs = document.getElementById("thumbs");
  const at = document.getElementById("at");
  const of = document.getElementById("of");
  const png = document.getElementById("png");

  const w = Number(getComputedStyle(document.body).getPropertyValue("--w"));
  const h = Number(getComputedStyle(document.body).getPropertyValue("--h"));

  let data = null;
  try {
    data = JSON.parse(
      deck.querySelector("script[data-deck]")?.textContent || "null",
    );
  } catch {}

  /** An element holding `text` as text: nothing a slide says is read as markup. */
  const el = (tag, className = "", text = null) => {
    const one = document.createElement(tag);
    if (className) one.className = className;
    if (text !== null) one.textContent = text;
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

  /** Quote marks the words came with, so they are not doubled around them. */
  const bare = (text) =>
    text.trim().replace(/^["'“”‘’„«»「『]+|["'“”‘’„«»」』]+$/gu, "");

  /** What each layout puts on its slide, and the class that lays it out (deck.css). */
  const LAYOUTS = {
    cover: (s) => [
      s.eyebrow && el("p", "dk-eyebrow", s.eyebrow),
      el("h1", "dk-title", s.title),
      s.subtitle && el("p", "dk-sub", s.subtitle),
    ],
    statement: (s, section) => {
      section.classList.add("dk-dark");
      return [
        el("h2", "dk-claim", s.title),
        s.subtitle && el("p", "dk-sub", s.subtitle),
      ];
    },
    cards: (s) => {
      const row = el("div", "dk-row");
      (s.cards ?? []).forEach((card, i) => {
        const box = el("div", "dk-card");
        box.append(
          el("p", "dk-num", String(i + 1).padStart(2, "0")),
          el("h3", "", card.title),
        );
        if (card.text) box.append(el("p", "", card.text));
        row.append(box);
      });
      const body = el("div", "dk-body");
      body.append(row);
      return [el("h2", "dk-head", s.title), body];
    },
    number: (s) => [
      s.label && el("p", "dk-label", s.label),
      el("p", "dk-figure", s.value),
      s.subtitle && el("p", "dk-sub", s.subtitle),
    ],
    table: (s) => {
      const right = figures(s);
      const cell = (tag, text, i) =>
        el(
          tag,
          [right[i] && "dk-fig", s.stress === i && "dk-stress"]
            .filter(Boolean)
            .join(" "),
          text,
        );
      const head = el("tr");
      s.columns.forEach((text, i) => head.append(cell("th", text, i)));
      const table = el("table");
      const thead = el("thead");
      thead.append(head);
      const tbody = el("tbody");
      for (const row of s.rows) {
        const tr = el("tr");
        s.columns.forEach((_, i) => tr.append(cell("td", row[i] ?? "", i)));
        tbody.append(tr);
      }
      table.append(thead, tbody);
      const body = el("div", "dk-body");
      body.append(table);
      return [el("h2", "dk-head", s.title), body];
    },
    quote: (s) => {
      const by = el("div", "dk-by");
      by.append(el("p", "dk-who", s.who));
      if (s.role) by.append(el("p", "dk-role", s.role));
      return [el("blockquote", "dk-said", `“${bare(s.quote)}”`), by];
    },
    image: (s) => {
      const words = el("div", "dk-words");
      words.append(el("h2", "dk-head", s.title));
      if (s.subtitle) words.append(el("p", "dk-sub", s.subtitle));
      const img = el("img", s.fit === "whole" ? "dk-pic dk-whole" : "dk-pic");
      img.src = s.image;
      img.alt = s.alt ?? "";
      return [words, img];
    },
    close: (s, section) => {
      section.classList.add("dk-dark");
      const steps = el("div", "dk-steps");
      for (const step of s.steps ?? []) {
        const one = el("div", "dk-step");
        one.append(
          el("p", "dk-step-l", step.label),
          el("p", "dk-step-t", step.text),
        );
        steps.append(one);
      }
      return [el("h2", "dk-claim", s.title), steps.children.length && steps];
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
      section.append(el("p", "dk-foot", s.footer));
    }
    if (s.notes) section.append(el("aside", "", s.notes));
    return section;
  };

  const slides = Array.isArray(data?.slides) ? data.slides.map(draw) : [];
  deck.append(...slides);
  if (data?.title) {
    document.title = data.title;
    const named = document.querySelector(".sh-head .sh-title");
    if (named) named.textContent = data.title;
  }

  /** The smallest a slide's type is made to fit; a slide that still does not is cut. */
  const FLOOR = 0.6;
  const over = (slide) =>
    slide.scrollHeight > h + 1 || slide.scrollWidth > w + 1;

  /**
   * Every slide's type as large as its slide holds, in steps of a twentieth. A slide is
   * measured drawn, so one that is not open is drawn for the moment it takes. The head
   * names the slides that do not fit even at the floor.
   */
  const fitAll = () => {
    const cut = [];
    slides.forEach((slide, n) => {
      const hidden = !slide.classList.contains("open");
      if (hidden) slide.classList.add("open");
      slide.style.removeProperty("--dk-fit");
      let scale = 1;
      while (over(slide) && scale > FLOOR) {
        scale = Math.round((scale - 0.05) * 100) / 100;
        slide.style.setProperty("--dk-fit", String(scale));
      }
      if (over(slide)) cut.push(n + 1);
      if (hidden) slide.classList.remove("open");
    });
    const say = document.getElementById("cut");
    if (!say) return;
    say.hidden = cut.length === 0;
    say.textContent = `cut: ${cut.join(", ")}`;
  };
  fitAll();

  // Printing wants what the renderer wants: every slide, flat, at true size
  addEventListener("beforeprint", () => document.body.classList.add("shot"));
  addEventListener("afterprint", () => document.body.classList.remove("shot"));
  if (document.body.classList.contains("shot") || !slides.length) return;

  // Room around the slide on the stage; a face is the slide edge to edge
  const PAD = shell.face ? 0 : 20;
  let open = 0;

  /** The slide as large as the stage takes it, centred. */
  const fit = () => {
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
    if (!notes.hidden)
      notesText.textContent =
        slides[open].querySelector(":scope > aside")?.textContent.trim() ?? "";
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

  const toggleNotes = () => {
    notes.hidden = !notes.hidden;
    document
      .querySelector("[data-notes]")
      ?.classList.toggle("sh-on", !notes.hidden);
    go(open);
  };

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
  of.textContent = String(slides.length);
  document.getElementById("strip-count").textContent = String(slides.length);

  /**
   * Every slide, small, in the strip: the slides themselves scaled down, so the strip is
   * always what the deck is now. A face has no strip, and no export to offer.
   */
  if (!shell.face) {
    const tall = 84;
    const wide = Math.min(150, Math.round((tall * w) / h));
    slides.forEach((slide, n) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `Slide ${n + 1}`);
      const { box, copy } = shell.thumb(slide, wide, tall, w, h);
      copy.classList.add("open");
      const num = document.createElement("em");
      num.textContent = String(n + 1);
      button.append(box, num);
      button.addEventListener("click", () => go(n));
      thumbs.append(button);
    });

    // The renderer leaves slide-01.png and on beside the deck; without them there is no picture to give
    shell.probe("slide-01.png").then((there) => {
      if (png) png.hidden = !there;
    });
  }

  // What the file keeps of itself: the deck as data, never the slides drawn from it, the
  // strip's copies or the open state
  shell.clean = (copy) => {
    for (const slide of copy.querySelectorAll("#deck > section[data-slide]"))
      slide.remove();
    copy.querySelector("#thumbs")?.replaceChildren();
    copy.querySelector("#notes")?.setAttribute("hidden", "");
    copy.querySelector("#notes-text")?.replaceChildren();
    copy.querySelector("#deck")?.removeAttribute("style");
    copy.querySelector("#deck")?.removeAttribute("data-turn");
  };

  new ResizeObserver(fit).observe(stage);
  addEventListener("fullscreenchange", fit);
  addEventListener("hashchange", toHash);
  toHash();
  fit();
})();
