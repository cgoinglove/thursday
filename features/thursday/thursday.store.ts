"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LIVE_DEFAULTS, migrateLiveSettings } from "@/features/ai/live.schema";
import {
  CALL_BACK_DEFAULT,
  type CallBack,
  CallBackSchema,
  type CaptionView,
  CaptionViewSchema,
  HOTKEY_DEFAULT,
  type Hotkey,
  HotkeySchema,
  type ThursdaySettings,
  ThursdaySettingsSchema,
  WAKE_DEFAULT,
  type Wake,
  WakeSchema,
} from "./thursday.schema";

// Call settings persisted per browser. Only `ThursdaySettings` is sent to the
// server (openCallAction); the rest never leaves the page.

/** Everything this browser stores, sent or not. */
const StoredSchema = ThursdaySettingsSchema.extend({
  // `.catch` so settings stored before a field existed keep the other fields.
  wake: WakeSchema.catch(WAKE_DEFAULT),
  hotkey: HotkeySchema.catch(HOTKEY_DEFAULT),
  callBack: CallBackSchema.catch(CALL_BACK_DEFAULT),
  captionView: CaptionViewSchema.catch("center"),
});

type Stored = ThursdaySettings & {
  wake: Wake;
  hotkey: Hotkey;
  callBack: CallBack;
  captionView: CaptionView;
};

type ThursdayStore = Stored & {
  /** Updates only the given fields. */
  patch: (change: Partial<Stored>) => void;
};

const EMPTY: Stored = {
  ...LIVE_DEFAULTS,
  wake: WAKE_DEFAULT,
  hotkey: HOTKEY_DEFAULT,
  callBack: CALL_BACK_DEFAULT,
  captionView: "center",
};

export const useThursdayStore = create<ThursdayStore>()(
  persist(
    (set) => ({
      ...EMPTY,
      patch: (change) => set(change),
    }),
    {
      name: "thursday.settings",
      // Parsed on the way in so a hand-edited value cannot reach a call. Live
      // fields recover one by one (migrateLiveSettings), the rest by `.catch` above.
      merge: (persisted, current) => {
        const parsed = StoredSchema.safeParse(migrateLiveSettings(persisted));
        const restored = parsed.success ? parsed.data : EMPTY;
        return { ...current, ...restored };
      },
    },
  ),
);

/** What openCallAction needs and nothing else. */
export const thursdaySettings = (): ThursdaySettings => {
  // Not stored: a fact of this browser, read when the call opens.
  const locale =
    typeof navigator === "undefined" ? null : (navigator.language ?? null);
  return ThursdaySettingsSchema.parse({
    ...useThursdayStore.getState(),
    locale,
  });
};
