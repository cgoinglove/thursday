import type { KeyboardEvent } from "react";
import { useState } from "react";

/**
 * Draft for a one-line input, committed on blur. Enter blurs (one commit path);
 * a draft shorter than `min` reverts to `value`; an outside change to `value`
 * resets the draft.
 */
export function useDraft(
  value: string,
  onCommit: (next: string) => void | Promise<void>,
  { min = 1 }: { min?: number } = {},
) {
  const [draft, setDraft] = useState(value);
  // Sync during render; an effect would show the stale draft for a frame.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }

  const commit = () => {
    const next = draft.trim();
    if (next.length < min) return setDraft(value);
    setDraft(next);
    if (next !== value) void onCommit(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter during IME composition confirms the character, not the draft.
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.currentTarget.blur();
    }
  };

  return { value: draft, set: setDraft, commit, onKeyDown };
}
