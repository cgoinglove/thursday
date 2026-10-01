"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  Mic,
  Volume2,
  VolumeX,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type AutomaticModel } from "@/features/ai/model.schema";
import { PERSONAS } from "@/features/ai/prompts/persona";
import { BOT_SEEDS, ERRANDS_BOT, findBotSeed } from "@/features/bot/bot.seed";
import { BotMark } from "@/features/bot/components/bot-mark";
import { ROOM_THURSDAY } from "@/features/bot/room.schema";
import { installSeedBots } from "@/features/bot/seed-bots";
import type { Chatter, ThreadView } from "@/features/bot/thread.store";
import {
  CallLines,
  useVoiceLine,
} from "@/features/config/components/voice-key";
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
import { awake } from "@/features/thursday/face-words";
import { micProblem } from "@/features/thursday/mic-problem";
import { silentVoice } from "@/features/thursday/silent-voice";
import type { CallStatus, FaceWord } from "@/features/thursday/thursday.schema";
import { useThursdayStore } from "@/features/thursday/thursday.store";
import { useLiveSettings } from "@/features/thursday/use-live-settings";
import {
  type Finished,
  FinishedCard,
} from "@/features/workspace/components/artifact-view";
import { useAwayAfter } from "@/hooks/use-away-after";
import { toDate } from "@/lib/date-like";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";

/**
 * The first run, laid over the call screen (app/page) and drawn as the call screen:
 * her face in the same place, her words down its left as captions are, and on its
 * right — where the caller's words go — the caller's turn: a key, the microphone, who
 * works for them and how she talks. It opens on her coming down to her own size
 * (echoes.tsx), then on the app's one loop played silently in place, and its last button
 * is the first call. No step holds anyone: every one can be passed at once and done later
 * from the screen it belongs to. It shows until it has been left once (intro.query), or
 * whenever `?intro` asks (app/page `firstRun`).
 */

const STEPS = ["key", "mic", "bots", "style", "call"] as const;
type Step = "hello" | (typeof STEPS)[number];

/** Her words, long enough to sit well beside her face: two or three lines. */
const SAYS = {
  key: "I am Thursday, and the first thing I need is a voice. Sign in with ChatGPT and I talk on your plan, or paste an OpenAI key. Neither yet? Go on without it, and I will ask again when you call.",
  awake:
    "There, I am awake, and that is everything a call needs. From here on it is quick: your microphone, and who works for you.",
  mic: "Now let me hear you. Your browser asks before it opens the microphone: say yes. From then on, saying hey Thursday calls me.",
  bots: "Long work goes to bots, so we can keep talking while they are at it. They work on this computer, with a shell, a browser and your files, and signing in or paying always stays with you.",
  style:
    "One more, and it is the fun one: who I am to you. Four of them, and the only difference is how I talk — pick whoever sounds like someone you would call, and change your mind whenever you like.",
  call: "That is everything I need. Call me, tell me what to call you, and ask for one thing, anything you would ask a person at the next desk. I will show you the rest as we go.",
  asleep:
    "I still have no voice of my own, so there is no call yet, but everything else works. Look around; tap me whenever you sign in or have a key, and I will take it from there.",
  asleepBare:
    "I still have no voice of my own, and my bots have nothing to think with yet, so there is no call and no job for now. Look around; add a key or sign in with ChatGPT whenever you like, and I will take it from there.",
} as const;

/**
 * The office where her face stands, on the bots step alone (the maintainer's pick, 09-29): who
 * works for you, drawn as it will be when they do. Its code loads only then (bot-room loads it so).
 */
const OfficeBackdrop = dynamic(
  () =>
    import("@/features/bot/components/office-view").then(
      (module) => module.OfficeBackdrop,
    ),
  { ssr: false },
);

/** How long the office takes to go (office-view `leaving`, `duration-250`). */
const OFFICE_LEAVE_MS = 250;

/**
 * The bots step's office: a job already under way when the step opens, every bot at its desk
 * on its part and the one who holds it waiting on them, which ends while you look — each hands
 * its part back and the report comes in (the maintainer's pick, 09-29: nothing walks in or
 * vanishes). Only the thread it is handed changes; the office draws it as it draws any job.
 */
