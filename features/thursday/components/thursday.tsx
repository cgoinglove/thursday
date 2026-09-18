"use client";

import {
  ChevronDown,
  ChevronUp,
  Flag,
  type LucideIcon,
  Mic,
  MicOff,
  Phone,
  PhoneMissed,
  Settings2,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { ShinyText } from "@/components/ui/shiny-text";
import { SourceChips } from "@/components/ui/source-chips";
import TextType from "@/components/ui/text-type";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CALL_IDLE, CALL_LINE } from "@/config";
import { LIVE_PROVIDER } from "@/features/ai/live.schema";
import { type Bot, DEFAULT_BOT } from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { BotRoom } from "@/features/bot/components/bot-room";
import { toolIcon } from "@/features/bot/components/bot-tool";
import { installSeedBots } from "@/features/bot/seed-bots";
import { VoiceKeys } from "@/features/config/components/voice-key";
import { type ConfigStatus, isConfigSet } from "@/features/config/config.const";
import { SECTIONS, Settings } from "@/features/settings/components/settings";
import {
  type SectionAlert,
  useSectionAlerts,
  worstAlert,
} from "@/features/settings/settings.alert";
import { openSettings } from "@/features/settings/settings.store";
import { useThursdayFace } from "@/features/thursday/face.store";
import {
  type CallMessage,
  type CallStatus,
  type CaptionView,
  FACE_DEFAULT,
  type FaceWord,
  type ThursdayFace,
} from "@/features/thursday/thursday.schema";
import { useThursdayStore } from "@/features/thursday/thursday.store";
import {
  type ActivityLine,
  type CallEnd,
  type Ringing,
  useThursday,
} from "@/features/thursday/use-thursday";
import { ArtifactView } from "@/features/workspace/components/artifact-view";
import { useHotkeyLabel } from "@/hooks/use-hotkey";
import { RING_CYCLE_MS } from "@/lib/live/ring";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, plainText, WAITING_INK } from "@/lib/utils";
import { Face } from "./face";
import { SideCaptions, turnsOf, useTurnFocus } from "./side-captions";
import { TabState } from "./tab-state";

/**
 * The call screen. The face is the only control; text stays beside it and is
 * never a list. CallScreen is headless so a scripted call can drive the same
 * markup.
 */

export type { CaptionView };

