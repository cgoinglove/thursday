/**
 * What an answer looks like in a chat: markdown as a chat shows it, in pieces a service takes.
 * The text half of reach, apart from any one service so all three cut and clean the same way.
 */

/**
 * Markdown as a chat shows it: the marks go and the lines stay. None of the three draws
 * markdown from a bot the same way, and a report run into one line cannot be read. A web
 * address stays, since a phone can open it; a path is a file that goes along (reach sendFiles).
 * Code is kept as written: the marks are prose's, and a `# comment` or a `- item` in a snippet
 * is neither a heading nor a list.
 */
export function asChat(markdown: string): string {
  const code: string[] = [];
  // Set aside under a mark no answer carries, and put back once the prose is clean
  const keep = (text: string) => `\u0000${code.push(text) - 1}\u0000`;
  return markdown
    .replace(/```[^\n]*\n?([\s\S]*?)\n?```/g, (_, body: string) => keep(body))
    .replace(/`([^`\n]+)`/g, (_, body: string) => keep(body))
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, (_, text: string, to: string) =>
      /^https?:/.test(to) && to !== text ? `${text} ${to}`.trim() : text,
    )
    .replace(/^\s*\|?[\s:|-]+\|\s*$/gm, "")
    .replace(/^\s*\|(.*)\|\s*$/gm, (_, row: string) =>
      row
        .split("|")
        .map((cell) => cell.trim())
        .join(" · "),
    )
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?)/gm, "")
    .replace(/^(\s*)[-*+]\s+/gm, "$1• ")
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "$1")
    .replace(/(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/\u0000(\d+)\u0000/g, (_, at: string) => code[Number(at)]);
}

/**
 * A long answer in pieces of at most `max`, each cut where the reading breaks: at a paragraph
 * in the back half of the piece, else a line, else a space, and only then mid-word — never
 * inside a character a phone would draw as a broken box.
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
