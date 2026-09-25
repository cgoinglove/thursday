// Turning pages: arrows, space and Page keys, a tap on the right or left of a
// page, and the address (#3) naming the page open, so a link or a reload lands there.
(() => {
  const pages = [...document.querySelectorAll(".page")];

  // Who made it, on the cover: kept outside the pages, so a cover written anew still has it
  const maker = document.querySelector("body > .maker");
  const cover = document.querySelector(".page.cover");
  if (maker && cover) {
    cover.append(maker);
    maker.hidden = false;
  }

  // A quiz page: a pick is marked right or not, and the answer shows under it
  for (const quiz of document.querySelectorAll(".page.quiz"))
    quiz.addEventListener("click", (event) => {
      const pick = event.target.closest(".choices button");
      if (!pick) return;
      for (const one of quiz.querySelectorAll(".choices button"))
        one.removeAttribute("aria-pressed");
      pick.setAttribute("aria-pressed", "true");
      quiz.dataset.answered = pick.hasAttribute("data-right")
        ? "right"
        : "wrong";
    });
  // The video renderer takes one frame from each [data-slide]
  for (const page of pages) page.dataset.slide = "";

  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let at = 0;
  const go = (i, smooth = true) => {
    at = Math.max(0, Math.min(pages.length - 1, i));
    pages[at]?.scrollIntoView({
      behavior: smooth && !reduce.matches ? "smooth" : "instant",
    });
  };

  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        at = pages.indexOf(entry.target);
        history.replaceState(null, "", `#${at + 1}`);
      }
    },
    { threshold: 0.6 },
  );
  for (const page of pages) seen.observe(page);

  const toHash = () => {
    const n = Number(location.hash.slice(1));
    if (n >= 1) go(n - 1, false);
  };
  toHash();
  addEventListener("hashchange", toHash);

  addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const step = {
      ArrowRight: 1,
      ArrowDown: 1,
      PageDown: 1,
      " ": event.shiftKey ? -1 : 1,
      ArrowLeft: -1,
      ArrowUp: -1,
      PageUp: -1,
    }[event.key];
    if (event.key === "Home") go(0);
    else if (event.key === "End") go(pages.length - 1);
    else if (step) go(at + step);
    else return;
    event.preventDefault();
  });

  addEventListener("click", (event) => {
    if (event.target.closest("a, button, input, select, textarea, summary"))
      return;
    if (getSelection()?.toString()) return;
    go(at + (event.clientX < innerWidth / 3 ? -1 : 1));
  });
})();
