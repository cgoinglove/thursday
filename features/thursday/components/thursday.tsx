"use client";

import { formatDistanceStrict } from "date-fns";
import {
  ChevronDown,
  ChevronUp,
  Flag,
  type LucideIcon,
  Mic,
  MicOff,
  PhoneMissed,
  Settings2,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Letters } from "@/components/ui/letters";
import { ShinyText } from "@/components/ui/shiny-text";
import { SourceChips } from "@/components/ui/source-chips";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CALL_IDLE, CALL_LINE } from "@/config";
import { LIVE_DEFAULTS, LIVE_PROVIDER } from "@/features/ai/live.schema";
import { TEXT_MODEL_PROVIDERS } from "@/features/ai/model.schema";
import { type Bot, DEFAULT_BOT } from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { BotRoom } from "@/features/bot/components/bot-room";
import { toolIcon } from "@/features/bot/components/bot-tool";
import { installSeedBots } from "@/features/bot/seed-bots";
import { GetKeyLink, VoiceKeys } from "@/features/config/components/voice-key";
import { type ConfigStatus, isConfigSet } from "@/features/config/config.const";
import { InstallNudge } from "@/features/settings/components/install-app";
import { SECTIONS, Settings } from "@/features/settings/components/settings";
import {
  type SectionAlert,
  useSectionAlerts,
  worstAlert,
} from "@/features/settings/settings.alert";
import { openSettings } from "@/features/settings/settings.store";
import { useThursdayFace } from "@/features/thursday/face.store";
import { silentVoice } from "@/features/thursday/silent-voice";
import {
  type CallMessage,
  type CallStatus,
  type CaptionView,
  FACE_DEFAULT,
  type FaceWord,
  type ThursdayFace,
  textCallRunsOn,
} from "@/features/thursday/thursday.schema";
import { useThursdayStore } from "@/features/thursday/thursday.store";
import type { Ringing, Rung } from "@/features/thursday/use-call-ring";
import { useLiveSettings } from "@/features/thursday/use-live-settings";
import { useTextCall } from "@/features/thursday/use-text-call";
import {
  type ActivityLine,
  type CallEnd,
  useThursday,
} from "@/features/thursday/use-thursday";
import { WorkChip } from "@/features/thursday/work-chip";
import { ArtifactView } from "@/features/workspace/components/artifact-view";
import { useHotkeyLabel } from "@/hooks/use-hotkey";
import { RING_CYCLE_MS } from "@/lib/live/ring";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, plainText } from "@/lib/utils";
import { CaptionWords } from "./caption-words";
import { ConnectWave } from "./connect-wave";
import { Face } from "./face";
import {
  SideCaptions,
  type Turn,
  turnsOf,
  useTurnFocus,
} from "./side-captions";
import { TabState } from "./tab-state";
import { WriteLine, type WrittenCall } from "./write-line";

/**
 * The call screen. The face is the only control; text stays beside it and is
 * never a list. CallScreen is headless so a scripted call can drive the same
 * markup.
 */

type CallScreenProps = {
  status: CallStatus;
  /** A call just failed to open or dropped, and the face says so for a few seconds; or a turn of a call in writing broke, and it says so while the line does. */
  failed?: boolean;
  /** Oldest first; the last one is the turn being spoken. */
  messages: CallMessage[];
  tool: ActivityLine | null;
  /** When the backend picked the turn up (ms); null when it is not working. */
  thinkingSince?: number | null;
  /** What the backend's latest reasoning summary says it is doing. */
  thinkingTitle?: string | null;
  /** Why the last call ended, when the user did not end it. */
  ended?: CallEnd | null;
  /** The word `emote` last put on the face. */
  faceWord?: FaceWord | null;
  onTap: () => void;
  /** A call-back ringing; the tap answers it. */
  ringing?: Ringing | null;
  /** Stops the ringing without answering. */
  onDecline?: () => void;
  /** Wake phrase; null when the tap is the only entry point. */
  wakePhrase?: string | null;
  /** Hotkey in readable form (use-hotkey); null if none. */
  hotkeyLabel?: string | null;
  /** Seconds until idle hang-up; set only in the final warning window. */
  idleLeft?: number | null;
  /** When the line opened (ms). */
  since?: number | null;
  getSpectrum?: () => ArrayLike<number>;
  /** The user's own mic bands, for the listening meter. */
  getMicSpectrum?: () => ArrayLike<number>;
  captionView?: CaptionView;
  /** Chosen in Settings > Thursday, kept in the browser. */
  face?: ThursdayFace;
  /** A speech key exists. Without one the screen stays but sleeps. */
  callable?: boolean;
  /**
   * What the write line needs to hold a call in writing; while one is on, the props
   * above are that call's. Null where none can be held.
   */
  written?: WrittenCall | null;
};

