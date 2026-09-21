// Panning and zooming the surface: drag or wheel to move, pinch or cmd-wheel to
// zoom about the pointer, +/-/0/1 from the keyboard. It opens fitted, because the
// app draws this file at 1024px wide and does not scroll it: at 1:1 a canvas of
// boards would show one corner.
(() => {
  // The renderer opens a flat copy of this file with the boards alone at true size.
  if (document.body.classList.contains("shot")) return;

  const stage = document.getElementById("stage");
  const field = document.getElementById("field");
  const out = document.getElementById("at");
  const MIN = 0.05;
  const MAX = 4;
  const PAD = 48;

  let z = 1;
  let x = 0;
  let y = 0;
  let own = false; // the view is the reader's once they move it; resizing stops refitting

  const draw = () => {
    stage.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    if (out) out.value = `${Math.round(z * 100)}%`;
  };

  /** What the boards and notes cover, in surface px. */
  const bounds = () => {
    const box = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
    for (const el of document.querySelectorAll(".frame, .note")) {
      const l = Number(el.style.getPropertyValue("--x")) || 0;
      const t = Number(el.style.getPropertyValue("--y")) || 0;
      box.l = Math.min(box.l, l);
      box.t = Math.min(box.t, t);
      box.r = Math.max(box.r, l + el.offsetWidth);
      box.b = Math.max(box.b, t + el.offsetHeight);
    }
    if (box.l === Infinity) return null;
    return box;
  };

  const clamp = (n) => Math.min(MAX, Math.max(MIN, n));

  const fit = () => {
    const box = bounds();
    if (!box) return;
    const w = box.r - box.l;
    const h = box.b - box.t;
    const top = (document.querySelector("header")?.offsetHeight ?? 0) + PAD;
    z = clamp(
      Math.min(
        (innerWidth - PAD * 2) / w,
        (innerHeight - top - PAD) / h,
        1, // never blow a small canvas up to fill the window
      ),
    );
    x = (innerWidth - w * z) / 2 - box.l * z;
    y = top + (innerHeight - top - PAD - h * z) / 2 - box.t * z;
    draw();
  };

  /** Zoom to `next`, keeping the surface point under (cx, cy) where it is. */
  const zoomAt = (next, cx, cy) => {
    const to = clamp(next);
    x = cx - ((cx - x) * to) / z;
    y = cy - ((cy - y) * to) / z;
    z = to;
    own = true;
    draw();
  };

  const center = () => [innerWidth / 2, innerHeight / 2];

  field.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        zoomAt(z * Math.exp(-event.deltaY / 320), event.clientX, event.clientY);
        return;
      }
      x -= event.deltaX;
      y -= event.deltaY;
      own = true;
      draw();
    },
    { passive: false },
  );

  // Drag to pan; two fingers to pinch. Pointer events cover mouse, pen and touch.
  const down = new Map();
  let pinch = 0;
  const span = () => {
    const [a, b] = [...down.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const middle = () => {
    const [a, b] = [...down.values()];
    return [(a.x + b.x) / 2, (a.y + b.y) / 2];
  };

  field.addEventListener("pointerdown", (event) => {
    field.setPointerCapture(event.pointerId);
    down.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (down.size === 2) pinch = span();
    field.classList.add("dragging");
  });

  field.addEventListener("pointermove", (event) => {
    const was = down.get(event.pointerId);
    if (!was) return;
    const now = { x: event.clientX, y: event.clientY };
    down.set(event.pointerId, now);
    own = true;
    if (down.size === 2) {
      const wide = span();
      if (pinch > 0) {
        const [cx, cy] = middle();
        zoomAt(z * (wide / pinch), cx, cy);
      }
      pinch = wide;
      return;
    }
    x += now.x - was.x;
    y += now.y - was.y;
    draw();
  });

  const up = (event) => {
    down.delete(event.pointerId);
    if (down.size < 2) pinch = 0;
    if (down.size === 0) field.classList.remove("dragging");
  };
  field.addEventListener("pointerup", up);
  field.addEventListener("pointercancel", up);

  addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const on = event.target;
    if (
      on instanceof HTMLElement &&
      on.closest("input, textarea, [contenteditable]")
    )
      return;
    if (event.key === "0") fit();
    else if (event.key === "1") zoomAt(1, ...center());
    else if (event.key === "+" || event.key === "=")
      zoomAt(z * 1.25, ...center());
    else if (event.key === "-") zoomAt(z / 1.25, ...center());
    else return;
    event.preventDefault();
  });

  for (const button of document.querySelectorAll("[data-zoom]")) {
    button.addEventListener("click", () => {
      const how = button.dataset.zoom;
      if (how === "fit") fit();
      else zoomAt(z * (how === "in" ? 1.25 : 0.8), ...center());
    });
  }

  addEventListener("resize", () => {
    if (!own) fit();
  });

  /**
   * A board clips what does not fit, and its picture comes out the right size either
   * way, so overflow is the one mistake nothing else reports. Count it here, where it
   * is drawn: whoever opens the canvas sees which board is cut before anyone chooses.
   */
  const checkFit = () => {
    let cut = 0;
    for (const board of document.querySelectorAll(".board")) {
      const over =
        board.scrollWidth > board.clientWidth + 1 ||
        board.scrollHeight > board.clientHeight + 1;
      board.parentElement?.classList.toggle("cut", over);
      if (over) cut++;
    }
    const say = document.getElementById("cut");
    if (say) {
      say.hidden = cut === 0;
      say.textContent = cut === 1 ? "1 board is cut" : `${cut} boards are cut`;
    }
  };

  // Fonts change how tall a note is, and the fit is measured from that.
  fit();
  checkFit();
  document.fonts?.ready.then(() => {
    if (!own) fit();
    checkFit();
  });
})();
