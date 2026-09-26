"use client";

import { queryKey } from "@/app/api/query-key";
import { toast } from "@/components/ui/toast";
import { unwrapResult } from "@/lib/protocol/result";
import { revalidate } from "@/lib/protocol/use-server-route";
import { errorToString } from "@/lib/utils";
import { createSeedBotsAction } from "./bot.action";
import { BOT_SEEDS } from "./bot.seed";

type SeedPick = {
  name: string;
  provider?: string | null;
  model?: string | null;
};

/**
 * Creates the seed roster. No key is needed: a bot's model is resolved when it runs
 * (bot.run), so one made on a machine with no key yet runs once there is one.
 * Fire-and-forget; failure only toasts. Without picks, every seed is created on the app
 * default model.
 */
export function installSeedBots(picks?: SeedPick[]) {
  const wanted =
    picks ??
    BOT_SEEDS.map((seed) => ({
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
