"use client";

import { AppWindowMac } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

/**
 * Installing the app as its own window (app/manifest). Chrome and Edge tell a page when it
 * can be installed (`beforeinstallprompt`) and let the page ask for it; their own icon in the
 * address bar is easy to miss. The call screen offers it once, until it is taken or waved
 * off (`InstallNudge`), and the foot of the settings nav keeps it for as long as the browser
 * offers it (`InstallButton`). Safari and Firefox never tell, so neither shows there;
 * guide/setup.md says how in Safari.
 */

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** The call screen has offered it and was answered; the settings nav still offers it. */
const ASKED_KEY = "thursday.install-asked";

let offer: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

// Listened for as the module loads: the browser says it once, early, whoever is on screen
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // the page offers it itself, so the browser's own bar stays away
    event.preventDefault();
    offer = event as InstallPrompt;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    changed();
  });
}

function useOffer() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => offer,
    () => null,
  );
}

/** Opens the browser's own install dialog. A prompt answers once, taken or not. */
async function install() {
  const prompt = offer;
  if (!prompt) return;
  offer = null;
  changed();
  await prompt.prompt();
  await prompt.userChoice.catch(() => undefined);
}

/**
 * The one offer on the call screen, under the settings corner: once Install or Not now is
 * pressed it does not come back. Kept out of the way of a call, a ring and a call in writing.
 */
export function InstallNudge({ hidden }: { hidden: boolean }) {
  const can = useOffer() !== null;
  // unknown until the browser's storage is read: shown only once it says never asked
  const [asked, setAsked] = useState(true);
  useEffect(() => {
    try {
      setAsked(window.localStorage.getItem(ASKED_KEY) !== null);
    } catch {
      // storage may be blocked; better never to ask than to ask on every load
    }
  }, []);

  if (!can || asked || hidden) return null;
  const answered = () => {
    setAsked(true);
    try {
      window.localStorage.setItem(ASKED_KEY, "1");
    } catch {
      // blocked storage: it goes for this load, and may be offered again
    }
  };
  return (
    <div className="flex w-76 animate-in items-start gap-3 rounded-2xl bg-background p-3.5 shadow-[0_22px_44px_-20px_rgb(0_0_0/0.22)] ring-1 ring-border duration-300 fade-in slide-in-from-top-1">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
        <AppWindowMac className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="text-[13px] leading-snug">
          <span className="block font-medium">Keep her in her own window</span>
          <span className="block text-muted-foreground">
            Install Thursday as an app, with its own icon. A closed tab no
            longer takes her calls with it.
          </span>
        </p>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            className="rounded-full px-3.5"
            onClick={() => {
              answered();
              void install();
            }}
          >
            Install
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full px-3 text-muted-foreground"
            onClick={answered}
          >
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}

/** At the foot of the settings nav, for as long as the browser offers it. */
export function InstallButton() {
  const can = useOffer() !== null;
  if (!can) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full justify-start gap-2 rounded-lg font-normal"
      onClick={() => void install()}
    >
      <AppWindowMac />
      Install as an app
    </Button>
  );
}
