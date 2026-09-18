/**
 * Hanging up by voice without a model in between. Ending a call is the backend's
 * tool, and whether a turn reaches the backend at all is the voice model's own call:
 * it often answers "okay" and hands nothing over, and the line stays open. So the
 * page listens for the words itself, in the transcript Live already writes.
 *
 * A phrase counts only as the last words of what they said — "don't hang up yet"
 * and "hang up the other thing first" carry it elsewhere — and a heard word may run
 * on past the wanted one, which is how a verb ending lands ("끊어" in "끊어줘").
 */

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    // Live writes sounds in brackets; they are not words
    .replace(/\[[^\]]*\]?|\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Several phrases are written with commas between them. */
export const endPhrasesOf = (written: string) =>
  written
    .split(",")
    .map((phrase) => wordsOf(phrase))
    .filter((words) => words.length > 0);

/** Whether what they said ends on one of the phrases. */
export function endsOnPhrase(said: string, written: string): boolean {
  const heard = wordsOf(said);
  return endPhrasesOf(written).some((want) => {
    if (want.length > heard.length) return false;
    const tail = heard.slice(-want.length);
    return want.every((word, at) => tail[at].startsWith(word));
  });
}
