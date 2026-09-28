"use client";

import { queryKey } from "@/app/api/query-key";
import {
  type AiProvider,
  type MediaKind,
  planMediaOf,
} from "@/features/ai/model.schema";
import {
  CONFIG_GROUPS,
  type ConfigStatus,
  isConfigSet,
  MEDIA_MODEL_KEYS,
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

/** Every studio kind, as the keys name them. */
const MEDIA_KINDS = Object.keys(MEDIA_MODEL_KEYS) as MediaKind[];

/**
 * Nobody has picked a studio model at all, and the GPT Subscription makes none by
 * itself. Not one unpicked — all of them: each costs money per call, so leaving
 * video or speech off is a choice, and a badge that only clears when every kind is
 * set is a standing demand to spend. What is worth saying once is that the whole
 * drawer exists, because until one is picked a bot that would have drawn just finds
 * out mid-job. Picking any answers it, and so does a sign-in whose plan draws
 * (model.schema planMediaOf). A loading read reports nothing rather than flashing a
 * dot on every open.
 */
export function useModelsAlert(): SectionAlert {
  const { data, isLoading } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const { data: providers } = useServerRoute<AiProvider[]>(queryKey.llmModel);
  if (isLoading || !data || !providers) return null;
  const plan = providers.find((provider) => provider.signIn);
  const signIn = plan?.hasKey ? { plan: plan.plan ?? null } : null;
  const planMakes = MEDIA_KINDS.some((kind) => planMediaOf(kind, signIn));
  return !planMakes && MODEL_KEYS.every((key) => !isConfigSet(data, key))
    ? "waiting"
    : null;
}

/** The Models section's dot: the studio is empty. A dot, not a count. */
export function ModelsBadge() {
  return useModelsAlert() ? <NavBadge tone="waiting" /> : null;
}
