"use client";

import { Mic } from "lucide-react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Switch } from "@/components/ui/switch";
import {
  SettingGroup,
  SettingNote,
} from "@/features/settings/components/setting-ui";

/**
 * A chip beside the activity line while the backend holds the turn: the mic is open and
 * the words go in, but the answer waits for the work. Everything this feature is lives
 * here — its setting, its words and both faces — so taking it out is this file and the
 * two lines that call it.
 *
 * Why it says this and not "mic off": nothing closes the mic during a call
 * (lib/live/live.transport closes tracks only when the call does), and a spoken turn is
 * still transcribed while the backend works — on one call a request landed inside a
 * 20-second `thread_start` and was answered after it. The old "mic off" chip went out
 * with the mic that really closed (3e4ac7c).
 *
 * Off by default: what it costs is a line that grows and shrinks under her face, and
 * whether that is worth it is measured on real calls, not decided here.
 */

type Stored = { on: boolean; set: (on: boolean) => void };

const useStore = create<Stored>()(
  persist((set) => ({ on: false, set: (on) => set({ on }) }), {
    name: "thursday.workChip",
  }),
);

/** The chip, or nothing: off by setting, and only while the backend has the turn. */
export function WorkChip({ shown }: { shown: boolean }) {
  const on = useStore((state) => state.on);
  if (!on || !shown) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted/60 py-0.5 pr-2 pl-1.5 font-mono text-[11px] leading-4 text-muted-foreground">
      <Mic className="size-3 shrink-0" />
      answers after this
    </span>
  );
}

/** Its one switch, in Settings › Thursday. */
export function WorkChipSetting() {
  const on = useStore((state) => state.on);
  const set = useStore((state) => state.set);
  return (
    <SettingGroup label="While she works">
      <label className="flex items-center gap-2.5 text-sm">
        <Switch checked={on} onCheckedChange={set} />
        Say the answer is coming
      </label>
      <SettingNote>
        A chip beside the line while the backend has the turn. She keeps hearing
        you meanwhile — the answer is what waits.
      </SettingNote>
    </SettingGroup>
  );
}