/** How far into the job the step opens: the office's clocks read that much already. */
const OFFICE_UNDER_WAY_S = 95;
/** When the job ends, from the step opening. */
const OFFICE_DONE_MS = 5_000;
/** The report the job ends with, as the card it leaves reads it. */
const OFFICE_REPORT = "Everyone did their part. The team is ready for you.";

/**
 * The bots picked, as a thread under way when the step opened: the first holds it and each other
 * one is at its desk on what that bot is for; `done`, each has handed its part back and the
 * first has reported. Words alone, nothing read off the server.
 */
function teamThread(
  names: string[],
  opened: Date,
  done: boolean,
): ThreadView | null {
  const [lead, ...rest] = names;
  if (!lead) return null;
  const ref = (name: string) => ({
    name,
    icon: findBotSeed(name)?.icon ?? null,
  });
  // Handed out one after another near the start, long before the step opened
  const since = new Date(opened.getTime() - OFFICE_UNDER_WAY_S * 1000);
  const at = (seconds: number) => new Date(since.getTime() + seconds * 1000);
  const ended = OFFICE_UNDER_WAY_S + OFFICE_DONE_MS / 1000;
  const lines = rest.flatMap((bot, index): Chatter[] => {
    const hint = findBotSeed(bot)?.hint ?? bot;
    const given = 2 + index * 2.5;
    return [
      {
        id: `intro-ask-${bot}-0`,
        bot: ref(lead),
        to: ref(bot),
        text: hint,
        kind: "ask",
        exchange: `intro-${bot}`,
        parent: "intro-lead",
        at: at(given),
      },
      // Its step once the work is at its desk: the words of a turn that goes on (office.ts steps)
      {
        id: `intro-step-${bot}-0`,
        bot: ref(bot),
        to: null,
        text: hint,
        kind: "say",
        parent: `intro-${bot}`,
        at: at(given + 1.2),
      },
      // Done, its last words under its exchange are its part handed back (office.ts `return`)
      ...(done
        ? [
            {
              id: `intro-back-${bot}-0`,
              bot: ref(bot),
              to: null,
              text: "Done.",
              kind: "say" as const,
              parent: `intro-${bot}`,
              at: at(ended),
            },
          ]
        : []),
    ];
  });
  // and the one who holds it reports (office.ts `report`)
  if (done)
    lines.push({
      id: "intro-report-0",
      bot: ref(lead),
      to: null,
      text: OFFICE_REPORT,
      kind: "result",
      parent: "intro-lead",
      at: at(ended),
    });
  return {
    // Each opening of the step builds its office afresh
    id: `intro-team-${opened.getTime()}`,
    request: "Who works for you",
    label: "Who works for you",
    bot: ref(lead),
    roster: names.map(ref),
    lines: lines.sort(
      (a, b) =>
        toDate(a.at ?? since).getTime() - toDate(b.at ?? since).getTime(),
    ),
    room: {
      participants: names.map((bot) => ({
        bot,
        state: done
          ? ("done" as const)
          : bot === lead
            ? ("waiting" as const)
            : ("running" as const),
      })),
      questions: [],
      deliveries: [],
      relays: [],
      exchanges: [
        // The holder's own seat, as a thread's bot has it (room.schema isCoordinatorSeat): its
        // turn over, waiting on the rest, until they are back and it has reported
        {
          id: "intro-lead",
          bot: lead,
          caller: ROOM_THURSDAY,
          state: done ? ("done" as const) : ("waiting" as const),
          waitsFor: [],
        },
        ...rest.map((bot) => ({
          id: `intro-${bot}`,
          bot,
          caller: lead,
          state: done ? ("done" as const) : ("running" as const),
          waitsFor: [],
        })),
      ],
    },
    status: done ? "done" : "working",
    outcome: done ? OFFICE_REPORT : null,
    ask: null,
    seen: true,
    routineId: null,
    tokens: { input: 0, output: 0 },
    contextTokens: 0,
    contextBudget: 0,
    createdAt: since,
    updatedAt: done ? at(ended) : opened,
  };
}

/** Must match the `duration-700` below. */
const FADE_MS = 700;

/**
 * Where the opening stands: her larger sizes stepping down, her face in its place, the first
 * screen up while the last crumbs go, and over.
 */
type Opening = "echoes" | "her" | "hello" | "over";

