// A document's body from Markdown: what a bot writes most surely, turned into the markup the
// document already styles (quick.css), so the page reads as a document and not as bare HTML.
// Markdown for the text, and the few blocks it lacks from what Markdown readers already know:
//
//   ---                         front matter, all optional: the line over the title and the
//   kicker: Report              chips under it, in the document's own language
//   date: As of 24 September
//   by: Analyst                 several split by commas
//   status: On track            with tone: good, warn or bad
//   ---
//   # The finding as a title    the first paragraph under it is the lede
//   ```stats                    one card a line: the number, then what it is
//   42% | of renters moved
//   ```
//   > [!WARNING]                a note: NOTE and TIP plain and good, IMPORTANT and WARNING
//   > What changes the finding  warn, CAUTION bad; a plain > stays a quotation
//   - [x] done / - [ ] next      a checklist the reader can tick
//   ![What it shows](photo.jpg) alone in its paragraph: a picture with its caption
//   | Item | Value |             a column aligned right (---:) is read as numbers
//
// HTML written inside the Markdown passes through untouched, for tabs, a chip, a figure a
// chart is drawn into. Comments are dropped: the outlines' guidance never reaches the page.
import { Marked, Tokenizer } from "../vendor/marked.mjs";

const escape = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** GitHub's alert marks, and how the document tints each. */
const ALERTS = {
  NOTE: "note",
  TIP: "note good",
  IMPORTANT: "note warn",
  WARNING: "note warn",
  CAUTION: "note bad",
};
const ALERT = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

/**
 * Chinese, Japanese and Korean put no space after a word, so bold that ends in punctuation meets
 * a letter: `**5.11%**다`, `**「重要」**です`. CommonMark closes a run after punctuation only
 * before a space or more punctuation, and printed those asterisks. markdown-cjk-friendly
 * (github.com/tats-u/markdown-cjk-friendly) amends the rule for these scripts: beside a
 * delimiter run their letters count as a space would. marked's own emphasis runs with the two
 * rules it reads for `*` widened so; `_` stays as CommonMark has it, since bold is `**`.
 */
const CJK = String.raw`[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}\p{scx=Bopomofo}]`;
const widened = (rule, from, to) => {
  if (rule.source.split(from).length !== 2)
    throw new Error(
      "marked's emphasis rules changed: markdown.mjs no longer widens them for CJK",
    );
  return new RegExp(rule.source.replace(from, to), rule.flags);
};
// Each set of marked's rules to its widened copy; a copy maps to itself, since bold inside bold
// is lexed while the copy is in place
const cjk = new WeakMap();
const cjkInline = (inline) => {
  if (!cjk.has(inline)) {
    const wide = {
      ...inline,
      // After punctuation a run closes before one of their letters, as before a space
      emStrongRDelimAst: widened(
        inline.emStrongRDelimAst,
        String.raw`(\*+)(?=[\s]|$)`,
        String.raw`(\*+)(?=[\s]|${CJK}|$)`,
      ),
      // and opens after one of them before punctuation, as after a space
      punctuation: widened(
        inline.punctuation,
        String.raw`[\s\p{P}\p{S}])`,
        String.raw`(?:[\s\p{P}\p{S}]|${CJK}))`,
      ),
    };
    cjk.set(inline, wide).set(wide, wide);
  }
  return cjk.get(inline);
};
const tokenizer = {
  emStrong(src, masked, before) {
    const rules = this.rules;
    this.rules = { ...rules, inline: cjkInline(rules.inline) };
    try {
      return Tokenizer.prototype.emStrong.call(this, src, masked, before);
    } finally {
      this.rules = rules;
    }
  },
};

