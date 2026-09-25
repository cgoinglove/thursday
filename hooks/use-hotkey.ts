"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * The keys the window owns: the combo that places a call, the plain keys a screen
 * claims, and Esc. Nothing here reaches a dialog — Base UI dismisses one on the
 * document and stops the event there, so it never arrives at the window.
 */

const HOLD = ["ctrl", "alt", "meta"] as const;

const IS_MODIFIER = /^(Control|Alt|Shift|Meta|OS)/;

const EDITABLE = /^(input|textarea|select)$/i;

export const HOTKEY_CAPTURE = { "data-hotkey-capture": "" } as const;

/** A key pressed here is being typed or recorded, not meant for a shortcut. */
export const capturesKeys = (target: EventTarget | null) => {
  const node = target as HTMLElement | null;
  if (!node) return false;
  return Boolean(
    EDITABLE.test(node.tagName) ||
      node.isContentEditable ||
      node.closest?.("[data-hotkey-capture]"),
  );
};

/**
 * Mid-composition the keys belong to the character being made, not to the window
 * or a field's own Enter and Esc. keyCode 229 is for Safari, whose key that
 * confirms a composed character arrives with `isComposing` already false.
 */
export const composing = (event: KeyboardEvent | ReactKeyboardEvent) => {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
};

/**
 * Whether a plain key (no modifier) is the window's to take: not typed into a field,
 * not inside a dialog a screen opened over everything, not already answered.
 */
export const windowKey = (event: KeyboardEvent) =>
  !event.defaultPrevented &&
  !composing(event) &&
  !capturesKeys(event.target) &&
  !(event.target as HTMLElement | null)?.closest?.('[role="dialog"]');

/**
 * Esc goes to the last layer that opened and no further. One listener owns the key
 * for the whole window, so layers never race over which effect registered first —
 * the ringing call, the write line and the room each get their turn in the order
 * they appeared. A field that wants Esc for itself handles it and calls
 * `preventDefault`.
 */
const layers: { current: () => void }[] = [];

const onEscapeKey = (event: KeyboardEvent) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  // Esc during composition drops the character being made, not the layer around it
  if (composing(event)) return;
  const top = layers.at(-1);
  if (!top) return;
  event.preventDefault();
  top.current();
};

export function useEscape(open: boolean, onEscape: () => void) {
  const latest = useRef(onEscape);
  latest.current = onEscape;

  useEffect(() => {
    if (!open) return;
    layers.push(latest);
    if (layers.length === 1) window.addEventListener("keydown", onEscapeKey);
    return () => {
      layers.splice(layers.indexOf(latest), 1);
      if (!layers.length) window.removeEventListener("keydown", onEscapeKey);
    };
  }, [open]);
}

export function comboOf(event: {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  const { code, ctrlKey, altKey, shiftKey, metaKey } = event;
  if (!code || IS_MODIFIER.test(code)) return null;
  if (!ctrlKey && !altKey && !metaKey) return null;

  const held: string[] = [];
  if (ctrlKey) held.push("ctrl");
  if (altKey) held.push("alt");
  if (shiftKey) held.push("shift");
  if (metaKey) held.push("meta");
  return [...held, code].join("+");
}

export const isCombo = (combo: string) => {
  const parts = combo.split("+");
  const code = parts.at(-1);
  return Boolean(
    code &&
      !IS_MODIFIER.test(code) &&
      parts.slice(0, -1).some((part) => HOLD.includes(part as never)),
  );
};

const SIGN: Record<string, [plain: string, mac: string]> = {
  ctrl: ["Ctrl", "⌃"],
  alt: ["Alt", "⌥"],
  shift: ["Shift", "⇧"],
  meta: ["Meta", "⌘"],
};

const keyLabel = (code: string) =>
  code.replace(/^(Key|Digit|Numpad)/, "").replace(/([a-z])([A-Z])/g, "$1 $2") ||
  code;

export function hotkeyLabel(combo: string, mac = false): string {
  const parts = combo.split("+");
  const code = parts.at(-1) ?? "";
  const held = parts
    .slice(0, -1)
    .map((part) => SIGN[part]?.[mac ? 1 : 0] ?? part);
  const key = keyLabel(code);
  return mac ? [...held, key].join("") : [...held, key].join(" + ");
}

export function useHotkeyLabel(combo: string | null): string | null {
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/mac/i.test(navigator.userAgent)), []);
  return combo ? hotkeyLabel(combo, mac) : null;
}

export function useHotkey({
  enabled,
  combo,
  onPress,
}: {
  enabled: boolean;
  combo: string | null;
  onPress: () => void;
}) {
  const latest = useRef(onPress);
  latest.current = onPress;

  useEffect(() => {
    if (!enabled || !combo) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || capturesKeys(event.target)) return;
      if (comboOf(event) !== combo) return;

      event.preventDefault();
      latest.current();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, combo]);
}
