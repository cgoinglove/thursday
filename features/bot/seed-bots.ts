"use client";

import { queryKey } from "@/app/api/query-key";
import { toast } from "@/components/ui/toast";
import { unwrapResult } from "@/lib/protocol/result";
import { revalidate } from "@/lib/protocol/use-server-route";
import { errorToString } from "@/lib/utils";
import { createSeedBotsAction } from "./bot.action";
import { BOT_SEEDS } from "./bot.seed";

export type SeedPick = {
  name: string;
  provider?: string | null;
  model?: string | null;
  /** The face the intro already showed. Without it the action rolls one. */
  color?: string;
};

/**
 * Creates the seed roster. Call only after a voice key is saved: seed bots
 * need a resolvable default model. Fire-and-forget; failure only toasts.
 * Without picks, the recommended seeds are created on the app default model.
 */
export function installSeedBots(picks?: SeedPick[]) {
  const wanted =
    picks ??
    BOT_SEEDS.filter((seed) => seed.recommended).map((seed) => ({
      name: seed.name,
    }));
  if (!wanted.length) return;

  void createSeedBotsAction(wanted)
    .then(unwrapResult)
    // The roster is read through SWR; `router.refresh` alone would not update it.
    .then(() => revalidate(queryKey.bot))
    .catch((cause) =>
      toast.add({
        type: "warning",
        title: "Could not set up the bots",
        description: errorToString(cause),
      }),
    );
}
