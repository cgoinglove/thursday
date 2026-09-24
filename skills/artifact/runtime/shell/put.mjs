// What a bot writes into a page one of the three scripts made (deck.mjs, canvas.mjs,
// document.mjs `put`), or a chart chart.mjs draws into one: the slides, the boards or the
// document's body, set between the marks the page was written with. Only that part is ever replaced, so the frame around it —
// the head, the tools, the script — cannot be lost by writing the page whole.
//
// The app keeps a page too: a reader's edits are saved into the same file. So the start
// mark carries a print of what stood between the marks when a bot last put or got it, and
// a put over anything else — edited in the app, or by hand, since — is refused until the
// bot has got the page as it is now. Every put also names the page's revision anew in its
// head (head.html), which is how a save from a page opened before it is told the file has
// moved on (features/workspace savePage).
import { createHash, randomBytes } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";

const START = /<!-- put: start(?: ([0-9a-f]{12}))? -->/;
export const END = "<!-- put: end -->";
const GENERATOR = '<meta name="generator" content="Thursday">';
const REVISION = /<meta name="revision" content="[^"]*">/;

/** A body's print, as the start mark keeps it. */
const print = (body) =>
  createHash("sha256").update(body.trim()).digest("hex").slice(0, 12);

/** A revision a page has not had before. */
export const revision = () => randomBytes(6).toString("hex");

/** `html` naming a new revision in its head; a page from before revisions is given one. */
export function restamp(html) {
  const meta = `<meta name="revision" content="${revision()}">`;
  if (REVISION.test(html)) return html.replace(REVISION, meta);
  return html.includes(GENERATOR)
    ? html.replace(GENERATOR, `${GENERATOR}\n${meta}`)
    : html;
}

/** The page cut at its marks, or null when it has none. */
function marked(html) {
  const start = START.exec(html);
  if (!start) return null;
  const from = start.index + start[0].length;
  const to = html.indexOf(END, from);
  if (to === -1) return null;
  return {
    before: html.slice(0, start.index),
    seen: start[1] ?? null,
    between: html.slice(from, to),
    after: html.slice(to),
  };
}

/**
 * `html` with `content` in place of what stands between its marks, or null when it has
 * none: a page written before the marks, or written over whole since.
 */
export function putBetween(html, content) {
  const page = marked(html);
  if (!page) return null;
  return restamp(
    `${page.before}<!-- put: start ${print(content)} -->\n${content.trim()}\n${page.after}`,
  );
}

/**
 * Whether what stands between the marks is not what a bot last put or got there. A mark
 * with no print, from before prints, claims nothing.
 */
export function editedSince(html) {
  const page = marked(html);
  return Boolean(page?.seen) && page.seen !== print(page.between);
}

/**
 * What stands between the marks now, and the page marked as got so: a put over it is
 * a put over what the bot has read. Null when it has no marks.
 */
export function getBetween(html) {
  const page = marked(html);
  if (!page) return null;
  return {
    content: page.between.trim(),
    html: `${page.before}<!-- put: start ${print(page.between)} -->${page.between}${page.after}`,
  };
}

/** Why `content` cannot be put, or null: it must be the inside of a page, not a whole one. */
export function notInside(content) {
  if (!content.trim()) return "is empty";
  if (/<(!doctype|html|head|body)\b/i.test(content))
    return "is a whole page: give only what goes inside it";
  return null;
}

/**
 * Writes `file` whole or not at all: beside it first, then moved into place, since the app
 * may be reading it or saving over it at the same moment.
 */
export function keep(file, html) {
  const beside = `${file}.${revision()}.putting`;
  try {
    writeFileSync(beside, html);
    renameSync(beside, file);
  } catch (error) {
    rmSync(beside, { force: true });
    throw error;
  }
}