export function Intro({
  /** A call can already open: a sign-in or a voice key exists (as the server saw it). */
  ready,
  /** No call has been placed here yet. */
  firstRun,
  /** Opened deliberately via `?intro`. */
  forced,
}: {
  ready: boolean;
  firstRun: boolean;
  forced: boolean;
}) {
  const shown = firstRun || forced;
  const router = useRouter();
  const [step, setStep] = useState<Step>("hello");
  const [gone, setGone] = useState(false);
  /** After the fade; then the element is removed entirely. */
  const [lifted, setLifted] = useState(false);
  const [keyed, setKeyed] = useState(ready);
  // A ChatGPT sign-in opens a call too, on the plan's own voice (live.schema liveLineOf), and
  // lands on the server rather than here: she wakes with it as she does with a key
  // (a Free sign-in has no spoken calls: voice-key useVoiceLine)
  const voiceLine = useVoiceLine();
  const callable = keyed || voiceLine.line !== null;
  const wasCallable = useRef(callable);
  useEffect(() => {
    if (callable && !wasCallable.current) setWord(awake());
    wasCallable.current = callable;
  }, [callable]);
  const [word, setWord] = useState<FaceWord | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>(() =>
    // every bot comes along unless it is switched off here
    Object.fromEntries(BOT_SEEDS.map((seed) => [seed.name, true])),
  );
  const [opening, setOpening] = useState<Opening>("echoes");
  const wake = useThursdayStore((state) => state.wake);
  const patchCall = useThursdayStore((state) => state.patch);
  // The bots step is drawn as their office (teamThread), and it goes as the step does
  const officeUp = step === "bots";
  // Her face is faded out under the office (its button's duration-700), then not drawn at all:
  // drawn under it, it cost as much as everything else on the step
  const faceAway = useAwayAfter(officeUp, 700);
  const [officeDrawn, setOfficeDrawn] = useState(false);
  // Its job is timed from the step opening (teamThread), and ends OFFICE_DONE_MS in
  const [opened, setOpened] = useState<Date | null>(null);
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (officeUp) {
      setOpened(new Date());
      setEnded(false);
      setOfficeDrawn(true);
      const done = setTimeout(() => setEnded(true), OFFICE_DONE_MS);
      return () => clearTimeout(done);
    }
    const end = setTimeout(() => setOfficeDrawn(false), OFFICE_LEAVE_MS);
    return () => clearTimeout(end);
  }, [officeUp]);
  const team = useMemo(
    () =>
      opened &&
      teamThread(
        BOT_SEEDS.filter((seed) => picked[seed.name]).map((seed) => seed.name),
        opened,
        ended,
      ),
    [picked, opened, ended],
  );
  // her face comes in on the opening's last beat, and the first screen after it
  const herIn = opening !== "echoes";
  const helloIn = opening === "hello" || opening === "over";
  /** The box her face stands in, which the opening is laid on. */
  const faceBox = useRef<HTMLDivElement>(null);
  const mic = useMic();
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
    () => herTurns(step, callable, thinks),
    [step, callable, thinks],
  );
  const turns = step === "hello" ? demo.turns : said;
  // Only while it is up: mounted on every page load, its ↓ took the key from every call after
  const focus = useTurnFocus(turns, up);
  // Her latest line is also a clip (intro-voice); every id `herTurns` gives is one
  const voice = useIntroVoice(
    gone ? null : ((said.at(-1)?.id as IntroLine | undefined) ?? null),
  );

  if (lifted || !shown) return null;

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
    step === "hello" ? demo.status : voice.speaking ? "speaking" : "idle";
  const last = step === "call";
  /** A step past the first screen: in a narrow window it stacks (the column below). */
  const stacked = step !== "hello";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Getting started"
      className={cn(
        "fixed inset-0 z-40 bg-background transition-opacity duration-700 [--face-w:min(20rem,52vw,37.5vh)]",
        gone && "pointer-events-none opacity-0",
      )}
    >
      {/* Where her face stands and across to its left, up to where the step's turn begins */}
      {officeDrawn && team && (
        <OfficeBackdrop
          thread={team}
          leaving={!officeUp}
          className="absolute inset-y-0 left-0 right-[calc(50%-var(--face-w)*0.695)] mask-[linear-gradient(to_right,black_80%,transparent)]"
        />
      )}

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

      {/* The call screen's own column, so nothing moves when the intro lifts. In a narrow
          window a step's turn stacks under her instead of beside her, where it ran off the
          edge below about 820px (09-26), and the column scrolls */}
      <div
        className={cn(
          "relative flex h-full flex-col items-center justify-center gap-5 pt-[7vh]",
          // The office under it takes the pointer, save where this column has a part
          officeUp && "pointer-events-none",
          // Stacked, the column scrolls, and a wheel over it is the column's: given to the
          // office under it, steps 3 and 4 at 720x790 left Continue 95 px below the window
          // with no way to scroll to it but Tab
          stacked &&
            "max-[900px]:pointer-events-auto max-[900px]:justify-start max-[900px]:overflow-y-auto max-[900px]:pb-20",
        )}
      >
        {/* The call screen's face box and `--face-bleed`: the canvas draws past the box, and
            what stands beside her stands past the canvas */}
        <div
          ref={faceBox}
          className={cn(
            "relative w-(--face-w) [--face-bleed:19.5%]",
            stacked &&
              "max-[900px]:flex max-[900px]:w-full max-[900px]:flex-col max-[900px]:items-center max-[900px]:gap-7",
          )}
        >
          <button
            type="button"
            disabled={!last || !callable}
            onClick={() => leave(true)}
            aria-label={last && callable ? "Call Thursday" : undefined}
            // asleep, not broken: the same face, dimmed, until she has a voice
            className={cn(
              "block w-full rounded-full outline-none transition-all duration-700 ease-out focus-visible:ring-3 focus-visible:ring-ring/50",
              step !== "hello" && !callable && "opacity-35",
              officeUp && "pointer-events-none opacity-0",
              stacked && "max-[900px]:mt-6 max-[900px]:w-[min(8rem,20vh)]",
            )}
          >
            {herIn ? (
              <Face
                status={status}
                failed={false}
                word={word}
                getSpectrum={step === "hello" ? demo.voice : voice.spectrum}
                waking
                covered={faceAway}
                className="-m-(--face-bleed) w-[calc(100%+2*var(--face-bleed))] max-w-none"
              />
            ) : (
              // her box, kept its size while the opening plays in it
              <div className="aspect-square w-full" />
            )}
          </button>

          {/* Beside her there is no room in a narrow window: there her latest line alone,
              under her */}
          <div
            className={cn(
              stacked && "max-[900px]:hidden",
              // Over the office her words go under it, as in a narrow window
              officeUp && "hidden",
            )}
          >
            <SideCaptions
              turns={turns}
              pinned={focus.pinned}
              live={step === "hello" ? demo.saying : voice.speaking}
              onPick={focus.pick}
            />
          </div>
          {stacked && (
            <p className="hidden w-[min(22rem,calc(100vw-2rem))] text-left text-[15px] leading-[1.6] text-foreground max-[900px]:block">
              {said.at(-1)?.text}
            </p>
          )}

          {step !== "hello" && (
            // Where the caller's words go on a call: the caller's turn
            <div
              key={step}
              className="pointer-events-auto absolute top-1/2 left-full ml-[calc(var(--face-bleed)+0.375rem)] flex w-[min(22rem,26vw)] -translate-y-1/2 animate-in flex-col gap-4 text-left fade-in slide-in-from-bottom-1 duration-300 max-[900px]:static max-[900px]:ml-0 max-[900px]:w-[min(22rem,calc(100vw-2rem))] max-[900px]:translate-y-0"
            >
              {step === "key" && <KeyTurn onSaved={() => setKeyed(true)} />}
              {step === "mic" && <MicTurn mic={mic} />}
              {step === "bots" && (
                // her line, taken off the office; a narrow window has it under her already
                <p className="text-[15px] leading-[1.6] text-foreground max-[900px]:hidden">
                  {said.at(-1)?.text}
                </p>
              )}
              {step === "bots" && (
                <BotsTurn
                  picked={picked}
                  onToggle={(name) =>
                    setPicked((all) => ({ ...all, [name]: !all[name] }))
                  }
                />
              )}
              {step === "style" && <StyleTurn />}
            </div>
          )}
        </div>

        {/* Positioned, as the call screen's column is: her canvas draws `--face-bleed` past her
            box, and the box is positioned, so a column that is not lies under what she draws.
            On the first screen it stands a bleed lower, moving nothing else: listening and
            speaking in the loop she fills her canvas, and it covered the line under her (09-29);
            0.195 is `--face-bleed` read off her box's width */}
        <div
          className={cn(
            "relative flex w-full max-w-3xl flex-col items-center gap-4 px-6 text-center transition-transform duration-700 ease-out",
            step === "hello" && "translate-y-[calc(var(--face-w)*0.195)]",
          )}
        >
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
            ) : // Over the office her line is in the step's column beside it, not in a box here
            officeUp ? null : !callable ? (
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
              // Without a voice the key step asks for one in its rows, and this button only
              // goes on without it: black, so the step's blue is the sign-in (button.tsx brand)
              variant={step === "key" && !callable ? "default" : "brand"}
              // Asked from the button the eye is already on: a second, smaller one beside her
              // was the one that went unpressed (09-26). On once, it goes on as every step does
              loading={step === "mic" && mic.asking}
              onClick={() => {
                if (step === "hello") {
                  // Inside this click, so the browser lets her be heard from here on
                  voice.say("hello", callable ? "awake" : "key");
                  setStep("key");
                } else if (step === "mic" && !mic.allowed)
                  // The microphone turned on here is the wake phrase turned on, and the step
                  // done: one press, not a second to go on (09-29). Refused, it stays, saying
                  // why; Settings › Thursday has the phrase either way
                  void mic.turnOn().then((on) => {
                    if (!on) return;
                    patchCall({ wake: { ...wake, enabled: true } });
                    // Left by Back while the browser asked: it stays where they went
                    setStep((now) => (now === "mic" ? "bots" : now));
                  });
                else if (last) leave(callable);
                else setStep(STEPS[at + 1]);
              }}
              // on the first screen it follows her line up, once
              className={cn(
                "pointer-events-auto h-12 rounded-full px-7 pl-8 text-[15px]",
                step === "mic" && !mic.allowed && "pl-6",
                step === "hello" &&
                  "animate-in delay-300 duration-700 fill-mode-backwards fade-in slide-in-from-bottom-2",
              )}
            >
              {step === "mic" && !mic.allowed && !mic.asking && <Mic />}
              {step === "hello"
                ? "Start"
                : step === "mic" && !mic.allowed
                  ? "Turn on the microphone"
                  : last
                    ? callable
                      ? "Call her"
                      : "Look around"
                    : "Continue"}
              <ChevronRight />
            </Button>
          )}

          <p className="h-4 font-mono text-[11px] text-muted-foreground">
            {step === "hello" ? (
              helloIn && (
                // it comes up after the button, as the first screen's last line
                <span className="block animate-in delay-500 duration-700 fill-mode-backwards fade-in">
                  two minutes · every step can wait
                </span>
              )
            ) : step === "key" && !callable ? (
              "neither is fine — both can wait for the call screen"
            ) : step === "mic" && mic.asking ? (
              "your browser is asking — allow it at the top of the window"
            ) : step === "mic" && !mic.allowed ? (
              <button
                type="button"
                onClick={() => setStep(STEPS[at + 1])}
                className="rounded-md outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                not now — allow it when the first call asks
              </button>
            ) : last && callable ? (
              "or tap her"
            ) : (
              ""
            )}
          </p>
        </div>
      </div>

      {step === "hello" ? (
        helloIn && <DemoCorners stage={demo.stage} />
      ) : (
        // Three columns, so the dots stand still whatever the words either side of them say;
        // a short window brings the row down rather than letting the column reach it
        <div className="absolute inset-x-0 bottom-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4.5 font-mono text-[11px] text-muted-foreground [@media(max-height:720px)]:bottom-3">
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
          {last && !callable ? (
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
  /** A call can open: a ChatGPT sign-in or the key, made here or before. */
  callable: boolean,
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
  if (callable) lines.push(line("awake", SAYS.awake));
  if (step === "key") return lines;
  lines.push(line("mic", SAYS.mic));
  if (step === "mic") return lines;
  lines.push(line("bots", SAYS.bots));
  if (step === "bots") return lines;
  lines.push(line("style", SAYS.style));
  if (step === "style") return lines;
  lines.push(
    callable
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
  <p className="font-mono text-[11px] leading-relaxed text-pretty text-muted-foreground">
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
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {tail}
        </span>
      )}
    </p>
  );
}

/**
 * Her voice: the GPT Subscription or an OpenAI key, the plan first (voice-key CallLines). Both
 * rows stay once either is in, each saying what runs on it: a key given before still leaves the
 * plan to sign in to.
 */
function KeyTurn({ onSaved }: { onSaved: () => void }) {
  return (
    <>
      <Mine>Give her a voice</Mine>
      <CallLines onSaved={onSaved} />
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
  const problem = micProblem(error);
  if (problem === "refused")
    return {
      what: "This page is not allowed the microphone yet.",
      next: "The icon at the left of the address bar opens the site's settings: set Microphone to Allow and come back. Or just go on.",
    };
  if (problem === "missing")
    return {
      what: "No microphone was found.",
      next: "Plug one in or switch it on, then turn it on here again. Or just go on.",
    };
  if (problem === "busy")
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
 * The microphone on the intro: asked for by the step's main button and nothing else, and let go
 * at once. What it gets is the browser's yes, which the wake phrase and the first call open it
 * on. `asking` while the browser's own question is up: it opens by the address bar, and a page
 * that said nothing meanwhile read as a button that did not press.
 */
function useMic() {
  const [state, setState] = useState<"off" | "asking" | MicFailure>("off");
  /** Allowed once: the browser will not ask again, whatever the step. */
  const [allowed, setAllowed] = useState(false);

  /** Whether the browser said yes. */
  const turnOn = useCallback(async (): Promise<boolean> => {
    setState("asking");
    try {
      const heard = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of heard.getTracks()) track.stop();
      setState("off");
      setAllowed(true);
      return true;
    } catch (error) {
      setState(micFailure(error));
      return false;
    }
  }, []);

  return {
    asking: state === "asking",
    failed: typeof state === "object" ? state : null,
    allowed,
    turnOn,
  };
}

function MicTurn({ mic }: { mic: MicState }) {
  const wake = useThursdayStore((state) => state.wake);
  // Back on the step once it is allowed: what it did, and the button goes on
  if (mic.allowed)
    return <Done>{`Microphone on, and "${wake.phrase}" calls her`}</Done>;
  // The step's main button turns it on (Intro), and the wake phrase with it, so what the
  // phrase costs is said before the press
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
          On a call, and to hear "{wake.phrase}" while this tab is open. Chrome
          does that listening and sends what it hears to Google; Settings ›
          Thursday switches it off.
        </Fine>
      )}
    </>
  );
}

