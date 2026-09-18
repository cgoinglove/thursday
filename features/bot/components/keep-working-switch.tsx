"use client";

import { queryKey } from "@/app/api/query-key";
import { Switch } from "@/components/ui/switch";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { setKeepWorkingOnAction } from "../bot.action";

const LABEL = "Work while the app is closed";

/**
 * The one switch for whether anything runs with no tab open (bot.schema KEEP_WORKING_KEY):
 * running jobs, and a routine whose time has come. Drawn on every rail whose promise hangs on
 * it (Bots, Routines); both read and write the same key, so neither can disagree with the other.
 */
export function KeepWorkingSwitch() {
  const { data: on, mutate } = useServerRoute<boolean>(queryKey.botKeepWorking);
  const [write] = useServerAction(setKeepWorkingOnAction, {
    onOk: () => revalidate(queryKey.botKeepWorking),
  });
  return (
    <>
      <span
        className="shrink-0 text-xs text-muted-foreground"
        title="Off, closing the last tab stops running jobs and holds routines until one is open again. On, they run until the server stops."
      >
        {LABEL}
      </span>
      <Switch
        checked={on ?? false}
        disabled={on === undefined}
        onCheckedChange={(next) => {
          void mutate(next, false);
          write(next);
        }}
        aria-label={LABEL}
      />
    </>
  );
}
