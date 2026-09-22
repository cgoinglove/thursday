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

  /**
   * The surface's dots, drawn on the field rather than the stage so they never scale
   * into blobs: the step doubles or halves until it sits in a readable band, which is
   * what makes zooming feel like moving over a surface instead of resizing a picture.
   */
  const dots = () => {
    let step = 32 * z;
    while (step < 18) step *= 2;
    while (step > 72) step /= 2;
    field.style.backgroundSize = `${step}px ${step}px`;
    field.style.backgroundPosition = `${x % step}px ${y % step}px`;
  };

  const draw = () => {
    stage.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    if (out) out.value = `${Math.round(z * 100)}%`;
    dots();
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

  /**
   * One board at a time, the way a canvas is read when it is time to choose: the arrow
   * keys walk them in the order they were written and bring each one up on its own,
   * `0` or Esc puts them all back side by side. Without this a reader drags and zooms
   * by hand to compare two boards that are a screen apart.
   */
  const boards = () => [...document.querySelectorAll(".frame")];
  let at = -1;

  const say = () => {
    const seat = document.getElementById("seat");
    if (!seat) return;
    const all = boards();
    seat.textContent =
      at < 0 || !all[at]
        ? ""
        : `${all[at].dataset.name || all[at].querySelector("h2")?.textContent?.trim() || `board ${at + 1}`} · ${at + 1}/${all.length}`;
  };

  /** Brings board `n` up alone, as large as the window takes it. */
  const show = (n) => {
    const all = boards();
    if (!all.length) return;
    at = (n + all.length) % all.length;
    const frame = all[at];
    const l = Number(frame.style.getPropertyValue("--x")) || 0;
    const t = Number(frame.style.getPropertyValue("--y")) || 0;
    const w = frame.offsetWidth;
    const h = frame.offsetHeight;
    const top = (document.querySelector("header")?.offsetHeight ?? 0) + PAD;
    z = clamp(
      Math.min((innerWidth - PAD * 2) / w, (innerHeight - top - PAD) / h, 1),
    );
    x = (innerWidth - w * z) / 2 - l * z;
    y = top + (innerHeight - top - PAD - h * z) / 2 - t * z;
    own = true;
    draw();
    say();
  };

  const step = (by) => show(at < 0 ? (by > 0 ? 0 : -1) : at + by);

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
    // The surface captures the pointer to pan, which would swallow a press on a
    // control drawn on it. Anything clickable keeps its own press.
    if (event.target instanceof Element && event.target.closest("button, a, i"))
      return;
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
    if (event.key === "0" || event.key === "Escape") {
      at = -1;
      fit();
      say();
    } else if (event.key === "1") zoomAt(1, ...center());
    else if (event.key === "+" || event.key === "=")
      zoomAt(z * 1.25, ...center());
    else if (event.key === "-") zoomAt(z / 1.25, ...center());
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") step(1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") step(-1);
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

  /* What a board is made of, read off the page rather than written by hand: the
     values it really paints, so the swatches and the spec cannot disagree with it. */

  const hex = (value) => {
    const rgb = value.match(
      /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/,
    );
    if (!rgb) return value;
    if (rgb[4] !== undefined && Number(rgb[4]) === 0) return null; // fully transparent
    const pair = (n) => Number(n).toString(16).padStart(2, "0");
    return `#${pair(rgb[1])}${pair(rgb[2])}${pair(rgb[3])}`;
  };

  /** Most used first, so a palette reads as the design ranks it. */
  const byUse = (counts, cap) =>
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, cap)
      .map(([value]) => value);

  const px = (value) => Math.round(Number.parseFloat(value) || 0);

  const readSpec = (frame) => {
    const board = frame.querySelector(".board");
    if (!board) return null;
    const colours = new Map();
    const families = new Map();
    const sizes = new Set();
    const weights = new Set();
    const radii = new Set();
    const gaps = new Set();
    const add = (map, key) => key && map.set(key, (map.get(key) ?? 0) + 1);

    for (const el of [board, ...board.querySelectorAll("*")]) {
      // The board is the frame this file draws: its border, backdrop and corners are
      // the canvas, not the design — and on the leading one that border is the accent.
      // Inside it everything is the design's, so only the board is read for what the
      // design put on it itself.
      const look = el === board ? el.style : getComputedStyle(el);
      add(colours, hex(look.color));
      add(colours, hex(look.backgroundColor));
      if (px(look.borderTopWidth)) add(colours, hex(look.borderTopColor));
      // `fill` computes to black on every element, so only a drawing's own counts
      if (el instanceof SVGElement) {
        if (look.fill && look.fill !== "none") add(colours, hex(look.fill));
        if (look.stroke && look.stroke !== "none")
          add(colours, hex(look.stroke));
      }
      if (look.fontFamily)
        add(
          families,
          look.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
        );
      if (el.textContent?.trim()) {
        if (look.fontSize) sizes.add(px(look.fontSize));
        if (look.fontWeight) weights.add(look.fontWeight);
      }
      if (px(look.borderTopLeftRadius)) radii.add(px(look.borderTopLeftRadius));
      if (px(look.rowGap)) gaps.add(px(look.rowGap));
      if (px(look.columnGap)) gaps.add(px(look.columnGap));
    }
    const num = (set) => [...set].sort((a, b) => a - b);
    return {
      w: Number(frame.style.getPropertyValue("--w")) || board.clientWidth,
      h: Number(frame.style.getPropertyValue("--h")) || board.clientHeight,
      colours: byUse(colours, 10),
      families: byUse(families, 3),
      sizes: num(sizes).reverse(),
      weights: num(new Set([...weights].map(Number))),
      radii: num(radii),
      gaps: num(gaps),
    };
  };

  /** The chosen board as an instruction: what it is, what it costs, and its values. */
  const specText = (frame, spec) => {
    const name = frame.dataset.name ?? "Board";
    const note = [...document.querySelectorAll(".note")].find(
      (one) =>
        Number(one.style.getPropertyValue("--x")) ===
        Number(frame.style.getPropertyValue("--x")),
    );
    const list = (label, values, join = " · ") =>
      values.length ? `**${label}** ${values.join(join)}\n` : "";
    return (
      `## ${name}\n${spec.w}×${spec.h}\n\n` +
      (note ? `${note.textContent.trim()}\n\n` : "") +
      list("Colours", spec.colours) +
      list(
        "Type",
        [
          spec.families.join(", "),
          `${spec.sizes.join("/")}px`,
          spec.weights.join(" · "),
        ].filter(Boolean),
        "  ",
      ) +
      list(
        "Radius",
        spec.radii.map((n) => `${n}px`),
      ) +
      list(
        "Gaps",
        spec.gaps.map((n) => `${n}px`),
      )
    );
  };

  const copy = async (text, button) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // A canvas opened from disk has no clipboard permission; the old way still works
      const box = document.createElement("textarea");
      box.value = text;
      document.body.append(box);
      box.select();
      document.execCommand("copy");
      box.remove();
    }
    const was = button.textContent;
    button.textContent = "copied";
    setTimeout(() => {
      button.textContent = was;
    }, 1200);
  };

  /** The swatches and the button are added here, so a board's markup stays the design. */
  const describe = () => {
    for (const frame of document.querySelectorAll(".frame")) {
      const strip = frame.querySelector("h2");
      if (!strip || strip.querySelector(".swatches")) continue;
      const spec = readSpec(frame);
      if (!spec) continue;
      // Kept before anything is added to the strip, so the name stays the name
      frame.dataset.name = strip.textContent.trim();

      const swatches = document.createElement("span");
      swatches.className = "swatches";
      for (const colour of spec.colours.slice(0, 8)) {
        const dot = document.createElement("i");
        dot.style.background = colour;
        dot.title = colour;
        dot.addEventListener("click", (event) => {
          event.stopPropagation();
          navigator.clipboard?.writeText(colour).catch(() => {});
        });
        swatches.append(dot);
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "spec";
      button.textContent = "spec";
      button.title = "Copy this board as an instruction";
      button.addEventListener("click", () =>
        copy(specText(frame, readSpec(frame)), button),
      );

      strip.append(swatches, button);
    }
  };

  // Fonts change how tall a note is, and the fit is measured from that.
  fit();
  checkFit();
  describe();
  document.fonts?.ready.then(() => {
    if (!own) fit();
    checkFit();
    describe();
  });
})();
