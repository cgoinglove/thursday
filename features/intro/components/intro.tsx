"use client";

import { Check, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { type Ref, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/notify";
import ShinyText from "@/components/ui/shiny-text";
import TextType from "@/components/ui/text-type";
import { APP_NAME } from "@/config";
import { ModelPicker } from "@/features/ai/components/model-picker";
import { type TextModelProviderId } from "@/features/ai/model.schema";
import { DEFAULT_BOT } from "@/features/bot/bot.schema";
import { BOT_SEEDS, type BotSeed } from "@/features/bot/bot.seed";
import { BotMark } from "@/features/bot/components/bot-mark";
import { installSeedBots } from "@/features/bot/seed-bots";
import {
  VoiceKeys,
  type VoiceKeysHandle,
} from "@/features/config/components/voice-key";
import { AsciiField } from "@/features/thursday/components/ascii-field";
import { INTRO_FACE } from "@/features/thursday/components/boot";
import { cn } from "@/lib/utils";

/**
 * The first-run screen: three steps, laid over the call screen (app/page).
 * Nothing about it is remembered in the browser; a missing key is a server
 * fact and the intro shows again until one is saved.
 */

/** The face shrinks aside on the two asking steps; the first step uses `INTRO_FACE`. */
const ASIDE = { rim: 0.03, clearAt: 0.24 };
const FIRST_CLEAR = 0.52;

const STEPS = 3;

/** Must match the `duration-700` below. */
const FADE_MS = 700;

export function Intro({
  /** A voice key already exists (as the server saw it). */
  ready,
  /** Opened deliberately via `?intro`. */
  forced,
  /** One colour per BOT_SEEDS entry (bot.seed rollSeedColors), rolled on the server so hydration keeps the same faces. */
  colors,
}: {
  ready: boolean;
  forced: boolean;
  colors: string[];
}) {
  const ink = (seed: BotSeed) =>
    colors[BOT_SEEDS.indexOf(seed)] ?? seed.icon?.color;

  const router = useRouter();
  const [at, setAt] = useState(0);
  const [gone, setGone] = useState(false);
  /** After the fade; then the element is removed entirely. */
  const [lifted, setLifted] = useState(false);
  const [keyed, setKeyed] = useState(ready);
  const [picks, setPicks] = useState<Record<string, Pick>>(() =>
    Object.fromEntries(
      BOT_SEEDS.map((seed) => [
        seed.name,
        { on: Boolean(seed.recommended), provider: null, model: "" },
      ]),
    ),
  );
  const keys = useRef<VoiceKeysHandle>(null);
  const [saving, setSaving] = useState(false);

  /** Next step. On the key step, an unsaved key is offered a save first; a failed save does not advance. */
  const next = async () => {
    if (at === 1 && keys.current?.pending()) {
      const save = await notify.confirm({
        title: "Save this key first?",
        description:
          "There is a key in the field that has not been saved. Leaving now drops it.",
        okText: "Save and continue",
        cancelText: "Discard it",
      });
      if (save) {
        setSaving(true);
        const done = await keys.current.flush();
        setSaving(false);
        if (!done) return;
      }
    }
    setAt((step) => step + 1);
  };

  // Unmount after the fade: left transparent, the AsciiField rAF loop would
  // keep running behind the call screen. `ready` is a server prop and does
  // not change when a key is saved in this session
  useEffect(() => {
    if (!gone) return;
    const end = setTimeout(() => setLifted(true), FADE_MS);
    return () => clearTimeout(end);
  }, [gone]);

  if (lifted) return null;
  if (ready && !forced) return null;

  const first = at === 0;

  /** With a key, install the picked bots (they need a model, so not without one) and re-render; without, just lift. */
  const leave = () => {
    setGone(true);
    if (!keyed) return;
    installSeedBots(
      BOT_SEEDS.filter((seed) => picks[seed.name]?.on).map((seed) => ({
        name: seed.name,
        // A half pick is not a model; the action falls back to the default
        provider: picks[seed.name]?.provider ?? null,
        model: picks[seed.name]?.model || null,
        color: ink(seed),
      })),
    );
    router.replace("/");
    router.refresh();
  };

  const patch = (name: string, next: Partial<Pick>) =>
    setPicks((all) => ({ ...all, [name]: { ...all[name], ...next } }));

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 bg-background transition-opacity duration-700",
        gone && "pointer-events-none opacity-0",
      )}
    >
      <AsciiField
        rim={first ? INTRO_FACE.rim : ASIDE.rim}
        centerY={INTRO_FACE.centerY}
        clearAt={first ? FIRST_CLEAR : ASIDE.clearAt}
        clearBy={first ? 0.7 : 0.55}
        className="absolute inset-0"
      />

      <div className="absolute inset-x-12 top-22 bottom-44 flex flex-col items-center justify-center overflow-y-auto">
        {at === 0 && <FirstLook ink={ink} />}
        {at === 1 && <KeyStep ref={keys} onSaved={() => setKeyed(true)} />}
        {at === 2 && <BotStep picks={picks} ink={ink} onPatch={patch} />}
      </div>

      <div className="absolute inset-x-0 bottom-13 flex flex-col items-center gap-5.5">
        <div className="flex flex-col items-center gap-2.5">
          {at === STEPS - 1 ? (
            <Button onClick={leave} className="h-12 px-6 pl-7 text-[15px]">
              {keyed ? "Start talking" : "Look around"}
              <ChevronRight />
            </Button>
          ) : (
            <Button
              onClick={next}
              loading={saving}
              className="h-12 px-6 pl-7 text-[15px]"
            >
              {at === 0 ? "Set up" : "Continue"}
              <ChevronRight />
            </Button>
          )}
          {at === 1 && !keyed && (
            <Button
              variant="ghost"
              onClick={() => setAt(2)}
              className="h-8 text-[13.5px] text-muted-foreground"
            >
              I will add it later
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1.75">
          {Array.from({ length: STEPS }, (_, step) => (
            <span
              key={step}
              className={cn(
                "h-1.75 rounded-full transition-all duration-300",
                step === at ? "w-5.5 bg-foreground" : "w-1.75",
                step < at ? "bg-foreground/40" : "",
                step > at ? "bg-border" : "",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Step one: the three lines the call screen actually draws, no chat bubbles. */
function FirstLook({ ink }: { ink: Ink }) {
  const crew = BOT_SEEDS.slice(0, 3);

  return (
    <div className="flex w-full flex-col items-center">
      {/* Room for the face; the field draws over it */}
      <div className="h-[19rem] shrink-0" />

      <span className="flex animate-in items-center gap-2.5 rounded-full bg-muted/50 py-1.5 pr-3.5 pl-1.5 ring-1 ring-border/60 fade-in slide-in-from-bottom-1 duration-700 [animation-delay:1.9s] [animation-fill-mode:backwards]">
        <span className="flex">
          {crew.map((seed, index) => (
            <BotMark
              key={seed.name}
              size={22}
              seed={seed.name}
              vary={seed.name}
              color={ink(seed)}
              shape={seed.icon?.shape}
              outline={seed.icon?.outline}
              state="thinking"
              notify={false}
              className={cn("shrink-0", index > 0 && "-ml-1.5")}
            />
          ))}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {crew.length === 1 ? "A bot is on it" : "Bots are on it"}
        </span>
        <span className="font-mono text-[10.5px] text-muted-foreground/70">
          ask_bot
        </span>
      </span>

      <p className="mt-6 max-w-xl animate-in text-center text-[21px] leading-relaxed text-balance break-keep fade-in duration-1000 [animation-delay:2.5s] [animation-fill-mode:backwards]">
        On it — {crew.length === 1 ? "a bot" : "the bots"} went to look. Keep
        talking, I&rsquo;ll say when it is back.
      </p>

      <span className="mt-10 flex h-6 items-center gap-2 font-mono text-sm text-muted-foreground">
        <TextType
          as="span"
          text={`Say "Hey ${APP_NAME}" to start talking`}
          loop={false}
          typingSpeed={52}
          initialDelay={500}
          cursorCharacter="▌"
          cursorClassName="ml-0.5 text-muted-foreground/50"
          className="tracking-normal"
        />
      </span>
    </div>
  );
}

/** Step two: the voice key. */
function KeyStep({
  ref,
  onSaved,
}: {
  /** Lets the footer's "Continue" ask about unsaved fields (VoiceKeysHandle). */
  ref?: Ref<VoiceKeysHandle>;
  onSaved: (provider: TextModelProviderId) => void;
}) {
  return (
    <div className="flex w-full max-w-lg flex-col items-center">
      <h1 className="text-center text-[34px] font-medium tracking-tight text-balance break-keep">
        One key opens the call.
      </h1>
      <p className="mt-3.5 max-w-md text-center text-base leading-relaxed text-pretty text-muted-foreground break-keep">
        Calls run on a speech model — the only thing this app cannot do without.
        Bots, memory and settings do not need it.
      </p>
      <VoiceKeys ref={ref} className="mt-9" autoFocus onSaved={onSaved} />
    </div>
  );
}

/** This intro's colour for a seed (bot.seed rollSeedColors). */
type Ink = (seed: BotSeed) => string | undefined;

/** What the intro knows about one bot. An empty model is the default and means "app default" at run time. */
type Pick = {
  on: boolean;
  provider: TextModelProviderId | null;
  model: string;
};

/** Step three: which seed bots to install. */
function BotStep({
  picks,
  ink,
  onPatch,
}: {
  picks: Record<string, Pick>;
  ink: Ink;
  onPatch: (name: string, next: Partial<Pick>) => void;
}) {
  const on = BOT_SEEDS.filter((seed) => picks[seed.name]?.on);

  return (
    <div className="flex w-full max-w-2xl flex-col items-center">
      <h1 className="text-center text-[30px] font-medium tracking-tight text-balance break-keep">
        {BOT_SEEDS.length === 1
          ? "One bot comes with her."
          : `${BOT_SEEDS.length === 2 ? "Two" : BOT_SEEDS.length} bots come with her.`}
      </h1>
      <p className="mt-3 max-w-lg text-center text-[15px] leading-relaxed text-pretty text-muted-foreground break-keep">
        {BOT_SEEDS.length === 1
          ? "It takes the work that would leave the call silent, and reports back."
          : "They take the work that would leave the call silent, and report back."}
      </p>

      {/* The pill these faces will stand in (bot-room Folded) */}
      <span className="mt-5 flex h-9 items-center gap-2 rounded-full bg-muted/50 py-1.5 pr-3.5 pl-1.5 ring-1 ring-border/60">
        {on.length > 0 ? (
          <>
            <span className="flex">
              {on.map((seed, index) => (
                <BotMark
                  key={seed.name}
                  size={22}
                  seed={seed.name}
                  vary={seed.name}
                  color={ink(seed)}
                  shape={seed.icon?.shape}
                  outline={seed.icon?.outline}
                  notify={false}
                  className={cn("shrink-0", index > 0 && "-ml-1.5")}
                />
              ))}
            </span>
            <ShinyText
              text="handed-over work shows up here"
              speed={2.2}
              color="var(--muted-foreground)"
              shineColor="var(--foreground)"
              className="font-mono text-[10.5px] leading-4"
            />
          </>
        ) : (
          <span className="px-2 font-mono text-[10.5px] text-muted-foreground">
            nobody on the roster — {DEFAULT_BOT.name} takes it
          </span>
        )}
      </span>

      {/* Two columns, the first seed across both: three seeds are two rows, not
          three, and the step stops scrolling on a short screen */}
      <div className="mt-4 grid w-full max-w-3xl grid-cols-2 items-start gap-2">
        {BOT_SEEDS.map((seed, index) => (
          <SeedRow
            key={seed.name}
            seed={seed}
            pick={picks[seed.name]}
            ink={ink(seed)}
            className={index === 0 ? "col-span-2" : ""}
            onPatch={(next) => onPatch(seed.name, next)}
          />
        ))}
      </div>
    </div>
  );
}

/** One seed bot row, on by default. The model is not prefilled; empty means the app default. */
function SeedRow({
  seed,
  pick,
  ink,
  className,
  onPatch,
}: {
  seed: BotSeed;
  pick?: Pick;
  ink?: string;
  className?: string;
  onPatch: (next: Partial<Pick>) => void;
}) {
  const on = Boolean(pick?.on);

  return (
    <div
      className={cn(
        // min-w-0: a grid track sizes to its content otherwise, and the example
        // line stops truncating and runs out of the card
        "min-w-0 rounded-2xl ring-1 transition-colors",
        on ? "ring-foreground" : "ring-border/60",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onPatch({ on: !on })}
        aria-pressed={on}
        className="flex w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <BotMark
          size={34}
          seed={seed.name}
          vary={seed.name}
          color={ink}
          shape={seed.icon?.shape}
          outline={seed.icon?.outline}
          state={on ? "thinking" : "idle"}
          notify={false}
          className={cn("shrink-0 transition-opacity", !on && "opacity-35")}
        />

        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block text-[15.5px] font-medium">{seed.name}</span>
          <span className="block text-[13px] leading-normal text-pretty text-muted-foreground break-keep">
            {seed.description}
          </span>
          {on ? (
            <ShinyText
              text={`“${seed.example}”`}
              speed={2.2}
              color="var(--muted-foreground)"
              shineColor="var(--foreground)"
              className="truncate font-mono text-[11px] leading-4"
            />
          ) : (
            <span className="block truncate font-mono text-[11px] leading-4 text-muted-foreground/50">
              off
            </span>
          )}
        </span>

        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full transition-colors",
            on
              ? "bg-foreground text-background"
              : "ring-1 ring-border/60 ring-inset",
          )}
        >
          {on && <Check className="size-3.5" />}
        </span>
      </button>

      {on && (
        <div className="px-4 pb-3.5">
          <ModelPicker
            provider={pick?.provider ?? null}
            model={pick?.model ?? ""}
            onChange={(next) => onPatch(next)}
          />
        </div>
      )}
    </div>
  );
}