function CallScreen({
  status,
  failed = false,
  messages,
  tool,
  thinkingSince = null,
  thinkingTitle = null,
  ended = null,
  faceWord = null,
  onTap,
  ringing = null,
  onDecline,
  wakePhrase = null,
  hotkeyLabel = null,
  idleLeft = null,
  since = null,
  getSpectrum,
  getMicSpectrum,
  captionView = "sides",
  face = FACE_DEFAULT,
  callable = true,
  written = null,
}: CallScreenProps) {
  // without a key the face opens the key prompt instead of a call
  const [asking, setAsking] = useState(false);
  const asleep = !callable && status === "idle";
  const busy = status === "connecting" || status === "ending";
  // A call in writing holds no line: her face still places a spoken one
  const writing = Boolean(written?.on);
  const live = status !== "idle" && !busy && !writing;
  // The caption box holds her words and nothing else, so the line she just
  // said stays put while she listens or works.
  const hers =
    messages.findLast((turn) => turn.role === "assistant")?.text ?? "";
  // An open thread lies over the right of the call and moves none of it: her face and the
  // captions are where they were when it closes. A window too narrow for three columns
  // draws her last line instead, whatever the setting.
  const wide = useWide(SIDES_MIN_WIDTH);
  const sided = captionView === "sides" && status !== "idle" && wide;
  const talk = useMemo(() => turnsOf(messages), [messages]);
  const turns = useTurnFocus(talk, sided);
  const lastRole = talk.at(-1)?.role;
  // One line at a time under her face; beside it, the same lines stand on her side
  const drawn = useDwell(tool, status === "speaking");
  const work = useWork(drawn, thinkingSince !== null);
  // Work that follows their words with none of hers yet is her turn in the making, and
  // stays that until she speaks: her earlier words do not come back down in between
  const [making, setMaking] = useState(false);
  useEffect(() => {
    if (lastRole !== "user") setMaking(false);
    else if (work.on) setMaking(true);
  }, [lastRole, work.on]);
  // The work behind each of her turns stays with it for the call, under her words and again
  // when she is gone back to; work she has said nothing after yet is her turn in the making
  const kept = useKeptWork(talk, work.lines, work.on);
  // the last turn is still being said: her voice is on, or yours came after hers and she has
  // not answered — never yours in writing, which was sent whole
  const saying =
    (lastRole === "assistant" && status === "speaking") ||
    (lastRole === "user" && status === "listening" && !writing);
  const calling = ringing !== null && ringing.missedAt === null;
  const ringWord = useRingWord(calling);
  return (
    <div className="relative flex h-full flex-col">
      <div className="absolute top-5 right-5 z-10 flex flex-col items-end gap-3">
        <SettingsCorner />
        <InstallNudge
          hidden={status !== "idle" || ringing !== null || writing}
        />
      </div>

      {/* Top padding in vh, like the face itself, so the face+text column sits below center */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 pt-[7vh]">
        {/* The face is the control. It reacts to the agent's own voice. */}
        {/* The layout box is the part of her face she fills while talking; the canvas draws
            `--face-bleed` past it on every side for the room her words, the tail she works
            with and the gathering need, so what sits under her is not pushed away by empty
            field. What stands beside her stands past the canvas (SideCaptions). */}
        <div className="relative w-[min(20rem,52vw,37.5vh)] [--face-bleed:19.5%]">
          <button
            type="button"
            disabled={busy}
            // a call in writing may run with no speech key: then her face places nothing
            onClick={
              asleep
                ? () => setAsking(true)
                : writing && !callable
                  ? undefined
                  : onTap
            }
            aria-label={
              asleep
                ? "Add a speech key"
                : live
                  ? "End the call"
                  : calling
                    ? "Answer Thursday"
                    : "Call Thursday"
            }
            // the face never moves under the cursor; only press gives a little
            className={cn(
              "block w-full rounded-full outline-none transition-all duration-700 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 enabled:active:scale-[0.99] disabled:opacity-70",
              // asleep, not broken: the same face, dimmed
              asleep && "opacity-35",
            )}
          >
            {/* Ringing: she says it in her own letters (useRingWord) */}
            <span className="block">
              <Face
                look={face}
                status={status}
                failed={failed}
                word={ringWord ?? faceWord}
                getSpectrum={getSpectrum}
                className="-m-(--face-bleed) w-[calc(100%+2*var(--face-bleed))] max-w-none"
              />
            </span>
          </button>
          <ConnectWave status={status} charset={face.charset} />

          {sided && (
            <SideCaptions
              turns={talk}
              pinned={turns.pinned}
              live={saying}
              onPick={turns.pick}
              under={
                work.held && kept.pending.length > 0 ? (
                  <WorkStack lines={kept.pending} shown={work.on} />
                ) : null
              }
              // with the work gone and her answer not yet begun, her last words come back level;
              // thinking alone takes nothing from them, since it stands under her face
              ahead={making && work.held && kept.pending.length > 0}
              typed={writing}
              workOf={(turn) => {
                // with her words last, work she has said nothing after stands under them
                const lines = [
                  ...(kept.turns[turn] ?? []),
                  ...(turn === kept.latest && lastRole === "assistant"
                    ? kept.pending
                    : []),
                ];
                return lines.length ? <WorkStack lines={lines} shown /> : null;
              }}
            />
          )}
        </div>

        {/* The column is wider than the text (40rem); the side margins hold the caption chevrons (Flow) */}
        <div className="relative flex w-full max-w-3xl flex-col items-center gap-2 px-6 text-center">
          {/* A call she places is the screen's, not a corner's: who, what about, and
              the two ways to take it, where her words would be. The slots below keep
              their room (invisible), so the face does not move when it rings. */}
          {ringing && (
            <Incoming
              ringing={ringing}
              wakePhrase={wakePhrase}
              onAnswer={onTap}
              onDecline={() => onDecline?.()}
            />
          )}
          <div className={cn("contents", ringing && "*:invisible")}>
            {/* Heights below are fixed, not fitted, so the face never moves as
              lines come and go. */}
            {/* Activity line: what the line is doing, in human phrasing
              (tool-line). The fast channel; the face does not follow it
              (use-thursday). */}
            <ActivityRow
              // beside her face the lines are on her side (WorkStack); what she is thinking
              // about and the meter stay here in either view
              tool={sided ? null : drawn}
              toolUp={drawn !== null}
              thinkingSince={thinkingSince}
              thinkingTitle={thinkingTitle}
              // nobody is listened to on a call in writing: there is no microphone
              listening={
                status === "listening" && thinkingSince === null && !writing
              }
              getMicSpectrum={getMicSpectrum}
            />

            {/* Reserved even outside a call so the face does not shift. No
              `text-balance`: rebalancing changes the line count under the pager. */}
            <Flow
              text={sided || status === "idle" ? "" : hers}
              fadeIn
              className="w-full max-w-160 text-center text-base"
            />

            {/* The only instruction on screen. One way in is named while idle,
              and the wake phrase wins over the hotkey. Keyed on the words so a
              change fades; the phrase arrives only after hydration.
              Outside a call this row moves above the two empty slots (order)
              so the gap under the face does not open up. */}
            <div
              className={cn(
                "flex flex-col items-center",
                status === "idle" && "order-first",
              )}
            >
              {asleep ? (
                <NeedsKey
                  open={asking}
                  onOpen={() => setAsking(true)}
                  onClose={() => setAsking(false)}
                />
              ) : writing ? (
                // The write line is this call's one instruction, and it says it itself
                <span className="h-6" />
              ) : (
                <Hint
                  status={status}
                  idleLeft={idleLeft}
                  since={since}
                  ended={ended}
                  behind={sided && turns.back}
                  wakePhrase={wakePhrase}
                  hotkeyLabel={hotkeyLabel}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <CallFoot>
        {/* Documents a finished thread produced; opens itself on the artifact event */}
        <ArtifactView />
        {/* Whatever is typed or handed over instead of said */}
        <WriteLine written={written} onCall={live} />
        <BotRoom />
      </CallFoot>
    </div>
  );
}

/**
 * The foot of the call screen: two rows, and nothing in either moves for the other.
 *
 * The bottom row is the rail of fixtures — the finished cards at its left end, the pill
 * at its right. The pill takes the whole rail rather than a column of it, so no column
 * can ever cap it: it is as wide as what it is saying, with the line up or down.
 *
 * The row above is for what opens rather than sits there: a thread in the room, or the
 * write line. The columns are only theirs, and the two ends take equal tracks, so the
 * middle is the window's middle and the line stands under her face whatever is on the
 * rail below it. A window too narrow for the line and the cards takes the width off
 * both ends, never off the line's place. Her face and the captions above are untouched
 * by all of it.
 */
function CallFoot({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] items-end gap-x-4 gap-y-2 p-5">
      {children}
    </div>
  );
}

/**
 * The corner is one group: three rooms as single buttons, everything else
 * behind the gear. Threads is left out because the other corner is that room.
 */
const CORNER = ["thursday", "memory", "bot"] as const;

/**
 * A section's report, drawn on a 32px button: a 6px dot with a ring in the page
 * ground, inset so the ring stops at the button's own edge and never crosses a
 * seam into the neighbour that paints over it. No counts here — the nav is
 * where you go to find out how many.
 */
function CornerDot({ alert }: { alert: SectionAlert }) {
  if (!alert) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-0.5 right-0.5 size-1.5 rounded-full ring-2 ring-background",
        alert === "red" ? "bg-destructive" : "bg-waiting",
      )}
    />
  );
}

