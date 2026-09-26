"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Mic,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { ShinyText } from "@/components/ui/shiny-text";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ModelPicker } from "@/features/ai/components/model-picker";
import {
  type AutomaticModel,
  parseTextModel,
  type TextModelProviderId,
} from "@/features/ai/model.schema";
import { PERSONAS } from "@/features/ai/prompts/persona";
import type { BotIcon } from "@/features/bot/bot.schema";
import { BOT_SEEDS, type BotSeed, ERRANDS_BOT } from "@/features/bot/bot.seed";
import { BotMark } from "@/features/bot/components/bot-mark";
import { installSeedBots } from "@/features/bot/seed-bots";
import { AccountsSetup } from "@/features/config/components/config-setting";
import { GetKeyLink, VoiceKeys } from "@/features/config/components/voice-key";
import {
  removeConfigAction,
  setConfigAction,
} from "@/features/config/config.action";
import {
  type ConfigStatus,
  DEFAULT_EFFORT_KEY,
  DEFAULT_MODEL_KEY,
} from "@/features/config/config.const";
import { Echoes } from "@/features/intro/components/echoes";
import { passIntroAction } from "@/features/intro/intro.action";
import { type IntroLine, useIntroVoice } from "@/features/intro/intro-voice";
import { callSignal } from "@/features/thursday/call-signal";
import { Face } from "@/features/thursday/components/face";
import {
  SideCaptions,
  type Turn,
  useTurnFocus,
} from "@/features/thursday/components/side-captions";
import { Ear } from "@/features/thursday/components/thursday";
import { awake } from "@/features/thursday/face-words";
import { silentVoice } from "@/features/thursday/silent-voice";
import type { CallStatus, FaceWord } from "@/features/thursday/thursday.schema";
import { useThursdayStore } from "@/features/thursday/thursday.store";
import { useLiveSettings } from "@/features/thursday/use-live-settings";
import {
  type Finished,
  FinishedCard,
} from "@/features/workspace/components/artifact-view";
import { useWakeWord } from "@/hooks/use-wake-word";
import { type AudioTap, createAudioTap } from "@/lib/live/live.tap";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";

/**
 * The first run, laid over the call screen (app/page) and drawn as the call screen:
 * her face in the same place, her words down its left as captions are, and on its
 * right — where the caller's words go — the caller's turn: a key, the microphone, who
 * works for them, what those think with. It opens on her coming down to her own size
 * (echoes.tsx), then on the app's one loop played silently in place, and its last button
 * is the first call. No step holds anyone: every one can be passed at once and done later
 * from the screen it belongs to. It shows until it has been left once (intro.query), or
 * whenever `?intro` asks (app/page `firstRun`).
 */

const STEPS = ["key", "mic", "bots", "models", "style", "call"] as const;
type Step = "hello" | (typeof STEPS)[number];

/** Her words, long enough to sit well beside her face: two or three lines. */
const SAYS = {
  key: "I am Thursday. My voice comes from OpenAI, so the first thing I need is a key: paste one and I wake up. No key yet? Go on without it, and I will ask again when you call.",
  awake:
    "There, I am awake, and that key is everything a call needs. From here on it is quick: your microphone, who works for you, and what they think with.",
  mic: "Now let me hear you. Your browser asks before it opens the microphone: say yes, then say anything at all and watch the line under me move. It is only open on a call, unless you ask for more.",
  heard:
    "I hear you: that line is your voice. If you would rather wake me by saying my name than by tapping me, switch it on here and try it once.",
  bots: "Long work goes to bots, so we can keep talking while they are at it. They work on this computer, with a shell, a browser and your files, and signing in or paying always stays with you.",
  models:
    "Bots think with a model you choose. Start small: a small model is quick and costs little, and any bot can move up later. An OpenAI key already covers it; a GPT subscription or one Vercel key opens far more.",
  style:
    "One more, and it is the fun one: who I am to you. Four of them, and the only difference is how I talk — pick whoever sounds like someone you would call, and change your mind whenever you like.",
  call: "That is everything I need. Call me, tell me what to call you, and ask for one thing, anything you would ask a person at the next desk. I will show you the rest as we go.",
  asleep:
    "I still have no voice of my own, so there is no call yet, but everything else works. Look around; tap me whenever you have a key and I will take it from there.",
  asleepBare:
    "I still have no voice of my own, and my bots have nothing to think with yet, so there is no call and no job for now. Look around; add a key or sign in with ChatGPT whenever you like, and I will take it from there.",
} as const;

