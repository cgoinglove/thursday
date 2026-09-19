// A printed page to write into: one HTML file with its stylesheet inlined, in the artifacts folder.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { output, SCRIPT, SKILL, Stop, shown } from "./kit.mjs";

const TEMPLATES = join(SKILL, "templates");
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u;

export const printCss = () =>
  readFileSync(join(TEMPLATES, "print.css"), "utf8");

const kinds = () =>
  readdirSync(TEMPLATES)
    .filter((f) => f.endsWith(".html"))
    .map((f) => f.replace(/\.html$/, ""));

export function newPage(kind, name) {
  if (!kind || !kinds().includes(kind))
    throw new Stop(`Pick a page: ${kinds().join(", ")}. Then a name.`);
  if (!name || !NAME.test(name))
    throw new Stop(
      `${name ? `"${name}" is not` : "Give"} a file name: letters, numbers, - and _ only.`,
    );
  const out = output(name, name, "html");
  if (existsSync(out))
    throw new Stop(`${shown(out)} already exists. Edit it there.`);
  const page = readFileSync(join(TEMPLATES, `${kind}.html`), "utf8")
    .replaceAll("{{title}}", name)
    .replace("/* print.css */", () => printCss().trim());
  writeFileSync(out, page);
  console.log(
    `${shown(out)} is ready, styled for print. Replace its sample lines (the comment inside says which pieces there are), set <html lang> to the document's language, then: node ${SCRIPT} pdf ${shown(out)}`,
  );
}
