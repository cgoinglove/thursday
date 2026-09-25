"use client";

import { useBotAlert } from "@/features/bot/components/bot-badge";
import { useThreadAlert } from "@/features/bot/components/thread-badge";
import { useConfigAlert } from "@/features/config/components/config-badge";
import { useModelsAlert } from "@/features/config/components/models-badge";
import { useMcpAlert } from "@/features/connectors/components/mcp-badge";
import { useReachAlert } from "@/features/reach/components/reach-badge";
import type { SettingSectionId } from "./settings.store";

/**
 * What a section is reporting: red is broken, and waiting, drawn in the
 * `--waiting` ember, is everything that wants the user — a question, a stopped
 * job, an answer not opened, a section worth setting up. One colour to look
 * for, so the eye learns one thing. A section at rest reports nothing. The fact
 * lives here so both places that draw it stay in step — the nav row (which can
 * afford a count) and the call screen's corner (which cannot).
 */
export type SectionAlert = "red" | "waiting" | null;

/** Broken outranks everything waiting says; one of them is the whole ladder. */
export function worstAlert(alerts: SectionAlert[]): SectionAlert {
  if (alerts.includes("red")) return "red";
  return alerts.includes("waiting") ? "waiting" : null;
}

/**
 * Every section that is reporting. Each domain's hook is called once and
 * unconditionally; sections with nothing to say are absent. The reads are the
 * same SWR keys the screens already hold, so this adds no fetching of its own.
 */
export function useSectionAlerts(): Partial<
  Record<SettingSectionId, SectionAlert>
> {
  const bot = useBotAlert();
  const threads = useThreadAlert();
  const mcp = useMcpAlert();
  const keys = useConfigAlert();
  const models = useModelsAlert();
  const phone = useReachAlert();
  return { bot, threads, mcp, keys, models, phone };
}