/** Must match the `duration-700` below. */
const FADE_MS = 700;

/**
 * Where the opening stands: her larger sizes stepping down, her face in its place, the first
 * screen up while the last crumbs go, and over.
 */
type Opening = "echoes" | "her" | "hello" | "over";

export function Intro({
  /** A voice key already exists (as the server saw it). */
  ready,
  /** No call has been placed here yet. */
  firstRun,
  /** Opened deliberately via `?intro`. */
  forced,
  /** One face per BOT_SEEDS entry (bot.seed rollSeedIcons), rolled on the server so hydration keeps the same faces. */
  icons,
}: {
  ready: boolean;
  firstRun: boolean;
  forced: boolean;
  icons: BotIcon[];
}) {
  const shown = firstRun || forced;
  const router = useRouter();
  const [step, setStep] = useState<Step>("hello");
  const [gone, setGone] = useState(false);
  /** After the fade; then the element is removed entirely. */
  const [lifted, setLifted] = useState(false);
  const [keyed, setKeyed] = useState(ready);
  const [word, setWord] = useState<FaceWord | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>(() =>
    // every bot comes along unless it is switched off here
    Object.fromEntries(BOT_SEEDS.map((seed) => [seed.name, true])),
  );
  const [opening, setOpening] = useState<Opening>("echoes");
  // her face comes in on the opening's last beat, and the first screen after it
  const herIn = opening !== "echoes";
  const helloIn = opening === "hello" || opening === "over";
  /** The box her face stands in, which the opening is laid on. */
  const faceBox = useRef<HTMLDivElement>(null);
  const mic = useMic(step === "mic" && !gone);
  const demo = useDemo(step === "hello" && shown && !gone && helloIn);

  // The call under the intro keeps its wake word and hotkey off until it is gone
  const up = shown && !gone;
  useEffect(() => {
    callSignal.hold(up);
    return () => callSignal.hold(false);
  }, [up]);

  // Unmount after the fade, or her face keeps drawing behind the call screen
  useEffect(() => {
    if (!gone) return;
    const end = setTimeout(() => setLifted(true), FADE_MS);
    return () => clearTimeout(end);
  }, [gone]);

  const at = STEPS.indexOf(step as (typeof STEPS)[number]);
  // Whether bots have a model to run on, as a run would resolve it: without one, "everything
  // else works" was not true on a machine with no key at all
  const { data: automatic } = useServerRoute<AutomaticModel>(
    queryKey.automaticModel,
  );
  const thinks = Boolean(automatic?.ref);
  const said = useMemo(
    () => herTurns(step, keyed, mic.on, thinks),
    [step, keyed, mic.on, thinks],
  );
  const turns = step === "hello" ? demo.turns : said;
  // Only while it is up: mounted on every page load, its ↓ took the key from every call after
  const focus = useTurnFocus(turns, up);
  // Her latest line is also a clip (intro-voice); every id `herTurns` gives is one
  const voice = useIntroVoice(
    gone ? null : ((said.at(-1)?.id as IntroLine | undefined) ?? null),
  );

  if (lifted || !shown) return null;

  const face = (seed: BotSeed) => icons[BOT_SEEDS.indexOf(seed)];

  /**
   * On the first run, installs the picked bots, key or no key: a bot needs no model to be made,
   * only to run, and the model is resolved at each run (bot.run). Left for the first key, the
   * picks were lost, and the key saved later brought every seed, the ones switched off here too.
   * Only then: seen again through `?intro`, a leave brought back bots deleted since.
   * `calling` places the first call from inside this click.
   */
  const leave = (calling: boolean) => {
    voice.hush();
    setGone(true);
    if (firstRun) {
      installSeedBots(
        BOT_SEEDS.filter((seed) => picked[seed.name]).map((seed) => ({
          name: seed.name,
          icon: face(seed),
        })),
      );
      // a failure costs only the intro once more on the next load
      void passIntroAction();
    }
    if (calling) callSignal.place();
    router.replace("/");
    router.refresh();
  };

  const status: CallStatus =
    step === "hello"
      ? demo.status
      : voice.speaking
        ? "speaking"
        : step === "mic" && mic.on
          ? "listening"
          : "idle";
  const last = step === "call";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Getting started"
      className={cn(
        "fixed inset-0 z-40 bg-background transition-opacity duration-700",
        gone && "pointer-events-none opacity-0",
      )}
    >
      {opening !== "over" && (
        <Echoes
          anchor={faceBox}
          onArrive={() => setOpening("her")}
          onHello={() => setOpening("hello")}
          onDone={() => setOpening("over")}
        />
      )}

      {/* Her recorded voice, and the way to switch it off */}
      {helloIn && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={voice.toggle}
                  aria-label={voice.muted ? "Let her speak" : "Mute her"}
                  aria-pressed={voice.muted}
                  className="absolute top-5 right-5 z-10 text-muted-foreground hover:text-foreground"
                />
              }
            >
              {voice.muted ? <VolumeX /> : <Volume2 />}
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {voice.muted ? "Let her speak" : "Mute her voice"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* The call screen's own column, so nothing moves when the intro lifts */}
      <div className="flex h-full flex-col items-center justify-center gap-5 pt-[7vh]">
        {/* The call screen's face box and `--face-bleed`: the canvas draws past the box, and
            what stands beside her stands past the canvas */}
        <div
          ref={faceBox}
          className="relative w-[min(20rem,52vw,37.5vh)] [--face-bleed:19.5%]"
        >
          <button
            type="button"
            disabled={!last || !keyed}
            onClick={() => leave(true)}
            aria-label={last && keyed ? "Call Thursday" : undefined}
            // asleep, not broken: the same face, dimmed, until she has a voice
            className={cn(
              "block w-full rounded-full outline-none transition-all duration-700 ease-out focus-visible:ring-3 focus-visible:ring-ring/50",
              step !== "hello" && !keyed && "opacity-35",
            )}
          >
            {herIn ? (
              <Face
                status={status}
                failed={false}
                word={word}
                getSpectrum={step === "hello" ? demo.voice : voice.spectrum}
                waking
                className="-m-(--face-bleed) w-[calc(100%+2*var(--face-bleed))] max-w-none"
              />
            ) : (
              // her box, kept its size while the opening plays in it
              <div className="aspect-square w-full" />
            )}
          </button>

          <SideCaptions
            turns={turns}
            pinned={focus.pinned}
            live={step === "hello" ? demo.saying : voice.speaking}
            onPick={focus.pick}
          />

          {step !== "hello" && (
            // Where the caller's words go on a call: the caller's turn
            <div
              key={step}
              className="absolute top-1/2 left-full ml-[calc(var(--face-bleed)+0.375rem)] flex w-[min(22rem,26vw)] -translate-y-1/2 animate-in flex-col gap-4 text-left fade-in slide-in-from-bottom-1 duration-300"
            >
              {step === "key" && (
                <KeyTurn
                  keyed={keyed}
                  onSaved={() => {
                    setKeyed(true);
                    setWord(awake());
                  }}
                />
              )}
              {step === "mic" && <MicTurn mic={mic} />}
              {step === "bots" && (
                <BotsTurn
                  picked={picked}
                  face={face}
                  onToggle={(name) =>
                    setPicked((all) => ({ ...all, [name]: !all[name] }))
                  }
                />
              )}
              {step === "models" && <ModelsTurn />}
              {step === "style" && <StyleTurn />}
            </div>
          )}
        </div>

        <div className="flex w-full max-w-3xl flex-col items-center gap-4 px-6 text-center">
          {/* One slot of one height for her first words or the step's state, and the rows
              under the button keep theirs: her face and the button stand still from step to step */}
          <div className="flex h-14 items-center gap-2 text-[13px] text-muted-foreground">
            {step === "hello" ? (
              helloIn && (
                <p className="max-w-130 animate-in text-[20px] leading-[1.5] text-balance text-foreground duration-700 fill-mode-backwards fade-in slide-in-from-bottom-2">
                  Just talk to her. She gets it done on this computer, and tells
                  you when it is ready.
                </p>
              )
            ) : step === "mic" && mic.on ? (
              <Ear live getMicSpectrum={mic.spectrum} />
            ) : !keyed ? (
              "Asleep"
            ) : last ? (
              <Ready
                mic={mic.allowed}
                bots={BOT_SEEDS.filter((seed) => picked[seed.name]).length}
              />
            ) : null}
          </div>

          {/* the first screen's rows keep their heights while the opening plays, so she is
              laid out where she will stand */}
          {step === "hello" && !helloIn ? (
            <div className="h-12" />
          ) : (
            <Button
              variant="brand"
              // Asked from the button the eye is already on: a second, smaller one beside her
              // was the one that went unpressed (09-26). On once, it goes on as every step does
              loading={step === "mic" && mic.asking}
              onClick={() => {
                if (step === "hello") {
                  // Inside this click, so the browser lets her be heard from here on
                  voice.say("hello", keyed ? "awake" : "key");
                  setStep("key");
                } else if (step === "mic" && !mic.on) void mic.turnOn();
                else if (last) leave(keyed);
                else setStep(STEPS[at + 1]);
              }}
              // on the first screen it follows her line up, once
              className={cn(
                "h-12 px-7 pl-8 text-[15px]",
                step === "mic" && !mic.on && "pl-6",
                step === "hello" &&
                  "animate-in delay-300 duration-700 fill-mode-backwards fade-in slide-in-from-bottom-2",
              )}
            >
              {step === "mic" && !mic.on && !mic.asking && (
                <Mic className="fill-current" />
              )}
              {step === "hello"
                ? "Start"
                : step === "mic" && !mic.on
                  ? "Turn on the microphone"
                  : last
                    ? keyed
                      ? "Call her"
                      : "Look around"
                    : "Continue"}
              <ChevronRight />
            </Button>
          )}

          <p className="h-4 font-mono text-[11px] text-muted-foreground/70">
            {step === "hello" ? (
              helloIn && (
                // it comes up after the button, as the first screen's last line
                <span className="block animate-in delay-500 duration-700 fill-mode-backwards fade-in">
                  two minutes · every step can wait
                </span>
              )
            ) : step === "key" && !keyed ? (
              "no key is fine — it can go in from the call screen"
            ) : step === "mic" && mic.asking ? (
              "your browser is asking — allow it at the top of the window"
            ) : step === "mic" && !mic.on ? (
              <button
                type="button"
                onClick={() => setStep(STEPS[at + 1])}
                className="rounded-md outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                not now — allow it when the first call asks
              </button>
            ) : last && keyed ? (
              "or tap her"
            ) : (
              ""
            )}
          </p>
        </div>
      </div>

      {step === "hello" ? (
        helloIn && <DemoCorners stage={demo.stage} icons={icons} />
      ) : (
        // Three columns, so the dots stand still whatever the words either side of them say;
        // a short window brings the row down rather than letting the column reach it
        <div className="absolute inset-x-0 bottom-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4.5 font-mono text-[11px] text-muted-foreground/70 [@media(max-height:720px)]:bottom-3">
          <button
            type="button"
            onClick={() => setStep(at > 0 ? STEPS[at - 1] : "hello")}
            className="flex items-center gap-1 justify-self-end rounded-md outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-3" />
            Back
          </button>
          <span className="flex items-center gap-4.5">
            <span className="flex items-center gap-1.75">
              {STEPS.map((name, index) => (
                <span
                  key={name}
                  className={cn(
                    "h-1.75 rounded-full transition-all duration-300",
                    index === at ? "w-5.5 bg-foreground" : "w-1.75",
                    index < at && "bg-foreground/40",
                    index > at && "bg-border",
                  )}
                />
              ))}
            </span>
            <span>
              {at + 1} of {STEPS.length}
            </span>
          </span>
          {/* The way out without a call. On the last step nothing is left to skip, and with
              no key the main button already says it */}
          {last && !keyed ? (
            <span />
          ) : (
            <button
              type="button"
              onClick={() => leave(false)}
              className={cn(
                "justify-self-start rounded-md outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                last && "text-muted-foreground",
              )}
            >
              {last ? "Look around first" : "Skip all"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Her lines so far on the way through the steps, so the earlier ones recede as captions do. */
function herTurns(
  step: Step,
  keyed: boolean,
  heard: boolean,
  /** A model bots can run on is set (api/llm-model/automatic): only then does "everything else" work. */
  thinks: boolean,
): Turn[] {
  // Each id is also the clip she says it with, so a line with no recording does not compile
  const line = (id: IntroLine, text: string): Turn => ({
    id,
    role: "assistant",
    text,
  });
  const lines: Turn[] = [];
  if (step === "hello") return lines;
  lines.push(line("key", SAYS.key));
  if (keyed) lines.push(line("awake", SAYS.awake));
  if (step === "key") return lines;
  lines.push(line("mic", SAYS.mic));
  if (heard) lines.push(line("heard", SAYS.heard));
  if (step === "mic") return lines;
  lines.push(line("bots", SAYS.bots));
  if (step === "bots") return lines;
  lines.push(line("models", SAYS.models));
  if (step === "models") return lines;
  lines.push(line("style", SAYS.style));
  if (step === "style") return lines;
  lines.push(
    keyed
      ? line("call", SAYS.call)
      : thinks
        ? line("asleep", SAYS.asleep)
        : line("asleepBare", SAYS.asleepBare),
  );
  return lines;
}

/** The caller's line at the head of their turn, as their words are drawn on a call. */
function Mine({ children }: { children: string }) {
  return (
    <p className="text-[17px] leading-[1.675] tracking-[0.3px]">
      <span className="mr-4 inline-block size-2.5 rounded-full bg-foreground align-middle opacity-55" />
      {children}
    </p>
  );
}

const Fine = ({ children }: { children: React.ReactNode }) => (
  <p className="font-mono text-[11px] leading-relaxed text-pretty text-muted-foreground/70">
    {children}
  </p>
);

function Done({ children, tail }: { children: string; tail?: string }) {
  return (
    <p className="flex items-center gap-2.5 text-sm">
      <span className="grid size-5 shrink-0 animate-in place-items-center rounded-full bg-primary text-primary-foreground duration-300 zoom-in-50">
        <Check className="size-3" />
      </span>
      <span className="animate-in delay-150 duration-300 fill-mode-backwards fade-in slide-in-from-left-1">
        {children}
      </span>
      {tail && (
        <span className="truncate font-mono text-[11px] text-muted-foreground/70">
          {tail}
        </span>
      )}
    </p>
  );
}

function KeyTurn({ keyed, onSaved }: { keyed: boolean; onSaved: () => void }) {
  if (keyed)
    return (
      <>
        <Done>OpenAI key saved</Done>
        <Fine>Change it any time in Settings › API keys.</Fine>
      </>
    );
  return (
    <>
      <Mine>Paste your OpenAI API key</Mine>
      <VoiceKeys dense plain autoFocus onSaved={onSaved} />
      <GetKeyLink />
      <ol className="flex flex-col gap-1.75 text-[13px] text-muted-foreground">
        {[
          "Sign in, or make an account",
          "Create new secret key, and copy it",
          "Paste it here",
        ].map((text, index) => (
          <li key={text} className="flex items-center gap-2.5">
            <span className="grid size-4.5 shrink-0 place-items-center  rounded font-mono text-[10px] text-foreground bg-secondary">
              {index + 1}
            </span>
            {text}
          </li>
        ))}
      </ol>
      <Fine>
        OpenAI bills it by the minute of call, separately from ChatGPT.
      </Fine>
    </>
  );
}

type MicState = ReturnType<typeof useMic>;

/** Why the microphone did not open: what happened, then what to do about it. */
type MicFailure = { what: string; next: string };

/**
 * Read off the name `getUserMedia` rejects with; a failure it does not name keeps the
 * browser's own words, since a guess at its cause would send them to the wrong setting.
 */
function micFailure(error: unknown): MicFailure {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError")
    return {
      what: "This page is not allowed the microphone yet.",
      next: "The icon at the left of the address bar opens the site's settings: set Microphone to Allow and come back. Or just go on.",
    };
  if (name === "NotFoundError")
    return {
      what: "No microphone was found.",
      next: "Plug one in or switch it on, then turn it on here again. Or just go on.",
    };
  if (name === "NotReadableError")
    return {
      what: "The microphone would not start.",
      next: "Another app may be using it: close that app and turn it on here again. Or just go on.",
    };
  const said =
    (error instanceof Error && error.message) || name || String(error);
  return {
    what: "The microphone did not open.",
    next: `The browser said "${said}". Or just go on.`,
  };
}

/**
 * The microphone on the intro: opened by the step's main button and nothing else, heard
 * through the call's own tap so her face moves as it does on a call, and released as the
 * step is left. `asking` while the browser's own question is up: it opens by the address
 * bar, and a page that said nothing meanwhile read as a button that did not press.
 */
function useMic(active: boolean) {
  const [state, setState] = useState<"off" | "asking" | "on" | MicFailure>(
    "off",
  );
  /** It opened once: the browser will not ask again, whatever the step. */
  const [allowed, setAllowed] = useState(false);
  const [label, setLabel] = useState("");
  const tap = useRef<AudioTap | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const live = useRef(active);
  live.current = active;

  const release = useCallback(() => {
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
  }, []);
  useEffect(() => {
    if (active) return;
    release();
    setState((was) => (was === "on" || was === "asking" ? "off" : was));
  }, [active, release]);
  useEffect(() => release, [release]);

  const turnOn = useCallback(async () => {
    setState("asking");
    try {
      const heard = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Answered after the step was left: allowed, but not opened here
      if (!live.current) {
        for (const track of heard.getTracks()) track.stop();
        setAllowed(true);
        return;
      }
      stream.current = heard;
      tap.current ??= createAudioTap();
      tap.current.open();
      tap.current.hear?.(heard);
      setLabel(heard.getAudioTracks()[0]?.label ?? "");
      setState("on");
      setAllowed(true);
    } catch (error) {
      setState(micFailure(error));
    }
  }, []);

  const spectrum = useCallback(() => tap.current?.readMic() ?? [], []);
  return {
    on: state === "on",
    asking: state === "asking",
    failed: typeof state === "object" ? state : null,
    allowed,
    label,
    turnOn,
    spectrum,
  };
}

function MicTurn({ mic }: { mic: MicState }) {
  const wake = useThursdayStore((state) => state.wake);
  const patch = useThursdayStore((state) => state.patch);
  const [heard, setHeard] = useState(false);
  const [unheard, setUnheard] = useState<string | null>(null);
  // Tried out right here: the call screen's own listener is held off while the intro is up
  useWakeWord({
    enabled: mic.on && wake.enabled && !unheard,
    phrases: [wake.phrase],
    onWake: () => setHeard(true),
    onError: setUnheard,
  });

  // The step's main button turns it on (Intro), so its turn here only says what it is for
  if (!mic.on)
    return (
      <>
        <Mine>Turn on the microphone</Mine>
        {mic.failed ? (
          <>
            <p className={cn("text-[13px] leading-normal", WAITING_INK)}>
              {mic.failed.what}
            </p>
            <Fine>{mic.failed.next}</Fine>
          </>
        ) : (
          <Fine>
            Used on a call, and nowhere else unless you switch on waking her by
            voice.
          </Fine>
        )}
      </>
    );
  return (
    <>
      <Done>Microphone is on</Done>
      <label className="mt-1.5 flex cursor-pointer items-start gap-3">
        <span className="flex flex-1 flex-col gap-0.75">
          <span className="text-sm">Wake her by voice</span>
          <Fine>
            Say <span className="text-foreground">"{wake.phrase}"</span> and she
            picks up. The microphone stays open for as long as this tab is, and
            the browser does the listening: Chrome sends what it hears to
            Google.
          </Fine>
          {/* The one thing this step asks them to try, so it is the one thing that moves */}
          {wake.enabled &&
            !unheard &&
            (heard ? (
              <span className="mt-1.5 flex items-center gap-2 text-[13px]">
                <span className="grid size-5 shrink-0 animate-in place-items-center rounded-full bg-foreground text-background duration-300 zoom-in-50">
                  <Check className="size-3" />
                </span>
                Heard you. That is how you call her.
              </span>
            ) : (
              <span className="mt-1.5 flex items-center gap-2 text-[13px]">
                <Mic className="size-4 shrink-0" />
                <ShinyText
                  text={`Try it now: say "${wake.phrase}"`}
                  speed={2.2}
                />
              </span>
            ))}
          {unheard && <Fine>{unheard}</Fine>}
        </span>
        <Switch
          checked={wake.enabled}
          onCheckedChange={(enabled) => patch({ wake: { ...wake, enabled } })}
        />
      </label>
    </>
  );
}

function BotsTurn({
  picked,
  face,
  onToggle,
}: {
  picked: Record<string, boolean>;
  face: (seed: BotSeed) => BotIcon | undefined;
  onToggle: (name: string) => void;
}) {
  return (
    <>
      <Mine>Pick who comes along</Mine>
      <div className="flex flex-col">
        {BOT_SEEDS.map((seed) => {
          const on = Boolean(picked[seed.name]);
          return (
            <label
              key={seed.name}
              className="flex h-9.5 cursor-pointer items-center gap-2.75"
            >
              <BotMark
                size={24}
                seed={seed.name}
                {...face(seed)}
                notify={false}
                className={cn(
                  "shrink-0 transition-opacity",
                  !on && "opacity-40",
                )}
              />
              <span
                className={cn(
                  "w-17.5 shrink-0 text-[13.5px] font-medium",
                  !on && "text-muted-foreground",
                )}
              >
                {seed.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {seed.hint}
              </span>
              <Switch
                checked={on}
                onCheckedChange={() => onToggle(seed.name)}
              />
            </label>
          );
        })}
      </div>
      <Fine>
        Every one comes along. Switch off any you will not use: Settings › Bots
        has them all, and you can make your own.
      </Fine>
    </>
  );
}

/**
 * Picking her character on the first run: one at a time, because a first run has the whole
 * screen and choosing who she is is the point of it. Settings holds the same four in a
 * popover, for changing it later (thursday-setting StylePicker).
 */
function StyleTurn() {
  // Hers, so she is the same one on a phone and on the next computer (use-live-settings)
  const { settings, patch } = useLiveSettings();
  const at = Math.max(
    0,
    PERSONAS.findIndex((one) => one.id === settings?.persona),
  );
  const one = PERSONAS[at];
  const step = (by: number) =>
    patch({
      persona: PERSONAS[(at + by + PERSONAS.length) % PERSONAS.length].id,
    });

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="space-y-1">
        <div className="text-2xl font-semibold">{one.label}</div>
        <p className="text-sm text-muted-foreground">{one.about}</p>
      </div>
      <p className="min-h-20 text-left text-sm leading-relaxed text-foreground/80">
        {one.lines}
      </p>
      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={() => step(-1)}>
          Someone else
        </Button>
        <Button variant="outline" size="sm" onClick={() => step(1)}>
          Next
        </Button>
      </div>
      {/* Which one is showing is which one is set: there is nothing to confirm */}
      <div className="flex justify-center gap-1.5">
        {PERSONAS.map((each, index) => (
          <span
            key={each.id}
            className={cn(
              "h-0.5 w-5 rounded-full",
              index === at ? "bg-foreground" : "bg-border",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The app's default model — the one Settings › Models keeps, which every bot runs on until
 * its own page picks one — set as it is picked, so leaving the intro any way keeps it.
 */
function ModelsTurn() {
  const { data } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const stored = parseTextModel(
    data?.find((status) => status.key === DEFAULT_MODEL_KEY)?.value,
  );
  const effort = data?.find(
    (status) => status.key === DEFAULT_EFFORT_KEY,
  )?.value;
  // A provider looked at without a model yet is not stored, but must still render
  const [half, setHalf] = useState<TextModelProviderId | null>(null);
  const [save] = useServerAction(setConfigAction, {
    onOk: () => revalidate(queryKey.config),
  });
  const [clear] = useServerAction(removeConfigAction, {
    onOk: () => revalidate(queryKey.config),
  });
  return (
    <>
      <Mine>Pick what they think with</Mine>
      <AccountsSetup withoutVoice />
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 text-[13px] text-muted-foreground">
          Bots think with
        </span>
        <div className="min-w-0 flex-1">
          <ModelPicker
            provider={half ?? stored?.provider ?? null}
            model={half ? "" : (stored?.model ?? "")}
            unset="Automatic"
            onChange={(next) => {
              if (!next.model.trim()) return setHalf(next.provider);
              setHalf(null);
              void save(
                DEFAULT_MODEL_KEY,
                `${next.provider}/${next.model.trim()}`,
              );
            }}
            onUnset={() => {
              setHalf(null);
              if (!stored) return;
              void clear(DEFAULT_MODEL_KEY);
              // As in Settings › Models: a step is read off the model's own ladder, so with
              // the model back to automatic the step goes with it
              if (effort) void clear(DEFAULT_EFFORT_KEY);
            }}
          />
        </div>
      </div>
    </>
  );
}

/** What is set, said once before the first call. */
function Ready({ mic, bots }: { mic: boolean; bots: number }) {
  const items = [
    "voice",
    mic ? "microphone" : null,
    bots > 0 ? `${bots} ${bots === 1 ? "bot" : "bots"}` : null,
  ].filter((item): item is string => item !== null);
  return (
    <span className="flex items-center gap-2 text-xs">
      {items.map((item, index) => (
        // One after another, as a list being checked off rather than a line of text
        <span
          key={item}
          style={{ animationDelay: `${300 + index * 260}ms` }}
          className="flex animate-in items-center gap-2 duration-300 fill-mode-backwards fade-in slide-in-from-bottom-1"
        >
          {index > 0 && <span className="text-muted-foreground/40">·</span>}
          <span className="flex items-center gap-1.5">
            <Check className="size-3.25" />
            {item}
          </span>
        </span>
      ))}
    </span>
  );
}

/* ── the opening: the app's one loop, played silently where it really happens ── */

const DEMO_MS = 16_000;
/**
 * Read by a stranger anywhere as their first sight of the app, so it names no place they
 * leave from and no currency.
 */
const DEMO = {
  ask: "Find me flights to Osaka in October.",
  onIt: `On it. ${ERRANDS_BOT} is looking. Keep talking, I will say when it is back.`,
  back: `${ERRANDS_BOT} is back. The Tuesday morning flight is the pick. The page is on your screen.`,
} as const;

/** What lands in the corner at the end of the loop: words alone, so nothing is read off disk. */
const DEMO_LANDED: Finished = {
  threadId: "demo",
  label: "Osaka flights, October",
  bot: ERRANDS_BOT,
  words:
    "Three fares compared. The Tuesday morning one is the pick: direct, and the cheapest by a little.",
  paths: [],
};

type DemoStage = "rest" | "asked" | "working" | "landed";

/** Where the loop stands: the words so far, what her face does, what the corners show. */
function useDemo(playing: boolean) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const from = performance.now();
    const tick = setInterval(
      () => setMs((performance.now() - from) % DEMO_MS),
      120,
    );
    return () => clearInterval(tick);
  }, [playing]);

  const said = (id: string, role: Turn["role"], text: string): Turn => ({
    id,
    role,
    text,
  });
  const turns: Turn[] = [];
  if (ms > 900) turns.push(said("ask", "user", DEMO.ask));
  if (ms > 4700) turns.push(said("onIt", "assistant", DEMO.onIt));
  if (ms > 11_500) turns.push(said("back", "assistant", DEMO.back));
  const speaking = (ms > 4700 && ms < 8300) || (ms > 11_500 && ms < 14_500);
  const status: CallStatus = speaking
    ? "speaking"
    : ms > 900 && ms < 4700
      ? "listening"
      : "idle";
  const stage: DemoStage =
    ms > 9600 ? "landed" : ms > 5400 ? "working" : ms > 900 ? "asked" : "rest";

  // No sound plays here: her rim moves to a voice nobody hears
  return { turns, status, stage, saying: speaking, voice: silentVoice };
}

/** The pill and the corner where finished work lands, as they stand during the loop. */
function DemoCorners({ stage, icons }: { stage: DemoStage; icons: BotIcon[] }) {
  return (
    <>
      {/* The card finished work really lands as, drawn here with nothing behind it */}
      {stage === "landed" && (
        <div className="pointer-events-none absolute bottom-5 left-5 w-90 text-left">
          <FinishedCard
            row={DEMO_LANDED}
            bot={{
              icon: icons[
                BOT_SEEDS.findIndex((seed) => seed.name === DEMO_LANDED.bot)
              ],
            }}
            onOpen={() => {}}
            onClose={() => {}}
          />
        </div>
      )}
      <div className="absolute right-5 bottom-5 flex h-10 items-center gap-2.5 rounded-full bg-background pr-3.5 pl-2.5 ring-1 ring-border">
        <span className="flex">
          {BOT_SEEDS.map((seed, index) => (
            <BotMark
              key={seed.name}
              size={22}
              seed={seed.name}
              {...icons[index]}
              state={
                stage === "working" && seed.name === ERRANDS_BOT
                  ? "thinking"
                  : "idle"
              }
              notify={false}
              className={cn("shrink-0", index > 0 && "-ml-1.5")}
            />
          ))}
        </span>
        <span className="w-40 truncate text-left text-[13px] text-muted-foreground">
          {stage === "working"
            ? `${ERRANDS_BOT} · reading fares`
            : stage === "landed"
              ? `${ERRANDS_BOT} finished`
              : "Need a hand?"}
        </span>
      </div>
    </>
  );
}
