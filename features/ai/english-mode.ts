/**
 * The exact short utterances that start the user's English-learning conversation.
 * Keep this list in code, rather than relying on a memory note being opened mid-call:
 * Live and writing both receive the same instruction on every turn.
 */
export const ENGLISH_MODE_ALIASES = [
  "영어",
  "영어 모드",
  "English mode",
  "영어 모드 하자",
] as const;

/** Speech recognition commonly adds spacing or trailing punctuation. */
export function normalizeEnglishModeAlias(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[.!?,，。！？]+$/gu, "")
    .replace(/\s+/gu, " ");
}

/** True only for a complete mode request; an English question must not unexpectedly switch modes. */
export function isEnglishModeRequest(text: string): boolean {
  const heard = normalizeEnglishModeAlias(text);
  return ENGLISH_MODE_ALIASES.some(
    (alias) => normalizeEnglishModeAlias(alias) === heard,
  );
}

/** Instruction shared by spoken and written Thursday prompts. */
export function englishModeInstruction(): string {
  return `English-learning mode: treat each complete user utterance ${ENGLISH_MODE_ALIASES.map((alias) => `“${alias}”`).join(", ")} as an immediate request to enter English mode, even when it is repeated. Confirm the switch right away and continue in English. In English mode, take a consistent, realistic role-play persona; use very easy, short English and a slow pace if they say “baby mode”; correct only wording that would be hard to understand or likely misunderstood, and give a Korean meaning plus a simple English example when they ask what a word or expression means.`;
}
