"use client";

import { useEffect, useRef, useState } from "react";

const HOLD = ["ctrl", "alt", "meta"] as const;

const IS_MODIFIER = /^(Control|Alt|Shift|Meta|OS)/;

const EDITABLE = /^(input|textarea|select)$/i;

export const HOTKEY_CAPTURE = { "data-hotkey-capture": "" } as const;

const busy = (target: EventTarget | null) => {
  const node = target as HTMLElement | null;
  if (!node) return false;
  return Boolean(
    EDITABLE.test(node.tagName) ||
      node.isContentEditable ||
      node.closest?.("[data-hotkey-capture]"),
  );
};

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
      if (event.repeat || busy(event.target)) return;
      if (comboOf(event) !== combo) return;

      event.preventDefault();
      latest.current();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, combo]);
}
