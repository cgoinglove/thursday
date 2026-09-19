import { rollSeedIcons } from "@/features/bot/bot.seed";
import { isCallable } from "@/features/config/config.query";
import { Intro } from "@/features/intro/components/intro";
import { ReachAsk } from "@/features/reach/components/reach-ask";
import { Boot } from "@/features/thursday/components/boot";
import { Thursday } from "@/features/thursday/components/thursday";
import { hasAnyCall } from "@/features/thursday/thursday.query";

/**
 * The app's only screen. The call screen always renders (it shows its own
 * no-key state); the intro overlays it until a first call has been placed here, or
 * when `?intro` asks for it.
 */
export default async function Home({ searchParams }: PageProps<"/">) {
  const { intro } = await searchParams;
  const [ready, called] = await Promise.all([isCallable(), hasAnyCall()]);

  return (
    <div className="h-full min-h-0 flex-1">
      <Thursday />
      {/* Decided on the server: toggling after hydration flashes the first frame.
          The seed faces are rolled here for the same reason (bot.seed). */}
      <Intro
        ready={ready}
        firstRun={!called}
        forced={intro !== undefined}
        icons={rollSeedIcons()}
      />
      <ReachAsk />
      <Boot />
    </div>
  );
}