/**
 * Below this window width the captions down the sides would be narrower than about 15rem
 * (24vw) and her lines a few words each, so the call draws her last line under her face.
 */
const SIDES_MIN_WIDTH = 1000;

/** Whether the window is at least `px` wide, kept current; a server render counts as wide. */
function useWide(px: number) {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(`(min-width: ${px}px)`);
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia(`(min-width: ${px}px)`).matches,
    () => true,
  );
}

function SettingsCorner() {
  const alerts = useSectionAlerts();
  // The gear opens everything the three buttons do not, so it carries their reports
  const behindGear = worstAlert(
    SECTIONS.filter(
      (section) => !CORNER.includes(section.id as (typeof CORNER)[number]),
    ).map((section) => alerts[section.id] ?? null),
  );

  return (
    // no labels, so names appear on hover; the delay is shared across the group
    <TooltipProvider>
      <ButtonGroup className="bg-background/75 backdrop-blur-md">
        <ButtonGroup>
          {CORNER.map((id) => {
            const section = SECTIONS.find((entry) => entry.id === id);
            if (!section) return null;
            return (
              <Tooltip key={id}>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label={section.label}
                      onClick={() => openSettings(id)}
                    />
                  }
                >
                  {/* the Thursday section icon is the mark itself */}
                  <section.icon className="text-muted-foreground" />
                  <CornerDot alert={alerts[id] ?? null} />
                </TooltipTrigger>
                <TooltipContent side="bottom">{section.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </ButtonGroup>
        <ButtonGroup>
          {/* The door wears its name: four grey glyphs in a row do not say which one is settings */}
          <Button
            variant="outline"
            onClick={() => openSettings()}
            className="gap-1.5 px-2.5 text-[12.5px] font-normal"
          >
            <Settings2 className="text-muted-foreground" />
            Settings
            <CornerDot alert={behindGear} />
          </Button>
        </ButtonGroup>
      </ButtonGroup>
      {/* the dialog reads its open state from the store; four buttons open it */}
      <Settings />
    </TooltipProvider>
  );
}

/** Lines the caption box holds. */
const CAPTION_LINES = 3;

/**
 * Line height as a number, not a class: box height and page offset divide by
 * it, and a class could be overridden by a later `text-*` utility.
 */
const CAPTION_LEADING = 1.625;

/**
 * A fixed number of lines. Overflow pages by whole lines instead of scrolling.
 * Pages count from the tail: 0 is the last lines, and new text resets to the tail.
 */
function Flow({
  text,
  lines = CAPTION_LINES,
  fadeIn = false,
  className,
}: {
  text: string;
  lines?: number;
  /** Each new letter arrives out of a blur; what is already drawn stays put. */
  fadeIn?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLParagraphElement>(null);
  /** Measured line count of the rendered text. */
  const [rows, setRows] = useState(lines);
  /** Pages back from the tail; 0 is the last page. */
  const [back, setBack] = useState(0);

  // new text always starts at the tail, also while it grows
  useEffect(() => setBack(0), [text]);

  // re-measure on width change and on every text change (streaming moves the last line)
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => {
      const line = Number.parseFloat(getComputedStyle(node).lineHeight);
      if (!line) return;
      setRows(Math.max(1, Math.round(node.scrollHeight / line)));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return () => watch.disconnect();
  }, [text]);

  const steps = Math.ceil(Math.max(0, rows - lines) / lines);
  const at = Math.max(0, rows - lines - Math.min(back, steps) * lines);
  const height = `calc(${lines} * ${CAPTION_LEADING}em)`;

  const body = (
    <p
      ref={box}
      style={{
        lineHeight: CAPTION_LEADING,
        transform: `translateY(-${at * CAPTION_LEADING}em)`,
      }}
      className="break-keep whitespace-pre-line transition-transform duration-200"
    >
      <CaptionWords text={text} animate={fadeIn} />
    </p>
  );

  return (
    <div className="relative flex w-full justify-center">
      <div
        style={{ height }}
        // the box itself pages too; wraps back to the tail at the end
        onClick={
          steps > 0
            ? () => setBack((was) => (was >= steps ? 0 : was + 1))
            : undefined
        }
        className={cn(
          "overflow-hidden",
          steps > 0 && "cursor-pointer",
          className,
        )}
      >
        {body}
      </div>

      {/* In the margin, taking no vertical space. Both slots stay reserved; only the exhausted one hides */}
      {steps > 0 && (
        <div className="absolute top-1/2 right-0 flex -translate-y-1/2 flex-col items-center gap-0.5">
          <Step
            look={ChevronUp}
            label="Earlier lines"
            shown={back < steps}
            onPick={() => setBack((was) => Math.min(steps, was + 1))}
          />
          <Step
            look={ChevronDown}
            label="Later lines"
            shown={back > 0}
            onPick={() => setBack((was) => Math.max(0, was - 1))}
          />
        </div>
      )}
    </div>
  );
}

/**
 * One caption pager chevron. Hidden with `invisible` at the end so the other
 * one does not jump to the center.
 */
function Step({
  look: Look,
  label,
  shown,
  onPick,
}: {
  look: typeof ChevronUp;
  label: string;
  shown: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-hidden={!shown}
      tabIndex={shown ? undefined : -1}
      onClick={(event) => {
        // the box pages on click too; do not count this press twice
        event.stopPropagation();
        onPick();
      }}
      className={cn(
        "grid size-7 place-items-center rounded-full text-muted-foreground/60 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        !shown && "invisible",
      )}
    >
      <Look className="size-3.5" />
    </button>
  );
}

/**
 * Bars the mic meter draws: each over its own slice of the bands, with a gain
 * that answers what a voice does to them. Speech stacks its energy in the
 * fundamental and thins out with every band above it, so one gain for all five
 * draws a tall bar on the left and four stubs — the gain rises to meet the
 * drop, and the whole row moves instead of its first quarter.
 */
const MIC_BARS = [
  { id: "a", from: 0, to: 1, gain: 0.8 },
  { id: "b", from: 1, to: 3, gain: 1 },
  { id: "c", from: 3, to: 5, gain: 1.15 },
  { id: "d", from: 5, to: 6, gain: 1.35 },
  { id: "e", from: 6, to: 8, gain: 1.55 },
];

/** Bar height in px, silent and at full. */
const MIC_BAR = { rest: 2, full: 14 };

/**
 * The user's own level, read once per animation frame like the face reads
 * hers. Flat bars are the point: a closed mic and a silent room look the same
 * here, and both are worth seeing.
 */
function MicMeter({
  live,
  getMicSpectrum,
}: {
  /** Off while the row shows something else; there is nothing to draw. */
  live: boolean;
  getMicSpectrum?: () => ArrayLike<number>;
}) {
  const bars = useRef<Record<string, HTMLSpanElement | null>>({});
  // Height per bar, kept between frames so a bar can fall slower than it rises.
  const held = useRef(MIC_BARS.map(() => 0));

  useEffect(() => {
    if (!live || !getMicSpectrum) return;
    let frame = requestAnimationFrame(function draw() {
      const bands = getMicSpectrum();
      MIC_BARS.forEach((bar, at) => {
        let peak = 0;
        for (let k = bar.from; k < bar.to; k++) {
          peak = Math.max(peak, bands[k] ?? 0);
        }
        // The curve is the loudness the ear hears, not the energy the mic reads:
        // without it everything under half volume draws as the same short bar.
        const want = Math.min(1, (peak * bar.gain) ** 0.8);
        const was = held.current[at];
        // Up in a frame or two to catch a syllable, down slowly enough to see.
        const now = was + (want - was) * (want > was ? 0.6 : 0.16);
        held.current[at] = now;
        const node = bars.current[bar.id];
        if (node) {
          node.style.height = `${MIC_BAR.rest + now * (MIC_BAR.full - MIC_BAR.rest)}px`;
        }
      });
      frame = requestAnimationFrame(draw);
    });
    return () => cancelAnimationFrame(frame);
  }, [live, getMicSpectrum]);

  return (
    <span
      aria-hidden
      className="flex h-3.5 w-[18px] shrink-0 items-center gap-0.5"
    >
      {MIC_BARS.map((bar) => (
        <span
          key={bar.id}
          ref={(node) => {
            bars.current[bar.id] = node;
          }}
          style={{ height: MIC_BAR.rest }}
          className="w-0.5 rounded-full bg-muted-foreground/70"
        />
      ))}
    </span>
  );
}

/**
 * That she is hearing you, while nothing else is happening. It lives in the
 * activity slot rather than the caption: the caption holds her words, and taking
 * it over meant the line vanished the moment she had said anything. The meter
 * carries the motion, so the word itself stays still — a shine here would mean
 * the same thing it means on a running tool one state later.
 */
export function Ear({
  live,
  getMicSpectrum,
}: {
  live: boolean;
  getMicSpectrum?: () => ArrayLike<number>;
}) {
  return (
    <span className="flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
      <MicMeter live={live} getMicSpectrum={getMicSpectrum} />
      Listening
    </span>
  );
}

/**
 * Activity line: tool icon and human phrasing (tool-line). Running is shown by
 * motion (loader in the icon slot, shine on the text), not color; the loader
 * resolving into the tool's own glyph is what "finished" looks like.
 *
 * The line itself wears no pill. This slot cross-fades with the listening chip,
 * which has no container either, so an outline under one of the two read as the
 * line changing shape rather than changing state.
 */
function Activity({ tool }: { tool: ActivityLine }) {
  // a relay from a bot is a flag, like the answer tool — unless it names the bot
  const relay = tool.kind === "relay";
  const Icon = relay ? Flag : toolIcon(tool.name);
  // The sentence when there is one; otherwise the tool's own name is the line,
  // rather than a tag repeating one.
  const text = tool.line ?? tool.name;
  const look = tool.line
    ? "min-w-0 truncate text-[13px] leading-5 break-keep"
    : "min-w-0 truncate font-mono text-xs leading-5";
  // Only for the colour and silhouette the user picked; the name alone already
  // draws a face, so a roster that has not arrived yet costs nothing.
  const bots = useServerRoute<Bot[]>(queryKey.bot).data;
  const bot = tool.bot
    ? (bots?.find((one) => one.name === tool.bot) ?? null)
    : null;
  return (
    <span className="flex max-w-full items-center gap-1.5">
      {/* 18px slot, the width the listening meter beside it has, so the two
          faces of this slot start on the same edge */}
      <span className="relative grid size-[18px] shrink-0 place-items-center">
        <Mark tool={tool} bot={bot} icon={Icon} />
        {/* Running is the glyph being filled in, over its own dimmed self: the
            spinner that used to stand here took the glyph off the screen for as
            long as it ran, which is exactly when it says the most. */}
        {!tool.done && (
          <span className="absolute inset-0 grid animate-ink place-items-center">
            <Mark tool={tool} bot={bot} icon={Icon} running />
          </span>
        )}
      </span>
      {/* The sweep is what says this is still running, so it is on whatever the
          line turns out to be — the sentence, or the bare tool name. */}
      {/* A finished web search draws the pages it read, which stay until the
          user speaks again (useThursday) — they are what she is answering from. */}
      {tool.done && tool.sources?.length ? (
        <SourceChips sources={tool.sources} limit={2} className="flex-nowrap" />
      ) : tool.done ? (
        <span className={cn(look, "text-muted-foreground")}>{text}</span>
      ) : (
        <ShinyText text={text} className={look} />
      )}
    </span>
  );
}

/**
 * What the row draws in its glyph slot: the bot's own face when the line names
 * one, the tool's glyph otherwise. Who work went to, and who brought an answer
 * back, is a face everywhere else in the app — the roster, the pill, the room.
 *
 * `running` is the copy the ink wipes in, so it is the one at full strength.
 */
function Mark({
  tool,
  bot,
  icon: Icon,
  running,
}: {
  tool: ActivityLine;
  /** The row the name resolved to, when the roster has one; its look, not its identity. */
  bot: Bot | null;
  icon: LucideIcon;
  running?: boolean;
}) {
  if (tool.bot) {
    return (
      <span className={cn("flex", !running && !tool.done && "opacity-40")}>
        <BotMark
          size={16}
          seed={tool.bot}
          color={bot?.icon?.color}
          shape={bot?.icon?.shape}
          outline={bot?.icon?.outline}
          paint={bot?.icon?.paint}
          notify={false}
        />
      </span>
    );
  }
  return (
    <Icon
      className={cn(
        "size-3.5",
        running ? "text-foreground" : "text-muted-foreground",
        !running && !tool.done && "opacity-40",
      )}
    />
  );
}

/**
 * The activity slot: 28px, one fact at a time, three faces. All stay mounted and
 * cross-fade, so the line leaves wearing its last words instead of blinking
 * out, and the caption below never moves while they trade places. A tool wins
 * over thinking: it is the same stretch of work, said more exactly.
 */
/**
 * The line to draw, given the line the call reports. Each line is drawn for at least
 * CALL_LINE.dwellMs and the ones that came meanwhile follow in turn, so three tools in a
 * second read as three lines rather than a flicker. Her voice starting jumps to the
 * newest: what still waited led to the answer she is now giving.
 */
function useDwell(
  reported: ActivityLine | null,
  speaking: boolean,
): ActivityLine | null {
  const [drawn, setDrawn] = useState(reported);
  /** Lines in the order they came, the drawn one first. */
  const queue = useRef<ActivityLine[]>(reported ? [reported] : []);
  const since = useRef(Date.now());
  /** The call cleared its line while older ones were still waiting their turn. */
  const cleared = useRef(false);
  const turn = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(() => {
    if (turn.current) clearTimeout(turn.current);
    turn.current = null;
    const waiting = queue.current.length > 1 || cleared.current;
    if (!waiting || !queue.current.length) return;
    const left = Math.max(0, since.current + CALL_LINE.dwellMs - Date.now());
    turn.current = setTimeout(() => {
      queue.current.shift();
      since.current = Date.now();
      setDrawn(queue.current[0] ?? null);
      schedule();
    }, left);
  }, []);

  useEffect(() => {
    if (!reported) {
      cleared.current = true;
      // Nothing behind the drawn line: it goes as the call says, with its own fade
      if (queue.current.length <= 1) {
        queue.current = [];
        setDrawn(null);
      }
      schedule();
      return;
    }
    cleared.current = false;
    const at = queue.current.findIndex((line) => line.id === reported.id);
    if (at >= 0) {
      queue.current[at] = reported;
      if (at === 0) setDrawn(reported);
    } else {
      // A line another took over never hears that its tool ended: it has, by now
      queue.current = [
        ...queue.current.map((line, index) =>
          index === 0 ? line : { ...line, done: true },
        ),
        reported,
      ];
      if (queue.current.length === 1) {
        since.current = Date.now();
        setDrawn(reported);
      }
    }
    schedule();
  }, [reported, schedule]);

  useEffect(() => {
    if (!speaking) return;
    const newest = queue.current.at(-1);
    queue.current = newest && !cleared.current ? [newest] : [];
    since.current = Date.now();
    setDrawn(queue.current[0] ?? null);
    schedule();
  }, [speaking, schedule]);

  useEffect(
    () => () => {
      if (turn.current) clearTimeout(turn.current);
    },
    [],
  );
  return drawn;
}

/** The thinking line held past its end, title and all, so it has something to fade out with. */
function useHeldThought(
  thinkingSince: number | null,
  thinkingTitle: string | null,
) {
  const [thought, setThought] = useState(thinkingSince !== null);
  const [title, setTitle] = useState(thinkingTitle);
  useEffect(() => {
    if (thinkingSince === null) return;
    setThought(true);
    setTitle(thinkingTitle);
  }, [thinkingSince, thinkingTitle]);
  return { thought, title };
}

function ActivityRow({
  tool,
  toolUp,
  thinkingSince,
  thinkingTitle,
  listening,
  getMicSpectrum,
}: {
  /** The line to draw here now (useDwell); none while the lines stand beside her face. */
  tool: ActivityLine | null;
  /** A line is up, here or on her side: it is the same stretch of work, said more exactly. */
  toolUp: boolean;
  thinkingSince: number | null;
  thinkingTitle: string | null;
  listening: boolean;
  getMicSpectrum?: () => ArrayLike<number>;
}) {
  // held past the tool so the pill has something to fade out with
  const [shown, setShown] = useState(tool);
  useEffect(() => {
    if (tool) setShown(tool);
  }, [tool]);
  const { thought, title } = useHeldThought(thinkingSince, thinkingTitle);

  const hearing = listening && !tool;
  return (
    <div className="flex h-7 max-w-full items-center justify-center gap-2">
      <div className="grid min-w-0 items-center justify-items-center">
        {shown && (
          <Fade at="col-start-1 row-start-1 max-w-full" shown={tool !== null}>
            <Activity tool={shown} />
          </Fade>
        )}
        {thought && (
          <Fade
            at="col-start-1 row-start-1"
            shown={thinkingSince !== null && !toolUp}
          >
            <Thinking title={title} />
          </Fade>
        )}
        <Fade at="col-start-1 row-start-1" shown={hearing}>
          <Ear live={hearing} getMicSpectrum={getMicSpectrum} />
        </Fade>
      </div>
      {/* Off by default; the whole feature is features/thursday/work-chip */}
      <WorkChip shown={thinkingSince !== null} />
    </div>
  );
}

/** Her work lines beside her face at once; the one before them is on its way out. */
const WORK_LINES = 3;
/** Must match the `duration-300` the stack fades with. */
const WORK_FADE_MS = 300;
/** One line of the stack, px; ink by age, newest first. */
const WORK_ROW = 26;
const WORK_INK = [1, 0.7, 0.45];

const lineKey = (line: ActivityLine) =>
  line.id ?? `${line.kind ?? "tool"}:${line.name}`;

/**
 * The work behind her words, for the captions beside her face: the lines the slot under
 * her face draws one at a time (useDwell), kept in the order they came. It lasts as long
 * as the stretch of work does — a line drawn, or the backend thinking — and `held` a
 * moment past it, so it leaves fading instead of cut. The next stretch starts empty.
 */
function useWork(drawn: ActivityLine | null, thinking: boolean) {
  const on = drawn !== null || thinking;
  const [lines, setLines] = useState<ActivityLine[]>([]);
  const [held, setHeld] = useState(on);

  useEffect(() => {
    setLines((was) => {
      // A line that left the slot has ended, whether or not its tool said so
      const ended = was.some((line) => !line.done)
        ? was.map((line) => (line.done ? line : { ...line, done: true }))
        : was;
      if (!drawn) return ended;
      const at = was.findIndex((line) => lineKey(line) === lineKey(drawn));
      if (at >= 0) return was.map((line, k) => (k === at ? drawn : line));
      return [...ended, drawn].slice(-(WORK_LINES + 1));
    });
  }, [drawn]);

  useEffect(() => {
    if (on) {
      setHeld(true);
      return;
    }
    const out = setTimeout(() => {
      setHeld(false);
      setLines([]);
    }, WORK_FADE_MS);
    return () => clearTimeout(out);
  }, [on]);

  return { lines, on, held };
}

type Kept = {
  /** Her turns by id, each with the lines behind it in the order they became its. */
  turns: Record<string, ActivityLine[]>;
  /** Whose each line is, once it is anyone's. */
  owner: Record<string, string>;
  /** Her words as they stood when each line was first drawn (`said`). */
  seen: Record<string, string | null>;
};

const KEPT_NONE: Kept = { turns: {}, owner: {}, seen: {} };

/**
 * The lines of work behind each of her turns, by turn. A line is the turn of the first words
 * she says after it is drawn — a turn she starts or one she goes on with — and stays that
 * turn's for the call, however long it lingers: the pages a search left on the line belong
 * to the answer they led to, never to the next one. Work that stops with her words last and
 * nothing said since is her last turn's. Until then a line is `pending`: her turn in the
 * making, or, with her words last, drawn under them. Their words arriving late (a transcript
 * lags the audio) moves nothing, since only hers decide. A new call starts empty.
 */
function useKeptWork(talk: Turn[], lines: ActivityLine[], on: boolean) {
  const [kept, setKept] = useState<Kept>(KEPT_NONE);
  const hers = talk.findLast((turn) => turn.role === "assistant");
  const latest = hers?.id ?? null;
  const said = hers ? `${hers.id}:${hers.text.length}` : null;
  const closing = !on && talk.at(-1)?.role === "assistant";
  useEffect(() => {
    setKept((was) => {
      let next = was;
      for (const line of lines) {
        const key = lineKey(line);
        let turn = next.owner[key];
        if (turn === undefined) {
          const seen = key in next.seen ? next.seen[key] : said;
          if (!(key in next.seen))
            next = { ...next, seen: { ...next.seen, [key]: said } };
          if (!latest || (seen === said && !closing)) continue;
          turn = latest;
          next = { ...next, owner: { ...next.owner, [key]: turn } };
        }
        // the line as it is drawn now: finished, or with the pages its search read
        const list = next.turns[turn] ?? [];
        const at = list.findIndex((one) => lineKey(one) === key);
        if (at >= 0 && list[at] === line) continue;
        next = {
          ...next,
          turns: {
            ...next.turns,
            [turn]:
              at >= 0
                ? list.map((one, k) => (k === at ? line : one))
                : [...list, line],
          },
        };
      }
      return next;
    });
  }, [lines, said, latest, closing]);
  useEffect(() => {
    if (!talk.length) setKept(KEPT_NONE);
  }, [talk.length]);
  const pending = useMemo(
    () => lines.filter((line) => kept.owner[lineKey(line)] === undefined),
    [lines, kept.owner],
  );
  return { turns: kept.turns, pending, latest };
}

/**
 * What she is doing, on her side of the captions and under her words: the last few lines
 * of work, older ones fainter. No rule and no plate — the glyphs at the head of the lines
 * are what set them apart from her words. What she is thinking about stays under her face.
 */
function WorkStack({
  lines,
  shown,
}: {
  lines: ActivityLine[];
  /** The stretch of work is still open; false is the fade on its way out. */
  shown: boolean;
}) {
  const leaving = Math.max(0, lines.length - WORK_LINES);
  const rows = lines.length - leaving;
  return (
    <div
      aria-hidden={!shown}
      className={cn(
        "pointer-events-auto relative w-full transition-opacity duration-300 ease-out",
        !shown && "pointer-events-none opacity-0",
      )}
      style={{ height: rows * WORK_ROW }}
    >
      {lines.map((line, k) => {
        const row = k - leaving;
        return (
          // Placed by transform so a line that came moves the others up rather than jumping them
          <div
            key={lineKey(line)}
            style={{
              transform: `translateY(${row * WORK_ROW}px)`,
              opacity: row < 0 ? 0 : WORK_INK[lines.length - 1 - k],
              height: WORK_ROW,
            }}
            className="absolute inset-x-0 top-0 flex items-center transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none"
          >
            <div className="flex min-w-0 animate-in duration-300 fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
              <Activity tool={line} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The word the orb shows while she rings, once a ring (lib/live/ring): lit, held, out, a breath of her own face. */
const RING_WORD = { text: "CALL", hold: 1.5 };

function useRingWord(on: boolean): FaceWord | null {
  const [word, setWord] = useState<FaceWord | null>(null);
  useEffect(() => {
    if (!on) {
      setWord(null);
      return;
    }
    const show = () => setWord({ ...RING_WORD, at: Date.now() });
    show();
    const again = setInterval(show, RING_CYCLE_MS);
    return () => clearInterval(again);
  }, [on]);
  return word;
}

/** How many waiting threads show by name: under a ringing call, and in the missed list. */
const RING_OTHERS = 2;
const MISSED_ROWS = 3;

const KEY_CAP =
  "rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground/80 shadow-[0_1px_0_var(--border)]";

/**
 * A call she places, under her face where her words would be. One call for everything
 * that waits: the first thread is shown whole — who, what it says, the answers the bot
 * offered — and the rest by name; answering tells them one by one. One round button
 * takes it (her face does too), and declining is the small key under it. Rung out, the
 * same place holds a missed list until it is called back or cleared. No amber: the
 * screen already means it waits on them.
 */
function Incoming({
  ringing,
  wakePhrase,
  onAnswer,
  onDecline,
}: {
  ringing: Ringing;
  /** Saying it answers as the button does (use-thursday `call`); null while it is off. */
  wakePhrase: string | null;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  const bots = useServerRoute<Bot[]>(queryKey.bot).data;
  const mark = (rung: Rung, size: number) => {
    const icon = bots?.find((one) => one.name === rung.bot)?.icon;
    return (
      <BotMark
        size={size}
        seed={rung.bot}
        color={icon?.color}
        shape={icon?.shape}
        outline={icon?.outline}
        paint={icon?.paint}
        notify={false}
        className="shrink-0"
      />
    );
  };
  const { first, others, missedAt } = ringing;

  if (missedAt !== null) {
    const all = [first, ...others];
    return (
      <div className="absolute inset-x-0 -top-20 z-10 flex animate-in flex-col items-center px-6 fade-in duration-300">
        <div className="flex w-full max-w-140 flex-col text-left">
          <p className="mb-1.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <PhoneMissed className="size-3" />
            <span>
              Missed · <MissedWhen at={missedAt} />
            </span>
            <button
              type="button"
              onClick={onDecline}
              className="ml-auto flex items-center gap-1.5 rounded-md outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <kbd className={KEY_CAP}>Esc</kbd>
              clear
            </button>
          </p>
          {all.slice(0, MISSED_ROWS).map((rung) => (
            <div key={rung.id} className="flex h-8.5 items-center gap-2.5">
              {mark(rung, 20)}
              <span className="w-32 shrink-0 truncate text-[13.5px]">
                {rung.label}
              </span>
              <span className="w-14 shrink-0 font-mono text-[10.5px] text-muted-foreground">
                {RUNG_KIND[rung.kind]}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                {plainText(rung.text)}
              </span>
            </div>
          ))}
          {all.length > MISSED_ROWS && (
            <p className="mt-1 font-mono text-[10.5px] text-muted-foreground/70">
              +{all.length - MISSED_ROWS} more in the room
            </p>
          )}
        </div>
        <Button
          variant="brand"
          onClick={onAnswer}
          className="mt-5 h-12 px-8 text-[15px]"
        >
          Call back
        </Button>
        {wakePhrase && (
          <span className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground/70">
            or say <SaidPhrase phrase={wakePhrase} />
          </span>
        )}
      </div>
    );
  }

  return (
    // Pulled up into the empty ring of the face's box: at rest her body fills only its
    // middle, and words a hand's width below it read as belonging to something else
    <div className="absolute inset-x-0 -top-20 z-10 flex animate-in flex-col items-center gap-3 px-6 fade-in duration-300">
      <span className="flex max-w-full items-center gap-2 text-sm">
        {mark(first, 18)}
        <span>{first.bot}</span>
        <span className="text-muted-foreground/40">·</span>
        <span className="truncate text-muted-foreground">{first.label}</span>
      </span>
      {/* five lines of it, where the window is tall enough to keep the button on screen */}
      <p className="line-clamp-3 max-w-150 text-base/relaxed text-pretty break-keep [@media(min-height:860px)]:line-clamp-5">
        {plainText(first.text)}
      </p>
      {first.options.length > 0 && (
        // What they will be asked to choose between, to read before picking up
        <span className="flex max-w-full flex-wrap justify-center gap-1.5">
          {first.options.map((option) => (
            <span
              key={option}
              className="flex h-7 max-w-60 items-center truncate rounded-full px-3 text-[12.5px] text-muted-foreground ring-1 ring-border"
            >
              {option}
            </span>
          ))}
        </span>
      )}
      <Button
        variant="brand"
        onClick={onAnswer}
        className="mt-3 h-12 px-8 text-[15px]"
      >
        Answer
      </Button>
      {others.length > 0 && (
        <span className="flex max-w-full flex-wrap items-center justify-center gap-x-4.5 gap-y-1 text-[13px] text-muted-foreground">
          {others.slice(0, RING_OTHERS).map((rung) => (
            <span key={rung.id} className="flex min-w-0 items-center gap-1.5">
              {mark(rung, 16)}
              <span className="max-w-44 truncate text-foreground">
                {rung.label}
              </span>
              {RUNG_KIND[rung.kind]}
            </span>
          ))}
          {others.length > RING_OTHERS && (
            <span>+{others.length - RING_OTHERS}</span>
          )}
        </span>
      )}
      <span className="mt-1 flex items-center gap-3 font-mono text-[11px] text-muted-foreground/70">
        {wakePhrase && (
          <span className="flex items-center gap-1.5">
            say <SaidPhrase phrase={wakePhrase} /> to answer
          </span>
        )}
        <button
          type="button"
          onClick={onDecline}
          className="flex items-center gap-2 rounded-md outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <kbd className={KEY_CAP}>Esc</kbd>
          not now
        </button>
      </span>
    </div>
  );
}

/** Said again every half minute: a missed call left on the screen is read hours later too. */
const MISSED_TICK_MS = 30_000;

/** How long ago it rang out: "just now" for the first minute, then minutes and hours. */
function MissedWhen({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), MISSED_TICK_MS);
    return () => clearInterval(tick);
  }, []);
  return now - at < 60_000
    ? "just now"
    : formatDistanceStrict(at, now, { addSuffix: true });
}

/** The wake phrase as the screen shows it wherever saying it does something. */
function SaidPhrase({ phrase }: { phrase: string }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-foreground/80">
      <Mic className="size-3" />
      {phrase}
    </span>
  );
}

/** What a waiting thread is doing, in one word. */
const RUNG_KIND: Record<Rung["kind"], string> = {
  question: "asks",
  done: "finished",
  stopped: "stopped",
};

/** One face of a stacked slot. Hidden means invisible, untouchable and unread. */
function Fade({
  at,
  shown,
  children,
}: {
  at: string;
  shown: boolean;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden={!shown}
      className={cn(
        "flex transition-opacity duration-300 ease-out",
        at,
        shown ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {children}
    </span>
  );
}

/** Why a call ended, as the hint says it. */
const ENDED: Record<CallEnd, string> = {
  quiet: `${CALL_IDLE.hangUpMs / 1000}s of quiet`,
  hungUp: "Thursday hung up",
  closed: "Live closed the call",
  dropped: "the connection dropped",
};

/**
 * The only hint line on screen. Says one thing at a time; outside a call it
 * shows why the last one ended when the user did not end it, else one way in
 * (wake phrase or hotkey); inside a call how to end and the elapsed time. Keyed
 * so changes fade.
 */
function Hint({
  status,
  idleLeft,
  since,
  ended,
  behind,
  wakePhrase,
  hotkeyLabel,
}: {
  status: CallStatus;
  idleLeft: number | null;
  since: number | null;
  ended: CallEnd | null;
  /** The side captions are on an earlier turn. */
  behind: boolean;
  wakePhrase: string | null;
  hotkeyLabel: string | null;
}) {
  const busy = status === "connecting" || status === "ending";
  const live = status !== "idle" && !busy;

  let body: React.ReactNode;
  let key: string;
  if (busy) {
    key = status;
    // still moving, so it shines like every other line that is
    body = (
      <ShinyText
        text={status === "connecting" ? "Connecting…" : "Ending…"}
        className="text-muted-foreground/70"
      />
    );
  } else if (live && idleLeft !== null) {
    key = "quiet";
    body = `Quiet — ending in ${idleLeft}s. Say anything to stay.`;
  } else if (live) {
    key = behind ? "behind" : "live";
    body = (
      <>
        <span>Tap Thursday to end</span>
        <span className="text-muted-foreground/40">·</span>
        {behind ? (
          <>
            <kbd className={KEY_CAP}>↓</kbd>
            <span>back to now</span>
          </>
        ) : (
          <Elapsed since={since} />
        )}
      </>
    );
  } else if (ended) {
    key = `ended:${ended}`;
    // Where the quiet warning stood, until the next call
    body = (
      <>
        <span>Ended — {ENDED[ended]}</span>
        <span className="text-muted-foreground/40">·</span>
        <span>Tap to call again</span>
      </>
    );
  } else if (wakePhrase) {
    key = `wake:${wakePhrase}`;
    body = (
      <>
        <Letters text="Tap Thursday, or say" />
        {/* the phrase is what the sentence ends on, so it takes the next letter's turn */}
        <After at={500}>
          <SaidPhrase phrase={wakePhrase} />
        </After>
        <After at={WRITE_AT}>
          <ToWrite />
        </After>
      </>
    );
  } else if (hotkeyLabel) {
    key = `key:${hotkeyLabel}`;
    body = (
      <>
        <Letters text="Tap Thursday, or press" />
        <After at={550}>
          <kbd className={KEY_CAP}>{hotkeyLabel}</kbd>
        </After>
        <After at={WRITE_AT}>
          <ToWrite />
        </After>
      </>
    );
  } else {
    key = "tap";
    body = (
      <>
        <Letters text="Tap Thursday to talk" />
        <After at={WRITE_AT}>
          <ToWrite />
        </After>
      </>
    );
  }

  return (
    <span
      key={key}
      className="flex h-6 animate-in items-center gap-1.5 font-mono text-[11px] text-muted-foreground fade-in duration-700"
    >
      {body}
    </span>
  );
}

/**
 * When the way to write joins the line: once the sentence before it has landed, which
 * is 19 letters at Letters' 25ms plus the 0.4s the last one takes. Every idle line uses
 * the same beat, so the three read as one screen rather than three.
 */
const WRITE_AT = 900;

/**
 * A piece of the idle line that waits its turn. The sentence arrives letter by letter
 * (Letters), so what is not a letter — the wake phrase, the key cap, the way to write —
 * says when it belongs: `at` is the millisecond it starts, counted the same way.
 */
function After({ at, children }: { at: number; children: React.ReactNode }) {
  return (
    <span
      style={{ animationDelay: `${at}ms` }}
      className="flex animate-in items-center gap-1.5 duration-700 fill-mode-backwards fade-in"
    >
      {children}
    </span>
  );
}

/**
 * The other way in, said after the ones to call: `/` opens the write line (write-line).
 * No cap of its own — two keys in caps on one short line read as a keyboard legend
 * rather than a sentence (the user's pick) — so it stands apart by space and ink.
 */
function ToWrite() {
  return (
    <>
      <span className="px-1.5 text-muted-foreground/30">·</span>
      <span className="text-muted-foreground/70">/ to write</span>
    </>
  );
}

/**
 * Stands in for the hint line while no speech key exists. Collapsed it is one
 * line; open it becomes the key form in place.
 */
function NeedsKey({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  if (open) {
    return (
      <div className="w-[min(26rem,84vw)] animate-in space-y-2.5 rounded-2xl bg-background/80 p-3 ring-1 ring-border/60 backdrop-blur-md fade-in duration-300">
        <div className="flex h-6 items-center justify-between gap-2 pl-0.5">
          <span className="text-[13px] font-medium">
            Paste your OpenAI API key
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Not now"
            onClick={onClose}
            className="-my-1 size-6"
          >
            <X className="size-3.5" />
          </Button>
        </div>
        {/* the intro's key step, in place; the first key also installs the seed bots */}
        <VoiceKeys dense plain autoFocus onSaved={() => installSeedBots()} />
        <GetKeyLink />
      </div>
    );
  }

  return (
    <span className="flex animate-in items-center gap-2 rounded-full bg-muted/60 py-1 pr-1 pl-1.5 ring-1 ring-border/60 fade-in duration-500">
      {/* the bot that already works; only calls are blocked */}
      <span className="relative flex size-6 shrink-0 items-center justify-center">
        <BotMark
          size={24}
          seed={DEFAULT_BOT.name}
          color={DEFAULT_BOT.icon?.color}
          shape={DEFAULT_BOT.icon?.shape}
          outline={DEFAULT_BOT.icon?.outline}
          notify={false}
        />
        <MicOff className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-muted text-muted-foreground" />
      </span>
      <span className="text-[13px] text-muted-foreground break-keep">
        Calls need one speech key. Everything else here already works.
      </span>
      {/* the one thing this screen asks for */}
      <Button size="sm" variant="brand" onClick={onOpen} className="h-7 px-3.5">
        Add key
      </Button>
    </span>
  );
}

/**
 * The backend has the turn: the activity line says so, so the seconds before a
 * tool and before her voice never read as a call that has stopped. Once a
 * reasoning summary names what the work is, the line says that instead. It
 * shines where the rest of this screen pulses (the user's pick).
 */
function Thinking({ title }: { title: string | null }) {
  const words = title ? `Thinking about ${midSentence(title)}` : "Thinking…";
  return (
    <span className="flex max-w-full items-center text-[13px] leading-5">
      {/* keyed so a new title fades in rather than replacing the words mid-sweep */}
      <ShinyText
        key={words}
        text={words}
        className="min-w-0 animate-in truncate fade-in duration-300"
      />
    </span>
  );
}

/** A title read mid-sentence: "Checking thread status" becomes "checking thread status"; "API limits" stays. */
function midSentence(title: string) {
  return /^\p{Lu}\p{Lu}/u.test(title)
    ? title
    : title.charAt(0).toLowerCase() + title.slice(1);
}

/** Time since the line opened, mm:ss; only this span re-renders each second. */
function Elapsed({ since }: { since: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [since]);
  if (since === null) return null;
  const total = Math.max(0, Math.floor((now - since) / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return (
    <span className="tabular-nums">
      {mm}:{ss}
    </span>
  );
}

export function Thursday({
  /** A voice key exists, as the server saw it while rendering the page. */
  ready,
}: {
  ready: boolean;
}) {
  // First, because the spoken call has to know one is on: it rings for nothing meanwhile
  const text = useTextCall();
  const {
    status,
    failed,
    messages,
    tool,
    thinkingSince,
    thinkingTitle,
    ended,
    faceWord,
    idleLeft,
    since,
    call,
    ringing,
    decline,
    getSpectrum,
    getMicSpectrum,
    wakePhrase,
    hotkey,
  } = useThursday(text.on);
  // one entry point per line: the wake phrase if any, else the hotkey
  const hotkeyLabel = useHotkeyLabel(hotkey);
  // a preference, not a fact about the model (thursday.store)
  const face = useThursdayFace();
  const captionView = useThursdayStore((state) => state.captionView);

  /**
   * Same question as the server's `isCallable`, asked here because the answer
   * can change during a call (NeedsKey). Until it has been answered here the page's own
   * answer stands: counting unknown as no key drew her asleep for the first moment of
   * every load, then woke her.
   */
  const { data: config } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const callable = config
    ? isConfigSet(config, LIVE_PROVIDER.apiKeyName)
    : ready;

  // A call in writing takes the same screen while no line is open; a spoken call ends it,
  // which is what tapping her face in the middle of one does
  const spoken = status !== "idle";
  const endWritten = text.end;
  useEffect(() => {
    if (spoken && text.on) endWritten();
  }, [spoken, text.on, endWritten]);
  const writing = text.on && !spoken;
  // What a call in writing runs on: the model picked on the line while its key is still
  // set, else the rule (the plan, else the OpenAI key) on the call's backend model
  const textModel = useThursdayStore((state) => state.textModel);
  // Hers, read from the server; until it lands the default is the model almost every
  // install runs on, and the line settles a beat later if this one does not
  const { settings } = useLiveSettings();
  const backendModel = settings?.backendModel ?? LIVE_DEFAULTS.backendModel;
  const written = useMemo((): WrittenCall => {
    const has = (key: string) => isConfigSet(config, key);
    const ruled = textCallRunsOn(has);
    const runsOn =
      textModel && has(TEXT_MODEL_PROVIDERS[textModel.provider].apiKeyName)
        ? textModel
        : ruled
          ? { provider: ruled, model: backendModel }
          : null;
    return {
      on: writing,
      busy: text.busy,
      error: text.error,
      say: text.say,
      again: text.again,
      end: text.end,
      runsOn,
      fallback:
        runsOn?.provider !== "openai" &&
        has(TEXT_MODEL_PROVIDERS.openai.apiKeyName)
          ? { provider: "openai", model: backendModel }
          : null,
    };
  }, [
    writing,
    text.busy,
    text.error,
    text.say,
    text.again,
    text.end,
    config,
    textModel,
    backendModel,
  ]);

  return (
    <>
      {/* the tab shows the call and what is owed while the app is off-screen */}
      <TabState live={status !== "idle"} ringing={ringing !== null} />
      <CallScreen
        status={writing ? text.status : status}
        // a turn in writing that broke is said by her face too, for as long as its line says why
        failed={writing ? text.error !== null : failed}
        messages={writing ? text.messages : messages}
        tool={writing ? text.tool : tool}
        thinkingSince={writing ? text.thinkingSince : thinkingSince}
        thinkingTitle={writing ? text.thinkingTitle : thinkingTitle}
        ended={ended}
        faceWord={faceWord}
        onTap={call}
        // without a key the face asks for one, so nothing can answer
        ringing={callable ? ringing : null}
        onDecline={decline}
        wakePhrase={wakePhrase}
        hotkeyLabel={hotkeyLabel}
        idleLeft={idleLeft}
        since={since}
        // her words arrive without a voice: the face moves to one nobody hears
        getSpectrum={writing ? silentVoice : getSpectrum}
        getMicSpectrum={getMicSpectrum}
        face={face}
        captionView={captionView}
        callable={callable}
        // a spoken call has the line to itself; what is typed then goes to a bot
        written={spoken ? null : written}
      />
    </>
  );
}
