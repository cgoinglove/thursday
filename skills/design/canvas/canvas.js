// The canvas under the shell's head: the surface pans and zooms (drag or wheel to move,
// pinch or cmd-wheel to zoom about the pointer, +/-/0/1 from the keyboard), the rail picks
// whether a press picks a board or only moves the surface, the list on the left holds
// every board small, and the board that is picked shows what it is really made of on the
// right. It opens fitted, because the app draws this file at 1024px wide and does not
// scroll it: at 1:1 a canvas of boards would show one corner. The reader can pin notes
// of their own on it, which the app keeps in the file for the bot to read.
(() => {
  // Printing wants what the renderer wants: the boards flat, at true size
  addEventListener("beforeprint", () => document.body.classList.add("shot"));
  addEventListener("afterprint", () => document.body.classList.remove("shot"));
  // The renderer opens a flat copy of this file with the boards alone at true size.
  if (document.body.classList.contains("shot")) return;

  const field = document.getElementById("field");
  const stage = document.getElementById("stage");
  const out = document.getElementById("at");
  const hover = document.getElementById("hover");
  const ring = document.getElementById("pick");
  const spec = document.getElementById("spec");
  const layers = document.getElementById("layer-list");
  const png = document.getElementById("png");
  const MIN = 0.05;
  const MAX = 4;
  const PAD = shell.face ? 16 : 48;
  const DRAG = 4; // px a press travels before it is a drag and not a pick

  let z = 1;
  let x = 0;
  let y = 0;
  let own = false; // the view is the reader's once they move it; resizing stops refitting
  let pictures = false; // whether the renderer left board-NN.png beside this file

  const boards = () => [...stage.querySelectorAll(".frame")];
  /** A board's name, as its strip said it before the canvas added anything to the strip. */
  const names = new WeakMap();
  const nameOf = (frame) =>
    names.get(frame) ||
    frame.querySelector("h2")?.textContent?.trim() ||
    `Board ${boards().indexOf(frame) + 1}`;
  const sizeOf = (frame) => ({
    w: Number(frame.style.getPropertyValue("--w")) || frame.offsetWidth,
    h: Number(frame.style.getPropertyValue("--h")) || 0,
  });
  const pictureOf = (n) => `board-${String(n + 1).padStart(2, "0")}.png`;

  /* ── the view ────────────────────────────────────────────────────────────── */

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
    // A ring drawn on the surface divides by this to stay the same on screen (canvas.css)
    stage.style.setProperty("--cv-z", String(z));
    if (out) out.value = `${Math.round(z * 100)}%`;
    dots();
    hover.hidden = true;
    hovered = null;
    placeRing();
  };

  /** What the boards — and, opened, their notes — cover, in surface px. */
  const bounds = () => {
    const box = { l: Infinity, t: Infinity, r: -Infinity, b: -Infinity };
    // A face shows the boards alone, so only they are fitted
    for (const el of stage.querySelectorAll(
      shell.face ? ".frame" : ".frame, .note",
    )) {
      const l = Number(el.style.getPropertyValue("--x")) || 0;
      const t = Number(el.style.getPropertyValue("--y")) || 0;
      box.l = Math.min(box.l, l);
      box.t = Math.min(box.t, t);
      box.r = Math.max(box.r, l + el.offsetWidth);
      box.b = Math.max(box.b, t + el.offsetHeight);
    }
    return box.l === Infinity ? null : box;
  };

  const clamp = (n) => Math.min(MAX, Math.max(MIN, n));

  /** A box of the surface as large as the field takes it, centred. */
  const frameIn = (l, t, w, h) => {
    const fw = field.clientWidth;
    const fh = field.clientHeight;
    z = clamp(Math.min((fw - PAD * 2) / w, (fh - PAD * 2) / h, 1));
    x = (fw - w * z) / 2 - l * z;
    y = (fh - h * z) / 2 - t * z;
    draw();
  };

  const fit = () => {
    const box = bounds();
    if (box) frameIn(box.l, box.t, box.r - box.l, box.b - box.t);
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

  const center = () => [field.clientWidth / 2, field.clientHeight / 2];
  /** Pointer coordinates as the field sees them. */
  const local = (event) => {
    const box = field.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };

  /* ── picking a board ─────────────────────────────────────────────────────── */

  let at = -1;

  /** The ring over the picked board, in screen px: thin at any zoom, never inside the board. */
  const placeRing = () => {
    const frame = boards()[at];
    const board = frame?.querySelector(".board");
    if (!board) {
      ring.hidden = true;
      return;
    }
    const box = board.getBoundingClientRect();
    const fieldBox = field.getBoundingClientRect();
    ring.hidden = false;
    ring.style.left = `${box.left - fieldBox.left - 2}px`;
    ring.style.top = `${box.top - fieldBox.top - 2}px`;
    ring.style.width = `${box.width + 4}px`;
    ring.style.height = `${box.height + 4}px`;
  };

  const say = () => {
    const seat = document.getElementById("seat");
    if (!seat) return;
    const all = boards();
    seat.textContent =
      at < 0 || !all[at] ? "" : `${nameOf(all[at])} · ${at + 1}/${all.length}`;
  };

  /** The picked board's values, in the pane on the right and in the export menu. */
  const describePicked = () => {
    const all = boards();
    const frame = all[at];
    for (const [n, row] of [...layers.children].entries())
      row.classList.toggle("cv-on", n === at);
    for (const one of all) one.classList.toggle("picked", one === frame);
    placeRing();
    for (const button of document.querySelectorAll(".sh-list [data-copy-spec]"))
      button.hidden = !frame;
    if (png) {
      png.hidden = !frame || !pictures;
      if (frame) png.href = pictureOf(at);
    }
    if (!frame) {
      spec.hidden = true;
      return;
    }
    const read = readSpec(frame);
    document.getElementById("spec-name").textContent = nameOf(frame);
    const list = document.getElementById("spec-list");
    list.replaceChildren();
    const row = (label, value) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      if (typeof value === "string") dd.textContent = value;
      else dd.append(...value);
      list.append(dt, dd);
    };
    row("Size", `${read.w} × ${read.h}`);
    if (read.colours.length)
      row(
        "Colours",
        read.colours.slice(0, 6).flatMap((colour) => {
          const swatch = document.createElement("i");
          swatch.style.background = colour;
          const code = document.createElement("span");
          code.textContent = colour.toUpperCase();
          return [swatch, code];
        }),
      );
    if (read.families.length) row("Type", read.families.join(", "));
    if (read.sizes.length) row("Sizes", `${read.sizes.join(" / ")} px`);
    if (read.weights.length) row("Weights", read.weights.join(" · "));
    if (read.radii.length) row("Radius", `${read.radii.join(" · ")} px`);
    if (read.gaps.length) row("Gaps", `${read.gaps.join(" · ")} px`);
    spec.hidden = false;
  };

  const pick = (n) => {
    // A pick holds the view where it is: the pane it opens takes width from the field,
    // and a refit then would move the board out from under the pointer that picked it
    own = true;
    at = n;
    say();
    describePicked();
    const frame = boards()[at];
    if (frame?.id) shell.address(`#${frame.id}`);
  };

  const unpick = () => {
    at = -1;
    say();
    describePicked();
    if (location.hash) shell.address(location.pathname + location.search);
  };

  /**
   * One board at a time, the way a canvas is read when it is time to choose: the arrow
   * keys walk them in the order they were written and bring each one up on its own,
   * `0` or Esc puts them all back side by side. Without this a reader drags and zooms
   * by hand to compare two boards that are a screen apart.
   */
  const show = (n) => {
    const all = boards();
    if (!all.length) return;
    const to = (n + all.length) % all.length;
    const frame = all[to];
    own = true;
    // Picked first: the pane that opens on the right takes room the fit must know about
    pick(to);
    frameIn(
      Number(frame.style.getPropertyValue("--x")) || 0,
      Number(frame.style.getPropertyValue("--y")) || 0,
      frame.offsetWidth,
      frame.offsetHeight,
    );
  };

  const step = (by) => show(at < 0 ? (by > 0 ? 0 : -1) : at + by);

  /** Every board back side by side, the way the canvas opened. */
  const fitAll = () => {
    unpick();
    own = false;
    fit();
  };

  /** The board the address names, when it names one. */
  const named = () =>
    boards().findIndex(
      (frame) =>
        frame.id && frame.id === decodeURIComponent(location.hash.slice(1)),
    );

  /* ── the rail ────────────────────────────────────────────────────────────── */

  const setTool = (tool) => {
    document.body.dataset.tool = tool;
    for (const button of document.querySelectorAll("[data-tool]"))
      button.classList.toggle("sh-on", button.dataset.tool === tool);
  };
  for (const button of document.querySelectorAll("[data-tool]"))
    button.addEventListener("click", () => setTool(button.dataset.tool));
  setTool("select");

  const listButton = document.querySelector("[data-layers]");
  listButton?.addEventListener("click", () => {
    const off = document.body.classList.toggle("cv-no-layers");
    listButton.classList.toggle("sh-on", !off);
    listButton.setAttribute("aria-pressed", String(!off));
  });

  /* ── the surface ─────────────────────────────────────────────────────────── */

  /**
   * A link from one board to another — `<a href="#next">` inside a board, to the frame
   * with that id — brings that board up. It is how a mockup is walked through: the
   * button on one screen leads to the screen it opens. Any other link keeps its meaning.
   */
  stage.addEventListener("click", (event) => {
    const link =
      event.target instanceof Element && event.target.closest("a[href^='#']");
    if (!link) return;
    const to = boards().findIndex(
      (frame) =>
        frame.id &&
        frame.id === decodeURIComponent(link.getAttribute("href").slice(1)),
    );
    if (to === -1) return;
    event.preventDefault();
    show(to);
  });

  field.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        zoomAt(z * Math.exp(-event.deltaY / 320), ...local(event));
        return;
      }
      x -= event.deltaX;
      y -= event.deltaY;
      own = true;
      draw();
    },
    { passive: false },
  );

  // Drag to pan; two fingers to pinch. Pointer events cover mouse, pen and touch. A press
  // that never became a drag is a pick, when the tool is the arrow.
  const down = new Map();
  let pinch = 0;
  let travel = 0;
  let dragging = false;
  let pressed = null;
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
    // control drawn on it. Anything clickable keeps its own press, and so do the words
    // of a note being written in.
    if (
      event.target instanceof Element &&
      event.target.closest(
        "button, a, input, select, textarea, label, summary, [contenteditable], .cv-zoom, .cv-hover",
      )
    )
      return;
    const note =
      event.target instanceof Element
        ? event.target.closest(".note.sticky")
        : null;
    if (note && document.body.dataset.tool === "select" && !shell.face) {
      moving = {
        note,
        id: event.pointerId,
        from: [event.clientX, event.clientY],
        at: [
          Number(note.style.getPropertyValue("--x")) || 0,
          Number(note.style.getPropertyValue("--y")) || 0,
        ],
        was: snapshot(),
        travel: 0,
      };
      // Held only once it is a drag: held from the press, the clicks that open it for its
      // words would land on the surface instead
      return;
    }
    field.setPointerCapture(event.pointerId);
    down.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (down.size === 2) pinch = span();
    travel = 0;
    dragging = false;
    pressed =
      event.target instanceof Element ? event.target.closest(".frame") : null;
  });

  field.addEventListener("pointermove", (event) => {
    if (moving && event.pointerId === moving.id) {
      moving.travel = Math.hypot(
        event.clientX - moving.from[0],
        event.clientY - moving.from[1],
      );
      if (moving.travel < DRAG) return;
      if (!field.hasPointerCapture(moving.id))
        field.setPointerCapture(moving.id);
      const [nx, ny] = moving.at;
      moving.note.style.setProperty(
        "--x",
        String(Math.round(nx + (event.clientX - moving.from[0]) / z)),
      );
      moving.note.style.setProperty(
        "--y",
        String(Math.round(ny + (event.clientY - moving.from[1]) / z)),
      );
      return;
    }
    const was = down.get(event.pointerId);
    if (!was) return;
    const now = { x: event.clientX, y: event.clientY };
    down.set(event.pointerId, now);
    if (down.size === 2) {
      const wide = span();
      if (pinch > 0) {
        const box = field.getBoundingClientRect();
        const [cx, cy] = middle();
        zoomAt(z * (wide / pinch), cx - box.left, cy - box.top);
      }
      pinch = wide;
      return;
    }
    travel += Math.hypot(now.x - was.x, now.y - was.y);
    // A press does not move the surface until it is plainly a drag, so a click on a
    // board never nudges the view and never takes it over from the fit
    if (!dragging && travel < DRAG) return;
    if (!dragging) {
      dragging = true;
      field.classList.add("cv-dragging");
    }
    own = true;
    x += now.x - was.x;
    y += now.y - was.y;
    draw();
  });

  const up = (event) => {
    if (moving && event.pointerId === moving.id) {
      const { note, travel, was } = moving;
      moving = null;
      if (travel >= DRAG) {
        remember(was);
        changed();
      } else pickNote(note);
      return;
    }
    // A press on a control drawn on the surface (the zoom, a board's buttons) was never
    // the surface's: letting it go is not a click on empty space, which would unpick
    if (!down.has(event.pointerId)) return;
    down.delete(event.pointerId);
    if (down.size < 2) pinch = 0;
    if (down.size) return;
    field.classList.remove("cv-dragging");
    if (!dragging && document.body.dataset.tool === "select") {
      pickNote(null);
      if (pressed) pick(boards().indexOf(pressed));
      else unpick();
    }
    if (!dragging && document.body.dataset.tool === "note") pin(event);
    pressed = null;
    dragging = false;
  };
  field.addEventListener("pointerup", up);
  field.addEventListener("pointercancel", up);

  /* Over a board: open it alone, or its picture — over the board's corner as the field
     sees it, and gone as soon as the surface moves. */
  let hovered = null;
  stage.addEventListener("pointerover", (event) => {
    if (down.size || shell.face) return;
    const frame =
      event.target instanceof Element && event.target.closest(".frame");
    if (!frame || frame === hovered) return;
    hovered = frame;
    const n = boards().indexOf(frame);
    const picture = hover.querySelector("[data-hover=png]");
    picture.href = pictureOf(n);
    picture.hidden = !pictures;
    hover.querySelector("[data-hover=open]").onclick = () => show(n);
    // Placed once what it holds is known, so its own width is the one it will have
    hover.hidden = false;
    const box = (
      frame.querySelector(".board") ?? frame
    ).getBoundingClientRect();
    const fieldBox = field.getBoundingClientRect();
    hover.style.left = `${Math.max(6, Math.min(box.right - fieldBox.left, fieldBox.width) - hover.offsetWidth - 6)}px`;
    hover.style.top = `${Math.max(6, box.top - fieldBox.top + 6)}px`;
  });
  const leave = (to) => {
    if (to && (to.closest(".frame") === hovered || to.closest(".cv-hover")))
      return;
    hovered = null;
    hover.hidden = true;
  };
  stage.addEventListener("pointerout", (event) =>
    leave(event.relatedTarget instanceof Element ? event.relatedTarget : null),
  );
  hover.addEventListener("pointerleave", (event) =>
    leave(event.relatedTarget instanceof Element ? event.relatedTarget : null),
  );
  field.addEventListener("pointerleave", () => leave(null));

  /* ── notes ───────────────────────────────────────────────────────────────── */

  /*
   * The reader pins notes of their own: Note on the rail, then a click where one goes.
   * A note moves by dragging, opens for its words with a double click, and Delete takes
   * a picked one away. It is a sticky marked as theirs (`data-by="user"`) among what the
   * bot wrote, so the bot reads it when it next gets the canvas. The app keeps every
   * change (shell.edits), and ⌘Z takes one back.
   */
  const stickies = () => [...stage.querySelectorAll(".note.sticky")];
  const changed = () => shell.edits.changed();

  /** Where the put marks close: a note goes in before it, among what the bot wrote. */
  const endMark = () =>
    [...stage.childNodes].find(
      (node) =>
        node.nodeType === Node.COMMENT_NODE && /^ put: end\b/.test(node.data),
    ) ?? null;

  /** The stickies as the file keeps them, for taking a change back. */
  const snapshot = () =>
    stickies()
      .map((note) => {
        const copy = note.cloneNode(true);
        copy.classList.remove("cv-note-on");
        copy.removeAttribute("contenteditable");
        return copy.outerHTML;
      })
      .join("\n");
  const past = [];
  const future = [];
  const remember = (was = snapshot()) => {
    past.push(was);
    if (past.length > 100) past.shift();
    future.length = 0;
  };
  const restore = (html) => {
    for (const note of stickies()) note.remove();
    const box = document.createElement("template");
    box.innerHTML = html;
    stage.insertBefore(box.content, endMark());
    noteOn = null;
    changed();
  };

  let moving = null; // a note being dragged
  let noteOn = null; // the note picked, which Delete takes away
  let fresh = null; // a note just pinned, until the caret leaves it
  let before = null; // the stickies as a note being written in found them

  const pickNote = (note) => {
    noteOn?.classList.remove("cv-note-on");
    noteOn = note;
    note?.classList.add("cv-note-on");
  };

  /** A note opened for its words, the caret after them; the view stays where it is. */
  const writeIn = (note) => {
    pickNote(null);
    try {
      note.contentEditable = "plaintext-only";
    } catch {
      note.contentEditable = "true";
    }
    note.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(note);
    range.collapse(false);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  };

  /**
   * A note pinned where the surface was pressed, open for its words. It is the size that
   * reads at the zoom it was written at (`--s`): pinned over a canvas zoomed out to see
   * every board, it is not a speck.
   */
  const pin = (event) => {
    const box = field.getBoundingClientRect();
    const scale = Math.min(4, Math.max(1, Math.round(10 / z) / 10));
    const note = document.createElement("p");
    note.className = "note sticky";
    note.dataset.by = "user";
    note.style.cssText = `--x: ${Math.round((event.clientX - box.left - x) / z)}; --y: ${Math.round((event.clientY - box.top - y) / z)}; --w: ${Math.round(240 * scale)}; --s: ${scale}`;
    remember();
    stage.insertBefore(note, endMark());
    own = true;
    setTool("select");
    fresh = note;
    before = null;
    writeIn(note);
  };

  stage.addEventListener("dblclick", (event) => {
    const note =
      event.target instanceof Element && event.target.closest(".note.sticky");
    if (!note || shell.face || note.hasAttribute("contenteditable")) return;
    event.preventDefault();
    before = snapshot();
    writeIn(note);
  });
  // Esc closes a note; Enter is a new line in it
  stage.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const note = event.target.closest?.(".note.sticky");
    if (!note?.hasAttribute("contenteditable")) return;
    event.preventDefault();
    event.stopPropagation();
    note.blur();
  });
  stage.addEventListener("input", (event) => {
    if (!event.target.closest?.(".note.sticky")) return;
    if (before !== null) remember(before);
    before = null;
    changed();
  });
  // Leaving a note closes it; one left with no words goes, and one pinned and left empty
  // was never there
  stage.addEventListener("focusout", (event) => {
    const note = event.target.closest?.(".note.sticky");
    if (!note?.hasAttribute("contenteditable")) return;
    note.removeAttribute("contenteditable");
    before = null;
    const empty = !note.textContent.trim();
    if (note === fresh) {
      fresh = null;
      if (!empty) return;
      note.remove();
      past.pop();
      return;
    }
    if (!empty) return;
    note.remove();
    changed();
  });

  addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const on = event.target;
    if (
      on instanceof HTMLElement &&
      on.closest("input, textarea, select, [contenteditable]")
    )
      return;
    const key = event.key.toLowerCase();
    const again =
      (key === "z" && event.shiftKey) || (key === "y" && !event.metaKey);
    if (key !== "z" && !again) return;
    const from = again ? future : past;
    if (!from.length) return;
    event.preventDefault();
    (again ? past : future).push(snapshot());
    restore(from.pop());
  });

  addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const on = event.target;
    if (
      on instanceof HTMLElement &&
      on.closest("input, textarea, select, [contenteditable]")
    )
      return;
    if ((event.key === "Delete" || event.key === "Backspace") && noteOn) {
      remember();
      noteOn.remove();
      noteOn = null;
      changed();
    } else if (event.key === "0" || event.key === "Escape") {
      pickNote(null);
      fitAll();
    } else if (event.key === "1") zoomAt(1, ...center());
    else if (event.key === "+" || event.key === "=")
      zoomAt(z * 1.25, ...center());
    else if (event.key === "-") zoomAt(z / 1.25, ...center());
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") step(1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") step(-1);
    else if (event.key === "v" || event.key === "V") setTool("select");
    else if (event.key === "h" || event.key === "H") setTool("hand");
    else if ((event.key === "n" || event.key === "N") && !shell.face)
      setTool("note");
    else return;
    event.preventDefault();
  });

  for (const button of document.querySelectorAll("[data-zoom]"))
    button.addEventListener("click", () => {
      const how = button.dataset.zoom;
      if (how === "fit") fitAll();
      else zoomAt(z * (how === "in" ? 1.25 : 0.8), ...center());
    });

  // The field changes size with the window and with the panes beside it: refit while the
  // view is still the canvas's, and keep the ring on its board either way
  new ResizeObserver(() => {
    if (own) placeRing();
    else fit();
  }).observe(field);

  /**
   * A board clips what does not fit, and its picture comes out the right size either
   * way, so overflow is the one mistake nothing else reports. Count it here, where it
   * is drawn: whoever opens the canvas sees which board is cut before anyone chooses.
   * Only the boards on the surface: the list holds copies of them.
   */
  const checkFit = () => {
    let cut = 0;
    for (const frame of boards()) {
      const board = frame.querySelector(":scope > .board");
      if (!board) continue;
      const over =
        board.scrollWidth > board.clientWidth + 1 ||
        board.scrollHeight > board.clientHeight + 1;
      frame.classList.toggle("cut", over);
      if (over) cut++;
    }
    const badge = document.getElementById("cut");
    if (badge) {
      badge.hidden = cut === 0;
      badge.textContent =
        cut === 1 ? "1 board is cut" : `${cut} boards are cut`;
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
    const board = frame.querySelector(":scope > .board");
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
      // Type is what sets words: a radio button's face is the browser's, not the design's
      if (el.textContent?.trim()) {
        if (look.fontFamily)
          add(
            families,
            look.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
          );
        if (look.fontSize) sizes.add(px(look.fontSize));
        if (look.fontWeight) weights.add(look.fontWeight);
      }
      if (px(look.borderTopLeftRadius)) radii.add(px(look.borderTopLeftRadius));
      if (px(look.rowGap)) gaps.add(px(look.rowGap));
      if (px(look.columnGap)) gaps.add(px(look.columnGap));
    }
    const num = (set) => [...set].sort((a, b) => a - b);
    const size = sizeOf(frame);
    return {
      w: size.w,
      h: size.h || board.clientHeight,
      colours: byUse(colours, 10),
      families: byUse(families, 3),
      sizes: num(sizes).reverse(),
      weights: num(new Set([...weights].map(Number))),
      radii: num(radii),
      gaps: num(gaps),
    };
  };

  /** The chosen board as an instruction: what it is, what it costs, and its values. */
  const specText = (frame, read) => {
    const note = [...stage.querySelectorAll(".note")].find(
      (one) =>
        Number(one.style.getPropertyValue("--x")) ===
        Number(frame.style.getPropertyValue("--x")),
    );
    const list = (label, values, join = " · ") =>
      values.length ? `**${label}** ${values.join(join)}\n` : "";
    return (
      `## ${nameOf(frame)}\n${read.w}×${read.h}\n\n` +
      (note ? `${note.textContent.trim()}\n\n` : "") +
      list("Colours", read.colours) +
      list(
        "Type",
        [
          read.families.join(", "),
          `${read.sizes.join("/")}px`,
          read.weights.join(" · "),
        ].filter(Boolean),
        "  ",
      ) +
      list(
        "Radius",
        read.radii.map((n) => `${n}px`),
      ) +
      list(
        "Gaps",
        read.gaps.map((n) => `${n}px`),
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
    shell.say(button.querySelector("span"), "Copied");
  };
  for (const button of document.querySelectorAll("[data-copy-spec]"))
    button.addEventListener("click", () => {
      const frame = boards()[at];
      if (frame) copy(specText(frame, readSpec(frame)), button);
    });

  /**
   * The swatches on each name strip, and the list of boards — added here, so a board's
   * markup stays the design. A face has neither.
   */
  const describe = () => {
    const all = boards();
    document.getElementById("boards-count").textContent = String(all.length);
    if (shell.face) return;
    const rows = all.map((frame, n) => {
      const strip = frame.querySelector(":scope > h2");
      if (strip && !names.has(frame))
        names.set(frame, strip.textContent.trim());
      const read = readSpec(frame);
      if (strip && read && !strip.querySelector(".swatches")) {
        const swatches = document.createElement("span");
        swatches.className = "swatches";
        for (const colour of read.colours.slice(0, 8)) {
          const dot = document.createElement("i");
          dot.style.background = colour;
          dot.title = colour;
          dot.addEventListener("click", (event) => {
            event.stopPropagation();
            copy(colour, dot);
          });
          swatches.append(dot);
        }
        strip.append(swatches);
      }
      const row = document.createElement("button");
      row.type = "button";
      const board = frame.querySelector(":scope > .board");
      const size = sizeOf(frame);
      row.setAttribute("aria-label", `${nameOf(frame)}, ${size.w}×${size.h}`);
      if (board && size.w && size.h)
        row.append(shell.thumb(board, 44, 28, size.w, size.h).box);
      const name = document.createElement("span");
      name.className = "cv-name";
      name.textContent = nameOf(frame);
      const dims = document.createElement("em");
      dims.className = "cv-dims";
      dims.textContent = `${size.w}×${size.h}`;
      row.append(name, dims);
      row.addEventListener("click", () => show(n));
      return row;
    });
    layers.replaceChildren(...rows);
  };

  // What the file keeps of itself: the boards as written, never the reader's view
  shell.clean = (copy) => {
    copy.querySelector("#layer-list")?.replaceChildren();
    copy.querySelector("#spec")?.setAttribute("hidden", "");
    copy.querySelector("#hover")?.setAttribute("hidden", "");
    copy.querySelector("#pick")?.setAttribute("hidden", "");
    for (const id of ["stage", "field", "pick", "hover"])
      copy.querySelector(`#${id}`)?.removeAttribute("style");
    copy.querySelector("body")?.removeAttribute("data-tool");
    copy.querySelector("body")?.classList.remove("cv-no-layers");
    for (const frame of copy.querySelectorAll(".frame"))
      frame.classList.remove("picked", "cut");
    for (const note of copy.querySelectorAll(".note.sticky")) {
      note.classList.remove("cv-note-on");
      note.removeAttribute("contenteditable");
    }
    for (const el of copy.querySelectorAll(".swatches")) el.remove();
  };

  // Opens on the board the address names, else fitted to the whole canvas. Fonts change
  // how tall a note is, and the fit is measured from that.
  const open = () => (named() === -1 ? fit() : show(named()));
  addEventListener("hashchange", open);
  describe();
  open();
  checkFit();
  if (!shell.face)
    shell.probe(pictureOf(0)).then((there) => {
      pictures = there;
      describePicked();
    });
  document.fonts?.ready.then(() => {
    if (own) placeRing();
    else fit();
    checkFit();
  });
})();