function BotsTurn({
  picked,
  onToggle,
}: {
  picked: Record<string, boolean>;
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
              className="flex min-h-9.5 cursor-pointer items-center gap-2.75 py-1"
            >
              <BotMark
                size={24}
                seed={seed.name}
                {...seed.icon}
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
              {/* Wrapped, not cut: a hint is the one thing that tells two bots apart */}
              <span className="min-w-0 flex-1 text-xs leading-snug text-pretty text-muted-foreground">
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

  // `about` alone: `lines` is written to the model about her, in the third person (persona.ts)
  return (
    <>
      <Mine>Pick how she talks</Mine>
      <div className="space-y-1">
        <div className="text-2xl font-semibold">{one.label}</div>
        <p className="min-h-10 text-sm text-muted-foreground">{one.about}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => step(-1)}>
          <ChevronLeft />
          Previous
        </Button>
        <Button variant="outline" size="sm" onClick={() => step(1)}>
          Next
          <ChevronRight />
        </Button>
      </div>
      {/* Which one is showing is which one is set: there is nothing to confirm */}
      <div className="flex gap-1.5">
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
function DemoCorners({ stage }: { stage: DemoStage }) {
  return (
    <>
      {/* The card finished work really lands as, drawn here with nothing behind it */}
      {stage === "landed" && (
        <div className="pointer-events-none absolute bottom-5 left-5 w-90 text-left">
          <FinishedCard
            row={DEMO_LANDED}
            bot={{
              icon: findBotSeed(DEMO_LANDED.bot)?.icon ?? null,
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
              {...seed.icon}
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
