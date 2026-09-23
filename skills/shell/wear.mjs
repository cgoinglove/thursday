// Puts the shell on a page a skill's script writes (deck.mjs, canvas.mjs, page.mjs): its
// stylesheet, the line that sets the theme before the first paint, its script, and the
// parts of the head every kind has (head.html). Whatever it puts in is copied into the
// page, so the page stays one file that opens alone.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(HERE, file), "utf8").trim();

/** A bot's name as page text: it is whatever the user typed when they named the bot. */
const escape = (text) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/** head.html's `<!-- part: name -->` sections, by name. */
const parts = () => {
  const found = {};
  const pieces = read("head.html").split(/<!-- part: ([\w-]+) -->/);
  for (let i = 1; i < pieces.length; i += 2)
    found[pieces[i]] = pieces[i + 1].trim();
  return found;
};

/**
 * `html` with the shell put in where its markers stand. Who made the page comes from the
 * bot's shell (`THURSDAY_BOT`); a page written outside a bot's job names nobody.
 */
export function wear(html) {
  const part = parts();
  const bot = escape(process.env.THURSDAY_BOT?.trim() ?? "");
  return html
    .replace("/* shell.css */", () => read("shell.css"))
    .replace("// shell.theme", () => read("theme.js"))
    .replace("// shell.js", () => read("shell.js"))
    .replaceAll("{{shell.meta}}", () => part.meta)
    .replaceAll("{{shell.who}}", () => part.who.replaceAll("{{bot}}", bot))
    .replaceAll("{{shell.theme}}", () => part.theme)
    .replaceAll("{{shell.export}}", () => part.export)
    .replaceAll("{{shell.download}}", () => part.download);
}
