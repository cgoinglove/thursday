import { Lexer, type Token, type Tokens } from "marked";

/**
 * What a chat is sent, apart from any one service. Her words are markdown, and each service
 * draws marks of its own — Telegram HTML, Discord its markdown, Slack its mrkdwn — so the text
 * is read once, as markdown (marked's lexer), and drawn in the marks of the service it goes to.
 * A chat is no page: a table becomes rows, a heading a bold line, a picture its words, and a
 * path, which a phone cannot open, its words alone (the file goes along; reach sendFiles).
 */

/** How a service draws text; `plain` draws none. */
export type ChatMarks = "plain" | "telegram" | "discord" | "slack";

/** What a chat is sent: her words as she wrote them, or the app's own line, drawn as it is. */
export type ChatText = { markdown: string } | { plain: string };

/** Plain words set inside markdown so they stay words: every mark they might hold is escaped. */
export const literal = (text: string) =>
  text.replace(/[\\`*_{}[\]()#+\-.!|~<>]/g, "\\$&");

/**
 * A text in a service's marks, in pieces of at most `max` characters. A piece ends between
 * blocks where it can, so no mark is cut open across two messages. A block longer than a
 * piece is cut by lines: a code block is closed and opened again around each cut, and
 * anything else goes without its marks, since a mark cut in two is one the service refuses or
 * shows raw.
 */
export function chatPieces(
  text: ChatText,
  marks: ChatMarks,
  max: number,
): string[] {
  const blocks =
    "plain" in text
      ? [
          {
            kind: "text" as const,
            drawn: escape(text.plain, marks),
            words: text.plain,
          },
        ]
      : new Lexer({ gfm: true })
          .lex(text.markdown)
          .flatMap((token) => blockOf(token, marks));
  const pieces: string[] = [];
  let piece = "";
  const put = (drawn: string) => {
    if (piece && piece.length + 2 + drawn.length <= max) {
      piece += `\n\n${drawn}`;
      return;
    }
    if (piece) pieces.push(piece);
    piece = drawn;
  };
  for (const block of blocks) {
    const drawn =
      block.kind === "code"
        ? codeBlock(block.lang, block.body, marks)
        : block.drawn;
    if (drawn.length <= max) put(drawn);
    else if (block.kind === "code")
      for (const part of codeParts(block.lang, block.body, marks, max))
        put(part);
    else for (const part of fit(block.words, marks, max)) put(part);
  }
  if (piece) pieces.push(piece);
  return pieces.length ? pieces : [escape("…", marks)];
}

/**
 * A long run of words in pieces a service takes, each cut where the reading breaks: at a
 * paragraph in the back half of the piece, else a line, else a space, and only then mid-word —
 * never inside a character a phone would draw as a broken box.
 */
export function inPieces(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const head = rest.slice(0, max);
    const near = [
      head.lastIndexOf("\n\n"),
      head.lastIndexOf("\n"),
      head.lastIndexOf(" "),
    ].find((at) => at > max / 2);
    let cut = near ?? max;
    // A pair that draws one character (an emoji, most of all) stays whole
    const unit = rest.charCodeAt(cut - 1);
    if (!near && unit >= 0xd800 && unit <= 0xdbff) cut -= 1;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** One block as drawn, with its words bare for when it must be cut; a code block drawn when packed. */
type Block =
  | { kind: "text"; drawn: string; words: string }
  | { kind: "code"; lang: string; body: string };

function blockOf(token: Token, marks: ChatMarks): Block[] {
  if (token.type === "code") {
    const code = token as Tokens.Code;
    return [{ kind: "code", lang: code.lang ?? "", body: code.text }];
  }
  const drawn = draw(token, marks);
  return drawn ? [{ kind: "text", drawn, words: draw(token, "plain") }] : [];
}

/** A block of markdown in a service's marks. */
function draw(token: Token, marks: ChatMarks): string {
  switch (token.type) {
    case "heading":
      return heading(
        inline(token.tokens ?? [], marks),
        (token as Tokens.Heading).depth,
        marks,
      );
    case "paragraph":
      return inline(token.tokens ?? [], marks);
    case "text":
      return token.tokens
        ? inline(token.tokens, marks)
        : escape(decode(token.text), marks);
    case "list":
      return list(token as Tokens.List, marks, "");
    case "blockquote":
      return quote(
        (token.tokens ?? [])
          .map((one) => draw(one, marks))
          .filter(Boolean)
          .join("\n"),
        marks,
      );
    case "table":
      return table(token as Tokens.Table, marks);
    case "code":
      return codeBlock((token as Tokens.Code).lang ?? "", token.text, marks);
    // A block of HTML is words to a chat
    case "html":
      return escape(decode(token.text.replace(/<[^>]*>/g, "")).trim(), marks);
    default:
      return "";
  }
}

function list(token: Tokens.List, marks: ChatMarks, indent: string): string {
  return token.items
    .map((item, at) => {
      const mark = token.ordered
        ? `${Number(token.start || 1) + at}.`
        : // Discord draws its own lists; the others show a dot
          marks === "discord"
          ? "-"
          : "•";
      const box = item.task ? (item.checked ? "☑ " : "☐ ") : "";
      const [head, ...rest] = item.tokens.filter(
        (one) => one.type !== "checkbox",
      );
      const inner = `${indent}  `;
      return [
        `${indent}${mark} ${box}${head ? draw(head, marks) : ""}`,
        ...rest.map((one) =>
          one.type === "list"
            ? list(one as Tokens.List, marks, inner)
            : draw(one, marks).replace(/^/gm, inner),
        ),
      ]
        .filter((line) => line.trim())
        .join("\n");
    })
    .join("\n");
}

/** A table as rows, its cells side by side and the header row set apart. */
function table(token: Tokens.Table, marks: ChatMarks): string {
  const row = (cells: Tokens.TableCell[]) =>
    cells.map((cell) => inline(cell.tokens, marks)).join(" · ");
  return [
    wrap(row(token.header), "strong", marks),
    ...token.rows.map(row),
  ].join("\n");
}

function heading(text: string, depth: number, marks: ChatMarks): string {
  if (marks === "discord" && depth <= 3) return `${"#".repeat(depth)} ${text}`;
  return wrap(text, "strong", marks);
}

function quote(text: string, marks: ChatMarks): string {
  if (!text) return "";
  if (marks === "telegram") return `<blockquote>${text}</blockquote>`;
  if (marks === "plain") return text;
  return text.replace(/^/gm, "> ");
}

/** Inline markdown in a service's marks. */
function inline(tokens: Token[], marks: ChatMarks): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case "text":
          return token.tokens
            ? inline(token.tokens, marks)
            : escape(decode(token.text), marks);
        case "escape":
          return escape(token.text, marks);
        case "strong":
        case "em":
        case "del":
          return wrap(inline(token.tokens ?? [], marks), token.type, marks);
        case "codespan":
          return codeSpan(token.text, marks);
        case "link":
          return link(token as Tokens.Link, marks);
        case "image":
          return escape(decode(token.text), marks);
        case "br":
          return "\n";
        // Tags written into a line are no marks a chat has; a line break is the one kept
        case "html":
          return /^<br\s*\/?>$/i.test(token.text) ? "\n" : "";
        default:
          return "text" in token
            ? escape(decode(String(token.text)), marks)
            : "";
      }
    })
    .join("");
}

const WRAP: Record<
  Exclude<ChatMarks, "plain">,
  Record<"strong" | "em" | "del", [string, string]>
> = {
  telegram: {
    strong: ["<b>", "</b>"],
    em: ["<i>", "</i>"],
    del: ["<s>", "</s>"],
  },
  discord: { strong: ["**", "**"], em: ["*", "*"], del: ["~~", "~~"] },
  slack: { strong: ["*", "*"], em: ["_", "_"], del: ["~", "~"] },
};

function wrap(
  text: string,
  kind: "strong" | "em" | "del",
  marks: ChatMarks,
): string {
  if (!text || marks === "plain") return text;
  const [open, close] = WRAP[marks][kind];
  return `${open}${text}${close}`;
}

function codeSpan(text: string, marks: ChatMarks): string {
  if (marks === "telegram") return `<code>${escape(text, marks)}</code>`;
  if (marks === "slack") return `\`${escape(text, marks)}\``;
  // Discord takes a run of backticks inside one of double backticks
  if (marks === "discord")
    return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
  return text;
}

function codeBlock(lang: string, body: string, marks: ChatMarks): string {
  if (marks === "telegram")
    return lang
      ? `<pre><code class="language-${escape(lang, marks)}">${escape(body, marks)}</code></pre>`
      : `<pre>${escape(body, marks)}</pre>`;
  if (marks === "discord") return `\`\`\`${lang}\n${body}\n\`\`\``;
  if (marks === "slack") return `\`\`\`\n${escape(body, marks)}\n\`\`\``;
  return body;
}

/** A code block too long for one piece, by lines, each part a code block of its own. */
function codeParts(
  lang: string,
  body: string,
  marks: ChatMarks,
  max: number,
): string[] {
  const room = max - codeBlock(lang, "", marks).length;
  // A line longer than a piece is cut too; a code line has no better place to break
  const lines = body
    .split("\n")
    .flatMap((line) => (line.length > room ? inPieces(line, room) : [line]));
  const parts: string[] = [];
  let part: string[] = [];
  for (const line of lines) {
    if (
      part.length &&
      codeBlock(lang, [...part, line].join("\n"), marks).length > max
    ) {
      parts.push(codeBlock(lang, part.join("\n"), marks));
      part = [];
    }
    part.push(line);
  }
  if (part.length) parts.push(codeBlock(lang, part.join("\n"), marks));
  return parts;
}

/** Bare words cut to pieces that still fit once escaped for the service. */
function fit(words: string, marks: ChatMarks, max: number): string[] {
  return inPieces(words, max).flatMap((piece) => {
    const drawn = escape(piece, marks);
    if (drawn.length <= max || piece.length < 2) return [drawn];
    // Escaping made it longer than a piece: cut it smaller by as much as escaping grew it
    return fit(piece, marks, Math.floor((max * piece.length) / drawn.length));
  });
}

function link(token: Tokens.Link, marks: ChatMarks): string {
  const words = inline(token.tokens, marks);
  // A path is a file on this computer: its words stay, and the file goes along
  if (!/^(https?|mailto):/i.test(token.href)) return words;
  const same = token.text === token.href;
  switch (marks) {
    case "telegram":
      return `<a href="${escape(token.href, marks).replaceAll('"', "&quot;")}">${words}</a>`;
    case "discord":
      return same
        ? token.href
        : `[${words}](${token.href.replaceAll(")", "%29")})`;
    case "slack":
      return same ? `<${token.href}>` : `<${token.href}|${words}>`;
    default:
      return same ? token.href : `${words} ${token.href}`;
  }
}

/** Words in a service's marks without being taken for any. */
function escape(text: string, marks: ChatMarks): string {
  if (marks === "telegram" || marks === "slack")
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  if (marks === "discord")
    return text
      .replace(/[\\*_~`|>[\]]/g, "\\$&")
      .replace(/^(\s*)(#|-|\+|\d+\.)(?=\s)/gm, "$1\\$2");
  return text;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Text as markdown wrote it, with the HTML entities it may hold read back into characters. */
function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? whole;
    const code =
      name[1].toLowerCase() === "x"
        ? Number.parseInt(name.slice(2), 16)
        : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}
