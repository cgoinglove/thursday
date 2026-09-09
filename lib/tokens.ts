const CJK =
  /[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u4e00-\u9fff\uac00-\ud7af]/;

/**
 * Rough token estimate for budgeting. Korean runs about one token per 1.3
 * characters on current tokenizers, English one per 4.
 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (CJK.test(char)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / 1.3 + other / 4);
}

/**
 * One assembled prompt measured by its own `##` headings, biggest first. Read
 * off the finished text rather than off what built it: what is counted is then
 * what is actually sent, and a chapter cannot be added without appearing here.
 */
export function sectionTokens(
  text: string,
): { name: string; tokens: number }[] {
  return text
    .split(/\n(?=## )/)
    .map((block) => ({
      name: block.startsWith("## ")
        ? block.slice(3, block.indexOf("\n"))
        : "identity",
      tokens: estimateTokens(block),
    }))
    .sort((a, b) => b.tokens - a.tokens);
}
