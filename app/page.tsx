import { rollSeedIcons } from "@/features/bot/bot.seed";
import { isCallable } from "@/features/config/config.query";
import { Intro } from "@/features/intro/components/intro";
import { Boot } from "@/features/thursday/components/boot";
import { Thursday } from "@/features/thursday/components/thursday";

/**
 * The app's only screen. The call screen always renders (it shows its own
 * no-key state); the intro overlays it when there is no key or `?intro` is set.
 */
export default async function Home({ searchParams }: PageProps<"/">) {
  const { intro } = await searchParams;
  const ready = await isCallable();

  return (
    <div className="h-full min-h-0 flex-1">
      <Thursday />
      {/* Decided on the server: toggling after hydration flashes the first frame.
          The seed faces are rolled here for the same reason (bot.seed). */}
      <Intro
        ready={ready}
        forced={intro !== undefined}
        icons={rollSeedIcons()}
      />
      <Boot />
    </div>
  );
}
