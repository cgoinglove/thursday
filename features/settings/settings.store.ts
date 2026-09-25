"use client";

import { create } from "zustand";

/** Settings dialog state, kept outside the component so other screens can open a section. */

const SETTING_SECTIONS = [
  "thursday",
  "memory",
  "bot",
  "threads",
  "routines",
  "files",
  "skills",
  "mcp",
  "signins",
  "models",
  "keys",
  "phone",
] as const;

export type SettingSectionId = (typeof SETTING_SECTIONS)[number];

type SettingsStore = {
  open: boolean;
  section: SettingSectionId;
  /** Opens on the given section, else the last one viewed. */
  show(section?: SettingSectionId): void;
  hide(): void;
  pick(section: SettingSectionId): void;
  /**
   * What the open section holds that is not saved, asked before the dialog closes or another
   * section opens (settings): a routine's name or job typed and not kept went with either.
   */
  unsaved: (() => boolean) | null;
  holdUnsaved(unsaved: (() => boolean) | null): void;
};

export const useSettingsStore = create<SettingsStore>()((set) => ({
  open: false,
  section: SETTING_SECTIONS[0],
  show: (section) =>
    set((state) => ({ open: true, section: section ?? state.section })),
  hide: () => set({ open: false }),
  pick: (section) => set({ section }),
  unsaved: null,
  holdUnsaved: (unsaved) => set({ unsaved }),
}));

/** Opens a settings section from outside a component. */
export const openSettings = (section?: SettingSectionId) =>
  useSettingsStore.getState().show(section);
