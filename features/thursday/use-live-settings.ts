"use client";

import { useCallback, useEffect, useRef } from "react";
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
 * A save sends every field, since the screen holds every field: nothing to merge, and no
 * order for two saves to disagree about.
 */
export function useLiveSettings() {
  const { data: settings } = useServerRoute<LiveSettings>(
    queryKey.thursdaySettings,
  );
  const [save] = useServerAction(setLiveSettingsAction, {
    onOk: () => revalidate(queryKey.thursdaySettings),
  });

  const held = useRef(settings);
  held.current = settings;
  const patch = useCallback(
    (change: Partial<LiveSettings>) => {
      const now = held.current;
      if (now) void save({ ...now, ...change });
    },
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
