import type { ModelMessage } from "ai";

/**
 * A stretch of conversation as its words alone: what was said, and for a step that only
 * used tools, what it did, in the caller's wording (`did`). What a tool answered and what
 * the model thought are most of what a transcript weighs, and they go.
 *
 * The words are rebuilt as plain messages rather than pruned in place (ai `pruneMessages`).
 * A provider ties a thought to the item it led to, by id, and refuses the whole
 * conversation when one arrives without the other: a thought whose tool call was pruned,
 * or words whose thought was. A plain message carries no id, so nothing is left to pair.
 * The steps of one reply come back as one message, since some providers want the
 * speakers to take turns.
 */
export function asWords(
  messages: ModelMessage[],
  did: (toolName: string, input: unknown) => string,
  clip: (text: string) => string = (text) => text,
): ModelMessage[] {
  const words: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "tool") continue;
    if (message.role === "system") {
      words.push(message);
      continue;
    }
    if (message.role === "user") {
      words.push(
        typeof message.content === "string"
          ? { role: "user", content: clip(message.content) }
          : message,
      );
      continue;
    }
    const parts =
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content;
    const said = parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim();
    const text =
      said ||
      parts
        .flatMap((part) =>
          part.type === "tool-call" ? [did(part.toolName, part.input)] : [],
        )
        .join("\n");
    if (!text) continue;
    const before = words.at(-1);
    if (before?.role === "assistant" && typeof before.content === "string")
      words[words.length - 1] = {
        role: "assistant",
        content: `${before.content}\n${clip(text)}`,
      };
    else words.push({ role: "assistant", content: clip(text) });
  }
  return words;
}
