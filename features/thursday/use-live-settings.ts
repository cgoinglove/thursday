"use client";

import { useCallback, useEffect } from "react";
import { queryKey } from "@/app/api/query-key";
import type { LiveSettings } from "@/features/ai/live.schema";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import {
  seedLiveSettingsAction,
  setLiveSettingsAction,
} from "./thursday.action";
import { useThursdayStore } from "./thursday.store";

/**
 * Settings › Thursday as the app keeps them, and one call to change them. Undefined until
 * the read lands: there is no browser copy to draw meanwhile, which is the point — one
 * kept where a call reads it is the one a phone writing in and a second computer get too
 * (thursday.query readLiveSettings).
 *
 * A save sends only what changed and the server lays it over what it keeps: a whole row
 * built on the last read put back a field changed a moment before, while that save was
 * still on its way.
 */
export function useLiveSettings() {
  const { data: settings } = useServerRoute<LiveSettings>(
    queryKey.thursdaySettings,
  );
  const [save] = useServerAction(setLiveSettingsAction, {
    onOk: () => revalidate(queryKey.thursdaySettings),
  });

  const patch = useCallback(
    (change: Partial<LiveSettings>) => void save(change),
    [save],
  );

  useCarriedSettings();
  return { settings, patch };
}

/**
 * The copy a browser kept before these moved to the server, handed over on the first load
 * that finds one. The server takes it only while it holds none of its own, so a machine
 * opened later cannot put its old settings over what is kept; either way this browser
 * stops holding them.
 */
function useCarriedSettings() {
  const carried = useThursdayStore((state) => state.carried);
  const done = useThursdayStore((state) => state.carriedDone);
  const [seed] = useServerAction(seedLiveSettingsAction, {
    onOk: (taken) => {
      if (taken) revalidate(queryKey.thursdaySettings);
    },
    errorMessage: false,
  });

  useEffect(() => {
    if (!carried) return;
    done();
    void seed(carried);
  }, [carried, done, seed]);
}
