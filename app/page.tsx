import { AppEventSource } from "@/app/api/events/app-event.client";
import { rollSeedIcons } from "@/features/bot/bot.seed";
import { isCallable } from "@/features/config/config.query";
import { Intro } from "@/features/intro/components/intro";
import { hasPassedIntro } from "@/features/intro/intro.query";
import { ReachAsk } from "@/features/reach/components/reach-ask";
import { Boot } from "@/features/thursday/components/boot";
import { Thursday } from "@/features/thursday/components/thursday";
import { hasAnyCall } from "@/features/thursday/thursday.query";

/**
 * The app's only screen. The call screen always renders (it shows its own
 * no-key state); the intro overlays it until it has been left once, or a call placed here
 * before it remembered that, or when `?intro` asks for it.
 *
 * The event stream is opened here rather than in the layout: this is the one
 * screen that listens, and a tab holding a stream nothing reads costs the app a
 * browser connection and counts as a watcher (app-event.client).
 */
export default async function Home({ searchParams }: PageProps<"/">) {
  const { intro } = await searchParams;
  const [ready, called, passed] = await Promise.all([
    isCallable(),
    hasAnyCall(),
    hasPassedIntro(),
  ]);

  return (
    <div className="h-full min-h-0 flex-1">
      <Thursday ready={ready} />
      {/* Decided on the server: toggling after hydration flashes the first frame.
          The seed faces are rolled here for the same reason (bot.seed). */}
      <Intro
        ready={ready}
        firstRun={!called && !passed}
        forced={intro !== undefined}
        icons={rollSeedIcons()}
      />
      <ReachAsk />
      <Boot />
      <AppEventSource />
    </div>
  );
}
