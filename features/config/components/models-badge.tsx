"use client";

import { queryKey } from "@/app/api/query-key";
import {
  CONFIG_GROUPS,
  type ConfigStatus,
  isConfigSet,
} from "@/features/config/config.const";
import { NavBadge } from "@/features/settings/components/setting-ui";
import type { SectionAlert } from "@/features/settings/settings.alert";
import { useServerRoute } from "@/lib/protocol/use-server-route";

/**
 * Every studio model key, read off the catalogue so a new kind counts without a
 * second list. `kind` is the test rather than the section: the bots' default model
 * sits in the same section but resolves when unset (ai/model resolveDefaultModel),
 * and a key with a fallback is not something waiting on anyone.
 */
const MODEL_KEYS = CONFIG_GROUPS.filter(
  (group) => group.section === "models",
).flatMap((group) =>
  group.entries.filter((entry) => entry.kind).map((entry) => entry.key),
);

/**
 * Nobody has picked a studio model at all. Not one unpicked — all of them: each
 * costs money per call, so leaving video or speech off is a choice, and a badge
 * that only clears when every kind is set is a standing demand to spend. What is
 * worth saying once is that the whole drawer exists, because until one is picked
 * a bot that would have drawn just finds out mid-job. Picking any answers it.
 * A loading read reports nothing rather than flashing a dot on every open.
 */
export function useModelsAlert(): SectionAlert {
  const { data, isLoading } = useServerRoute<ConfigStatus[]>(queryKey.config);
  if (isLoading || !data) return null;
  return MODEL_KEYS.every((key) => !isConfigSet(data, key)) ? "amber" : null;
}

/** A dot, not a count: the number would only ever be "all of them". */
export function ModelsBadge() {
  return useModelsAlert() ? <NavBadge tone="amber" /> : null;
}
