"use client";

import { useBotAlert } from "@/features/bot/components/bot-badge";
import { useTaskAlert } from "@/features/bot/components/task-badge";
import { useConfigAlert } from "@/features/config/components/config-badge";
import { useMcpAlert } from "@/features/connectors/components/mcp-badge";
import type { SettingSectionId } from "./settings.store";

/**
 * What a section is reporting, in the app's two colours: amber waits on the
 * user, red is broken. A section at rest reports nothing. The fact lives here
 * so both places that draw it stay in step — the nav row (which can afford a
 * count) and the call screen's corner (which cannot).
 */
export type SectionAlert = "amber" | "red" | null;

/** Broken outranks waiting; one of them is the whole ladder. */
export function worstAlert(alerts: SectionAlert[]): SectionAlert {
  if (alerts.includes("red")) return "red";
  return alerts.includes("amber") ? "amber" : null;
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
  const tasks = useTaskAlert();
  const mcp = useMcpAlert();
  const config = useConfigAlert();
  return { bot, tasks, mcp, config };
}
