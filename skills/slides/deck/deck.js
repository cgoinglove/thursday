// Showing the deck: one slide at a time, scaled to the stage the head, the notes and the
// strip leave it. The arrows, space and the Page keys turn it, a tap on the right or left
// of the slide does too, and so do the buttons in the head and the strip; `f` fills the
// screen, `n` shows the presenter's notes, and the address (#3) names the slide open so a
// link or a reload lands there. It always fits, because the app draws this file at 1024px
// wide without scrolling it: at 1:1 a slide would show one corner.
(() => {
  const slides = [...document.querySelectorAll("section[data-slide]")];
  const stage = document.getElementById("stage");
  const deck = document.getElementById("deck");
  const notes = document.getElementById("notes");
  const notesText = document.getElementById("notes-text");
  const strip = document.getElementById("strip");
  const thumbs = document.getElementById("thumbs");
  const at = document.getElementById("at");
  const of = document.getElementById("of");
  const png = document.getElementById("png");

  // Printing wants what the renderer wants: every slide, flat, at true size
  addEventListener("beforeprint", () => document.body.classList.add("shot"));
  addEventListener("afterprint", () => document.body.classList.remove("shot"));
  if (document.body.classList.contains("shot") || !slides.length) return;

  const w = Number(getComputedStyle(document.body).getPropertyValue("--w"));
  const h = Number(getComputedStyle(document.body).getPropertyValue("--h"));
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
    // Which way the deck is going, so the slide coming in enters from that side.
    // Landing on the slide already open (a reload, the address bar) is no turn.
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
   * always what the deck is now. Built once; a slide edited by hand shows on reload. A
   * face has no strip, and no export to offer.
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

  /**
   * A slide clips what does not fit, and nothing else on screen says so. Every slide is
   * measured once, drawn or not, and the head names the ones that are cut.
   */
  const checkFit = () => {
    const cut = [];
    slides.forEach((slide, n) => {
      const hidden = !slide.classList.contains("open");
      if (hidden) slide.classList.add("open");
      if (
        slide.scrollHeight > slide.clientHeight + 1 ||
        slide.scrollWidth > slide.clientWidth + 1
      )
        cut.push(n + 1);
      if (hidden) slide.classList.remove("open");
    });
    const say = document.getElementById("cut");
    if (!say) return;
    say.hidden = cut.length === 0;
    say.textContent = `cut: ${cut.join(", ")}`;
  };

  // What the file keeps of itself: the deck, never the strip's copies or the open state
  shell.clean = (copy) => {
    copy.querySelector("#thumbs")?.replaceChildren();
    copy.querySelector("#notes")?.setAttribute("hidden", "");
    copy.querySelector("#notes-text")?.replaceChildren();
    for (const slide of copy.querySelectorAll("section[data-slide]"))
      slide.classList.remove("open");
    copy.querySelector("#deck")?.removeAttribute("style");
    copy.querySelector("#deck")?.removeAttribute("data-turn");
  };

  new ResizeObserver(fit).observe(stage);
  addEventListener("fullscreenchange", fit);
  addEventListener("hashchange", toHash);
  toHash();
  fit();
  checkFit();
  document.fonts?.ready.then(checkFit);
})();
