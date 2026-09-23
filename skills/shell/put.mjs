// What a bot writes into a page one of the three scripts made (deck.mjs, canvas.mjs,
// page.mjs `put`): the slides, the boards or the document's body, set between the marks
// the page was written with. Only that part is ever replaced, so the frame around it —
// the head, the tools, the script — cannot be lost by writing the page whole.

const START = "<!-- put: start -->";
const END = "<!-- put: end -->";

/**
 * `html` with `content` in place of what stands between its marks, or null when it has
 * none: a page written before the marks, or written over whole since.
 */
export function putBetween(html, content) {
  const from = html.indexOf(START);
  const to = html.indexOf(END, from);
  if (from === -1 || to === -1) return null;
  return `${html.slice(0, from + START.length)}\n${content.trim()}\n${html.slice(to)}`;
}

/** Why `content` cannot be put, or null: it must be the inside of a page, not a whole one. */
export function notInside(content) {
  if (!content.trim()) return "is empty";
  if (/<(!doctype|html|head|body)\b/i.test(content))
    return "is a whole page: give only what goes inside it";
  return null;
}