type CallScreenProps = {
  status: CallStatus;
  /** A call just failed to open or dropped; the face says so for a few seconds. */
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
  /** The idle mic tap is open (wake word on): the orb reacts to it at rest too. */
  micLive?: boolean;
  captionView?: CaptionView;
  /** Chosen in Settings > Thursday, kept in the browser. */
  face?: ThursdayFace;
  /** A speech key exists. Without one the screen stays but sleeps. */
  callable?: boolean;
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
  micLive = false,
  captionView = "sides",
  face = FACE_DEFAULT,
  callable = true,
}: CallScreenProps) {
  // without a key the face opens the key prompt instead of a call
  const [asking, setAsking] = useState(false);
  const asleep = !callable && status === "idle";
  const busy = status === "connecting" || status === "ending";
  const live = status !== "idle" && !busy;
  // The caption box holds her words and nothing else, so the line she just
  // said stays put while she listens or works.
  const hers =
    messages.findLast((turn) => turn.role === "assistant")?.text ?? "";
  const sided = captionView === "sides" && status !== "idle";
  const talk = useMemo(() => turnsOf(messages), [messages]);
  const turns = useTurnFocus(talk, sided);
  const lastRole = talk.at(-1)?.role;
  // the last turn is still being said: her voice is on, or yours came after hers and she has not answered
  const saying =
    (lastRole === "assistant" && status === "speaking") ||
    (lastRole === "user" && status === "listening");
  const calling = ringing !== null && !ringing.missed;
  const ringWord = useRingWord(calling && face?.kind === "ascii");
  return (
    <div className="relative flex h-full flex-col">
      <div className="absolute top-5 right-5 z-10">
        <SettingsCorner />
      </div>

      {/* Top padding in vh, like the face itself, so the face+text column sits below center */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 pt-[7vh]">
        {/* The face is the control. It reacts to the agent's own voice. */}
        <div className="relative w-[min(28rem,72vw,52vh)]">
          <button
            type="button"
            disabled={busy}
            onClick={asleep ? () => setAsking(true) : onTap}
            aria-label={
              asleep
                ? "Add a speech key"
                : live
                  ? "End the call"
                  : ringing && !ringing.missed
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
            {/* Ringing: the drawn mark swells twice and rests, like a phone's ring; the
                orb says it in its own letters instead (useRingWord) */}
            <span
              className={cn(
                "block",
                calling &&
                  face?.kind !== "ascii" &&
                  "motion-safe:animate-ringing",
              )}
            >
              <Face
                look={face}
                status={status}
                failed={failed}
                word={ringWord ?? faceWord}
                getSpectrum={getSpectrum}
                getMicSpectrum={getMicSpectrum}
                micLive={micLive}
                className="w-full"
              />
            </span>
          </button>

          {sided && (
            <SideCaptions
              turns={talk}
              pinned={turns.pinned}
              live={saying}
              onPick={turns.pick}
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
              tool={tool}
              thinkingSince={thinkingSince}
              thinkingTitle={thinkingTitle}
              listening={status === "listening" && thinkingSince === null}
              speaking={status === "speaking"}
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

      {/* Documents a finished thread produced; opens itself on the artifact event */}
      <ArtifactView />

      <BotRoom />
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
        alert === "red" ? "bg-destructive" : "bg-amber-600 dark:bg-amber-400",
      )}
    />
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
    <TooltipProvider delay={400}>
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
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Everything else"
                  onClick={() => openSettings()}
                />
              }
            >
              <Settings2 className="text-muted-foreground" />
              <CornerDot alert={behindGear} />
            </TooltipTrigger>
            <TooltipContent side="bottom">Everything else</TooltipContent>
          </Tooltip>
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
  /** Each new character fades in as it arrives; what is already drawn stays put. */
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
      className="break-keep transition-transform duration-200"
    >
      {fadeIn
        ? // char + index: a character already drawn keeps its key and never fades twice
          Array.from(text).map((char, index) => (
            <span
              key={`${char}${index}`}
              className="animate-in fade-in duration-300 motion-reduce:animate-none"
            >
              {char}
            </span>
          ))
        : text}
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
function Ear({
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
        <ShinyText text={text} motion="pulse" className={look} />
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

function ActivityRow({
  tool: reported,
  thinkingSince,
  thinkingTitle,
  listening,
  speaking,
  getMicSpectrum,
}: {
  tool: ActivityLine | null;
  thinkingSince: number | null;
  thinkingTitle: string | null;
  listening: boolean;
  speaking: boolean;
  getMicSpectrum?: () => ArrayLike<number>;
}) {
  const tool = useDwell(reported, speaking);
  // held past the tool so the pill has something to fade out with
  const [shown, setShown] = useState(tool);
  useEffect(() => {
    if (tool) setShown(tool);
  }, [tool]);
  // and past the thinking, for the same reason
  const [since, setSince] = useState(thinkingSince);
  const [title, setTitle] = useState(thinkingTitle);
  useEffect(() => {
    if (thinkingSince === null) return;
    setSince(thinkingSince);
    setTitle(thinkingTitle);
  }, [thinkingSince, thinkingTitle]);

  const hearing = listening && !tool;
  return (
    <div className="grid h-7 max-w-full items-center justify-items-center">
      {shown && (
        <Fade at="col-start-1 row-start-1 max-w-full" shown={tool !== null}>
          <Activity tool={shown} />
        </Fade>
      )}
      {since !== null && (
        <Fade
          at="col-start-1 row-start-1"
          shown={thinkingSince !== null && !tool}
        >
          <Thinking
            since={since}
            title={title}
            running={thinkingSince !== null && !tool}
          />
        </Fade>
      )}
      <Fade at="col-start-1 row-start-1" shown={hearing}>
        <Ear live={hearing} getMicSpectrum={getMicSpectrum} />
      </Fade>
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

/**
 * A call she places, under her face where her words would be: whose work it is about
 * and what it says, then the two ways to take it. Declining wears the key that does
 * it. Rung out, it stays in the same place as a missed call until it is answered or
 * dismissed; the room's pill leaves that thread's row to it (ringingThreads).
 */
function Incoming({
  ringing,
  onAnswer,
  onDecline,
}: {
  ringing: Ringing;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  const bots = useServerRoute<Bot[]>(queryKey.bot).data;
  const bot = bots?.find((one) => one.name === ringing.bot);
  return (
    // Pulled up into the empty ring of the face's box: at rest her body fills only its
    // middle, and words a hand's width below it read as belonging to something else
    <div className="absolute inset-x-0 -top-20 z-10 flex animate-in flex-col items-center gap-2.5 px-6 fade-in duration-300">
      <span className="flex max-w-full items-center gap-2 text-sm">
        {/* Rung out: the same line says so, in the colour of what waits on them */}
        {ringing.missed && (
          <>
            <span className={cn("flex items-center gap-1.5", WAITING_INK)}>
              <PhoneMissed className="size-3.5" />
              Missed call
            </span>
            <span className="text-muted-foreground/40">·</span>
          </>
        )}
        <BotMark
          size={18}
          seed={ringing.bot}
          color={bot?.icon?.color}
          shape={bot?.icon?.shape}
          outline={bot?.icon?.outline}
          paint={bot?.icon?.paint}
          notify={false}
        />
        <span>{ringing.bot}</span>
        <span className="text-muted-foreground/40">·</span>
        <span className="truncate text-muted-foreground">
          {ringing.label}
          {ringing.more > 0 && ` · +${ringing.more}`}
        </span>
      </span>
      <p className="line-clamp-2 max-w-160 text-base text-pretty break-keep">
        {plainText(ringing.text)}
      </p>
      <div className="mt-4 flex gap-14">
        <RoundAct label="Not now" onClick={onDecline}>
          <span className="font-mono text-xs font-medium">Esc</span>
        </RoundAct>
        <RoundAct
          solid
          label={ringing.missed ? "Call back" : "Answer"}
          onClick={onAnswer}
        >
          <Phone className="size-5.5 fill-current" />
        </RoundAct>
      </div>
    </div>
  );
}

/** A round button with its name under it, as a phone draws answering and declining. */
function RoundAct({
  label,
  solid = false,
  onClick,
  children,
}: {
  label: string;
  solid?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <span className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "grid size-14 place-items-center rounded-full outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
          solid
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "bg-muted text-foreground hover:bg-accent",
        )}
      >
        {children}
      </button>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

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
        motion="pulse"
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
            <kbd className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground/80 shadow-[0_1px_0_var(--border)]">
              ↓
            </kbd>
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
        <span>Tap Thursday, or say</span>
        <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-foreground/80">
          <Mic className="size-3" />
          {wakePhrase}
        </span>
      </>
    );
  } else if (hotkeyLabel) {
    key = `key:${hotkeyLabel}`;
    body = (
      <>
        <span>Tap Thursday, or press</span>
        <kbd className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground/80 shadow-[0_1px_0_var(--border)]">
          {hotkeyLabel}
        </kbd>
      </>
    );
  } else {
    key = "tap";
    // the only sentence on an idle screen; typed out to match the ascii face
    body = (
      <TextType
        as="span"
        text="Tap Thursday to talk"
        loop={false}
        typingSpeed={95}
        initialDelay={400}
        cursorCharacter="▌"
        cursorClassName="ml-0.5 text-muted-foreground/50"
        className="tracking-normal"
      />
    );
  }

  return (
    <span
      key={key}
      className="flex h-6 animate-in items-center gap-1.5 font-mono text-[11px] text-muted-foreground/70 fade-in duration-700"
    >
      {body}
    </span>
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
      <div className="w-[min(26rem,84vw)] animate-in rounded-2xl bg-background/80 p-3 ring-1 ring-border/60 backdrop-blur-md fade-in duration-300">
        {/* same form as the intro; the first key also installs the seed bots */}
        <VoiceKeys
          dense
          autoFocus
          onCancel={onClose}
          onSaved={() => installSeedBots()}
        />
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
      <Button size="sm" onClick={onOpen} className="h-7 rounded-full px-3.5">
        Add key
      </Button>
    </span>
  );
}

/**
 * The backend has the turn: the activity line says so and counts, so the
 * seconds before a tool and before her voice never read as a call that has
 * stopped. Once a reasoning summary names what the work is, the line says that
 * instead. It shines where the rest of this screen pulses (the user's pick). The
 * seconds arrive after the first one, which is most answers.
 */
function Thinking({
  since,
  title,
  running,
}: {
  since: number;
  title: string | null;
  running: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  // Stays mounted to fade out; the count stops with it rather than ticking unseen
  useEffect(() => {
    if (!running) return;
    // back from a tool, the first reading is now rather than where it paused
    const first = setTimeout(() => setNow(Date.now()), 0);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
    };
  }, [running]);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const words = title ? `Thinking about ${midSentence(title)}` : "Thinking…";
  return (
    <span className="flex max-w-full items-center gap-1.5 text-[13px] leading-5">
      {/* keyed so a new title fades in rather than replacing the words mid-sweep */}
      <ShinyText
        key={words}
        text={words}
        className="min-w-0 animate-in truncate fade-in duration-300"
      />
      {seconds >= 1 && (
        <>
          <span className="shrink-0 text-muted-foreground/40">·</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {seconds}s
          </span>
        </>
      )}
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

export function Thursday() {
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
    micLive,
    wakePhrase,
    hotkey,
  } = useThursday();
  // one entry point per line: the wake phrase if any, else the hotkey
  const hotkeyLabel = useHotkeyLabel(hotkey);
  // a preference, not a fact about the model (thursday.store)
  const face = useThursdayFace();
  const captionView = useThursdayStore((state) => state.captionView);

  /**
   * Same question as the server's `isCallable`, asked here because the answer
   * can change during a call (NeedsKey). Unknown counts as not callable.
   */
  const { data: config } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const callable = isConfigSet(config, LIVE_PROVIDER.apiKeyName);

  return (
    <>
      {/* the tab shows the call and what is owed while the app is off-screen */}
      <TabState live={status !== "idle"} ringing={ringing !== null} />
      <CallScreen
        status={status}
        failed={failed}
        messages={messages}
        tool={tool}
        thinkingSince={thinkingSince}
        thinkingTitle={thinkingTitle}
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
        getSpectrum={getSpectrum}
        getMicSpectrum={getMicSpectrum}
        micLive={micLive}
        face={face}
        captionView={captionView}
        callable={callable}
      />
    </>
  );
}
