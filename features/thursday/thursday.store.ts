"use client";

import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LiveSettingsSchema } from "@/features/ai/live.schema";
import {
  type TextModelRef,
  textModelRefSchema,
} from "@/features/ai/model.schema";
import {
  CALL_BACK_DEFAULT,
  type CallBack,
  CallBackSchema,
  type CaptionView,
  CaptionViewSchema,
  HOTKEY_DEFAULT,
  type Hotkey,
  HotkeySchema,
  WAKE_DEFAULT,
  type Wake,
  WakeSchema,
} from "./thursday.schema";

// How this machine talks to her, and nothing about who she is. Who she is and what she
// may do is the app's and lives beside the database (thursday.query readLiveSettings),
// so a phone writing in and a second computer meet the same Thursday. A wake phrase, a
// hotkey and which model this line last ran on mean nothing anywhere else, which is
// where the line falls.

/** Everything this browser stores. `.catch` so one unreadable field leaves the others. */
const StoredSchema = z.object({
  wake: WakeSchema.catch(WAKE_DEFAULT),
  hotkey: HotkeySchema.catch(HOTKEY_DEFAULT),
  callBack: CallBackSchema.catch(CALL_BACK_DEFAULT),
  captionView: CaptionViewSchema.catch("sides"),
  textModel: textModelRefSchema.nullable().catch(null),
});

type Stored = {
  wake: Wake;
  hotkey: Hotkey;
  callBack: CallBack;
  captionView: CaptionView;
  /**
   * The model last picked on the write line for a call in writing; null until one is, and
   * then the rule decides (thursday.text runsOnOf). Picked there and nowhere else, so it is
   * never taken for the spoken call's backend model in Settings.
   */
  textModel: TextModelRef | null;
};

type ThursdayStore = Stored & {
  /**
   * What this browser kept back when the call's settings lived here, found once on load
   * and offered to the server (use-thursday, thursday.action seedLiveSettingsAction).
   * Null once it has been, and null on any browser that never held them.
   */
  carried: Record<string, unknown> | null;
  /** Updates only the given fields. */
  patch: (change: Partial<Stored>) => void;
  /** The carried copy has been offered; nothing here holds it again. */
  carriedDone: () => void;
};

const EMPTY: Stored = {
  wake: WAKE_DEFAULT,
  hotkey: HOTKEY_DEFAULT,
  callBack: CALL_BACK_DEFAULT,
  captionView: "sides",
  textModel: null,
};

/** The call's own fields, as this browser wrote them before they moved to the server. */
function carriedOf(persisted: unknown): Record<string, unknown> | null {
  if (!persisted || typeof persisted !== "object") return null;
  const stored = persisted as Record<string, unknown>;
  // `systemPrompt` and `model` are what two of them were called even earlier
  // (live.schema migrateLiveSettings), and a browser may still hold only those
  const keys = [
    ...Object.keys(LiveSettingsSchema.shape),
    "voicePrompt",
    "systemPrompt",
    "model",
  ];
  const held = keys.filter((key) => key in stored);
  return held.length
    ? Object.fromEntries(held.map((key) => [key, stored[key]]))
    : null;
}

export const useThursdayStore = create<ThursdayStore>()(
  persist(
    (set) => ({
      ...EMPTY,
      carried: null,
      patch: (change) => set(change),
      carriedDone: () => set({ carried: null }),
    }),
    {
      name: "thursday.settings",
      // 2: the call's own settings moved to the server. What is found here is handed over
      // once and then dropped, so nothing keeps a second copy to disagree with.
      // 1: web search became the default. A browser from before holds the old
      // default as if it were a choice, and with no search on the line a question
      // about today is answered by driving a browser, in tens of seconds.
      version: 2,
      migrate: (persisted, version) =>
        version < 1 && persisted && typeof persisted === "object"
          ? { ...persisted, webSearch: true }
          : persisted,
      // Only this browser's own; the call's fields are read off `persisted` in `merge`
      // and never written back, so they leave storage the next time anything is saved
      partialize: (state) => ({
        wake: state.wake,
        hotkey: state.hotkey,
        callBack: state.callBack,
        captionView: state.captionView,
        textModel: state.textModel,
      }),
      // Parsed on the way in so a hand-edited value cannot reach a call
      merge: (persisted, current) => {
        const parsed = StoredSchema.safeParse(persisted);
        const restored = parsed.success ? parsed.data : EMPTY;
        return { ...current, ...restored, carried: carriedOf(persisted) };
      },
    },
  ),
);
