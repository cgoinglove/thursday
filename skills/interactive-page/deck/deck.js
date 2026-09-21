// Showing the deck: one slide at a time, scaled to the window. Arrows, space and the
// Page keys turn it, a tap on the right or left of the slide does too, `f` fills the
// screen, `n` shows the presenter's notes, and the address (#3) names the slide open so
// a link or a reload lands there. It always fits, because the app draws this file at
// 1024px wide without scrolling it: at 1:1 a slide would show one corner.
(() => {
  const slides = [...document.querySelectorAll("section[data-slide]")];
  const deck = document.getElementById("deck");
  const notes = document.getElementById("notes");
  const at = document.getElementById("at");
  const BAR = 36;

  // Printing wants what the renderer wants: every slide, flat, at true size
  addEventListener("beforeprint", () => document.body.classList.add("shot"));
  addEventListener("afterprint", () => document.body.classList.remove("shot"));
  if (document.body.classList.contains("shot") || !slides.length) return;

  const w = deck.offsetWidth;
  const h = deck.offsetHeight;
  let open = 0;

  const fit = () => {
    const room = innerHeight - (document.fullscreenElement ? 0 : BAR);
    const z = Math.min(innerWidth / w, room / h);
    const x = (innerWidth - w * z) / 2;
    const y = (room - h * z) / 2;
    deck.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  };

  const go = (i) => {
    open = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach((slide, n) => slide.classList.toggle("open", n === open));
    if (at) at.value = `${open + 1} / ${slides.length}`;
    if (notes && !notes.hidden)
      notes.textContent =
        slides[open].querySelector(":scope > aside")?.textContent.trim() ?? "";
    history.replaceState(null, "", `#${open + 1}`);
  };

  const toHash = () => {
    const n = Number(location.hash.slice(1));
    go(n >= 1 ? n - 1 : 0);
  };

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
    else if (event.key === "f")
      document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen?.();
    else if (event.key === "n" && notes) {
      notes.hidden = !notes.hidden;
      go(open);
    } else return;
    event.preventDefault();
  });

  deck.addEventListener("click", (event) => {
    if (event.target.closest("a, button, input, select, textarea, summary"))
      return;
    if (getSelection()?.toString()) return;
    const box = deck.getBoundingClientRect();
    go(open + (event.clientX < box.left + box.width / 3 ? -1 : 1));
  });

  /**
   * A slide clips what does not fit, and nothing else on screen says so. Every slide is
   * measured once, drawn or not, and the bar names the ones that are cut.
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

  addEventListener("resize", fit);
  addEventListener("fullscreenchange", fit);
  addEventListener("hashchange", toHash);
  toHash();
  fit();
  checkFit();
  document.fonts?.ready.then(checkFit);
})();