const markdown = new Marked({
  gfm: true,
  tokenizer,
  renderer: {
    // A box a reader ticks in the page; the document's script keeps what they tick
    checkbox({ checked }) {
      return `<input type="checkbox"${checked ? " checked" : ""}>`;
    },
    list(token) {
      const tag = token.ordered ? "ol" : "ul";
      const start =
        token.ordered && token.start !== 1 ? ` start="${token.start}"` : "";
      const check =
        token.items.length && token.items.every((item) => item.task);
      const items = token.items.map((item) => this.listitem(item)).join("");
      return `<${tag}${check ? ' class="check"' : ""}${start}>\n${items}</${tag}>\n`;
    },
    table(token) {
      const cell = (tag, one) =>
        `<${tag}${one.align === "right" ? ' class="num"' : ""}>${this.parser.parseInline(one.tokens)}</${tag}>`;
      const head = token.header.map((one) => cell("th", one)).join("");
      const rows = token.rows
        .map((row) => `<tr>${row.map((one) => cell("td", one)).join("")}</tr>`)
        .join("\n");
      return `<div class="scroll">\n<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>\n</div>\n`;
    },
    blockquote(token) {
      const first = token.tokens[0];
      const mark = first?.type === "paragraph" ? ALERT.exec(first.raw) : null;
      if (!mark)
        return `<blockquote>\n${this.parser.parse(token.tokens)}</blockquote>\n`;
      const rest = this.parser.parse(
        new Marked({ gfm: true, tokenizer }).lexer(
          token.text.replace(ALERT, ""),
        ),
      );
      return `<div class="${ALERTS[mark[1].toUpperCase()]}">\n${rest}</div>\n`;
    },
    paragraph(token) {
      const only = token.tokens.filter(
        (one) => !(one.type === "text" && !one.text.trim()),
      );
      if (only.length === 1 && only[0].type === "image") {
        const { href, text } = only[0];
        const caption = text ? `<figcaption>${escape(text)}</figcaption>` : "";
        return `<figure><img src="${escape(href)}" alt="${escape(text)}">${caption}</figure>\n`;
      }
      return `<p>${this.parser.parseInline(token.tokens)}</p>\n`;
    },
    code(token) {
      if (token.lang?.trim() !== "stats")
        return `<pre><code>${escape(token.text)}</code></pre>\n`;
      const cards = token.text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [value, ...label] = line.split("|");
          return `<div class="card"><p class="stat">${escape(value.trim())}</p><small>${escape(label.join("|").trim())}</small></div>`;
        });
      const grid = cards.length === 3 ? "grid three" : "grid";
      return `<div class="${grid}">\n${cards.join("\n")}\n</div>\n`;
    },
  },
});

/** The keys the line over and under the title is made of. */
const KEY_LINE = /^(kicker|date|by|status|tone)\s*:\s*\S/i;

/**
 * `key: value` lines at the very top, and the text after them: between `---` fences, or the
 * same keys written bare above the first heading — which a model often does, and which would
 * otherwise print at the head of the page as a paragraph.
 */
function frontMatter(text) {
  const meta = {};
  const take = (line) => {
    const at = line.indexOf(":");
    if (at > 0)
      meta[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  };
  const fenced = /^\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (fenced) {
    for (const line of fenced[1].split(/\r?\n/)) take(line);
    return { meta, rest: text.slice(fenced[0].length) };
  }
  const lines = text.replace(/^\s+/, "").split(/\r?\n/);
  let bare = 0;
  while (bare < lines.length && KEY_LINE.test(lines[bare].trim()))
    take(lines[bare++]);
  return bare
    ? { meta, rest: lines.slice(bare).join("\n") }
    : { meta, rest: text };
}

/** The document's body, as the page's put writes it, from a Markdown text. */
export function documentBody(text) {
  const { meta, rest } = frontMatter(text.replace(/<!--[\s\S]*?-->/g, ""));
  let html = markdown.parse(rest);

  // `by` may name several, split by commas: who a memo is from and for, who attended
  const who = (meta.by ?? "")
    .split(",")
    .map((one) => one.trim())
    .filter(Boolean)
    .map((one) => `<span class="chip who">${escape(one)}</span>`);
  const tone = ["good", "warn", "bad"].includes(meta.tone)
    ? ` ${meta.tone}`
    : "";
  const chips = [
    meta.date && `<span class="chip date">${escape(meta.date)}</span>`,
    ...who,
    meta.status &&
      `<span class="chip status${tone}">${escape(meta.status)}</span>`,
  ].filter(Boolean);
  const title = /<h1\b[^>]*>[\s\S]*?<\/h1>\n?/.exec(html);
  if (title) {
    const before = meta.kicker
      ? `<p class="kicker">${escape(meta.kicker)}</p>\n`
      : "";
    const byline = chips.length
      ? `<p class="byline">${chips.join(" ")}</p>\n`
      : "";
    const after = html.slice(title.index + title[0].length);
    // The paragraph right under the title is the lede, read first and alone
    const lede = after.replace(/^\s*<p>/, '<p class="lede">');
    html = `${html.slice(0, title.index)}${before}${title[0]}${byline}${lede}`;
  }
  return html.trim();
}
