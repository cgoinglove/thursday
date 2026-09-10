"use client";

import {
  ChevronDown,
  ChevronUp,
  Flag,
  type LucideIcon,
  Mic,
  MicOff,
  Settings2,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import ShinyText from "@/components/ui/shiny-text";
import TextType from "@/components/ui/text-type";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SPEACH_MODEL_PROVIDER_LIST } from "@/features/ai/model.schema";
import { type Bot, DEFAULT_BOT } from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { BotRoom } from "@/features/bot/components/bot-room";
import { toolIcon } from "@/features/bot/components/bot-tool";
import { installSeedBots } from "@/features/bot/seed-bots";
import { VoiceKeys } from "@/features/config/components/voice-key";
import { type ConfigStatus, isConfigSet } from "@/features/config/config.const";
import { MemoryView } from "@/features/memory/components/memory-view";
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
  type ThursdayFace,
} from "@/features/thursday/thursday.schema";
import { useThursdayStore } from "@/features/thursday/thursday.store";
import { useCallTitle } from "@/features/thursday/use-call-title";
import { type ToolRun, useThursday } from "@/features/thursday/use-thursday";
import { ArtifactView } from "@/features/workspace/components/artifact-view";
import { useHotkeyLabel } from "@/hooks/use-hotkey";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";
import { Face } from "./face";

/**
 * The call screen. The face is the only control; text stays beside it and is
 * never a list. CallScreen is headless so a scripted call can drive the same
 * markup.
 */

export type { CaptionView };

export type CallScreenProps = {
  status: CallStatus;
  /** Oldest first; the last one is the turn being spoken. */
  messages: CallMessage[];
  tool: ToolRun | null;
  onTap: () => void;
  /** Wake phrase; null when the tap is the only entry point. */
  wakePhrase?: string | null;
  /** Hotkey in readable form (use-hotkey); null if none. */
  hotkeyLabel?: string | null;
  /** Seconds until idle hang-up; set only in the final warning window. */
  idleLeft?: number | null;
  /** When the line opened (ms). */
  since?: number | null;
  /** Mic muted (use-thursday micOff): a tool is running or a relay is being read. */
  micOff?: boolean;
  getSpectrum?: () => ArrayLike<number>;
  /** The user's own mic bands, for the listening meter. */
  getMicSpectrum?: () => ArrayLike<number>;
  captionView?: CaptionView;
  /** Chosen in Settings > Thursday, kept in the browser. */
  face?: ThursdayFace;
  /** A speech key exists. Without one the screen stays but sleeps. */
  callable?: boolean;
};

export function CallScreen({
  status,
  messages,
  tool,
  onTap,
  wakePhrase = null,
  hotkeyLabel = null,
  idleLeft = null,
  since = null,
  micOff = false,
  getSpectrum,
  getMicSpectrum,
  captionView = "center",
  face = FACE_DEFAULT,
  callable = true,
}: CallScreenProps) {
  // without a key the face opens the key prompt instead of a call
  const [asking, setAsking] = useState(false);
  const asleep = !callable && status === "idle";
  const busy = status === "connecting";
  const live = status !== "idle" && status !== "connecting";
  // The caption box holds her words and nothing else, so the line she just
  // said stays put while she listens or works.
  const hers =
    messages.findLast((turn) => turn.role === "assistant")?.text ?? "";
  const sided = captionView === "sides" && status !== "idle";
  const turns = useTurnPager(messages);
  return (
    <div className="relative flex h-full flex-col">
      <div className="absolute top-5 right-5 z-10">
        <SettingsCorner />
      </div>

      {/* Top padding in vh, like the face itself, so the face+text column sits below center */}
      {/* The wheel winds the turns back. It is on this column rather than on the
          screen: the corner holds the settings dialog and the room its own list,
          and a portal's wheel bubbles up the tree it was written in, not the one
          it is drawn in. */}
      <div
        onWheel={sided ? turns.onWheel : undefined}
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 pt-[7vh]"
      >
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
                  : "Call Thursday"
            }
            // the face never moves under the cursor; only press gives a little
            className={cn(
              "block w-full rounded-full outline-none transition-all duration-700 ease-out focus-visible:ring-3 focus-visible:ring-ring/50 enabled:active:scale-[0.99] disabled:opacity-70",
              // asleep, not broken: the same face, dimmed
              asleep && "opacity-35",
            )}
          >
            <Face
              look={face}
              status={status}
              getSpectrum={getSpectrum}
              className="w-full"
            />
          </button>

          {sided && <SideCaptions shown={turns.shown} give={turns.give} />}
        </div>

        {/* The column is wider than the text (40rem); the side margins hold the caption chevrons (Flow) */}
        <div className="flex w-full max-w-3xl flex-col items-center gap-2 px-6 text-center">
          {/* Heights below are fixed, not fitted, so the face never moves as
              lines come and go. */}
          {/* Activity line: what the line is doing, in human phrasing
              (tool-line). The fast channel; the face does not follow it
              (use-thursday). */}
          <ActivityRow
            tool={tool}
            micOff={micOff}
            listening={status === "listening"}
            getMicSpectrum={getMicSpectrum}
          />

          {/* Reserved even outside a call so the face does not shift. No
              `text-balance`: rebalancing changes the line count under the pager. */}
          <Flow
            text={sided || status === "idle" ? "" : hers}
            fixed
            paged
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
                wakePhrase={wakePhrase}
                hotkeyLabel={hotkeyLabel}
              />
            )}
          </div>
        </div>
      </div>

      {/* Memory the model opens for reading (memory_show) */}
      <MemoryView />
      {/* Documents a finished task produced; opens itself on the artifact event */}
      <ArtifactView />

      <BotRoom />
    </div>
  );
}

/**
 * The corner is one group: three rooms as single buttons, everything else
 * behind the gear. Tasks is left out because the other corner is that room.
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
 * Lines a side caption keeps, by age. The newest turn is the one being said, so
 * it gets room for a whole spoken sentence; what came before is context and
 * decays with the type size beside it.
 */
const CAPTION_TURN_LINES = [5, 3, 2];

/**
 * Type size by age. The step is a real one — 18 / 15 / 13 — because it is what
 * tells two turns apart once neither carries an edge.
 */
const CAPTION_SIZES = ["text-lg", "text-[15px]", "text-[13px]"];

/** Inner padding by age: a smaller turn sits on a smaller plate. */
const CAPTION_PADS = ["px-4 py-3", "px-3.5 py-2.5", "px-3 py-2"];

/**
 * The plate a turn sits on: fill, no edge. The call screen's ground is the
 * page's own — the ascii field is boot and intro only — so an outline covers
 * nothing and ends up being the whole design.
 *
 * Yours is the surface `Bubble` already gives your words in the task thread
 * (primary, light ink); hers is the page's grey. Age recedes in the fill, not
 * in the block's opacity, which would take the ink down with it.
 */
const CAPTION_HERS = ["bg-muted", "bg-muted/70", "bg-muted/45"];
const CAPTION_YOURS = ["bg-primary", "bg-primary/75", "bg-primary/60"];

/** A step off a ramp above. The ramps run out at VISIBLE; the last step is the floor. */
function atAge(ramp: readonly string[], age: number) {
  return ramp[age] ?? ramp[ramp.length - 1];
}

/** Ink by age. Hers recedes with her plate; yours stays legible on every step of its own. */
const CAPTION_HERS_INK = [
  "text-foreground",
  "text-muted-foreground",
  "text-muted-foreground/60",
];

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
  lead,
  lines = CAPTION_LINES,
  fixed = false,
  paged = false,
  className,
}: {
  text: string;
  /** Sits inline before the text. */
  lead?: ReactNode;
  lines?: number;
  /** Reserve the full height even with no text. */
  fixed?: boolean;
  /** Page overflow with chevrons; needs side margin. */
  paged?: boolean;
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
    if (!node || !paged) return;
    const measure = () => {
      const line = Number.parseFloat(getComputedStyle(node).lineHeight);
      if (!line) return;
      setRows(Math.max(1, Math.round(node.scrollHeight / line)));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return () => watch.disconnect();
  }, [text, paged]);

  const steps = Math.ceil(Math.max(0, rows - lines) / lines);
  const at = Math.max(0, rows - lines - Math.min(back, steps) * lines);
  const height = `calc(${lines} * ${CAPTION_LEADING}em)`;

  const body = (
    <p
      ref={box}
      style={{
        lineHeight: CAPTION_LEADING,
        ...(paged
          ? { transform: `translateY(-${at * CAPTION_LEADING}em)` }
          : {}),
      }}
      className={cn("break-keep", paged && "transition-transform duration-200")}
    >
      {lead}
      {text}
    </p>
  );

  // No room for chevrons here (side captions): overflow is clipped and the fading last line is the only cue
  if (!paged) {
    return (
      <div
        style={fixed ? { height } : { maxHeight: height }}
        className={cn(
          "overflow-hidden mask-[linear-gradient(to_bottom,black_calc(100%-0.7rem),transparent_100%)]",
          className,
        )}
      >
        {body}
      </div>
    );
  }

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
function Activity({ tool, micOff }: { tool: ToolRun; micOff: boolean }) {
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
      {tool.done ? (
        <span className={cn(look, "text-muted-foreground")}>{text}</span>
      ) : (
        <ShinyText
          text={text}
          speed={2.4}
          color="var(--muted-foreground)"
          shineColor="var(--foreground)"
          className={look}
        />
      )}
      {/* The mic is closed because this is running, so it travels with the line.
          A chip, where the line has none: on the bare page a second glyph beside
          the tool's own shares strokes with it and reads as a smudge, and the
          plate is what says this is a state rather than more of the sentence. */}
      {micOff && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted/60 py-0.5 pr-2 pl-1.5 font-mono text-[11px] leading-4 text-muted-foreground">
          <MicOff className="size-3 shrink-0" />
          mic off
        </span>
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
  tool: ToolRun;
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
          vary={tool.bot}
          color={bot?.icon?.color}
          shape={bot?.icon?.shape}
          outline={bot?.icon?.outline}
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
 * The activity slot: 28px, one fact at a time, two faces. Both stay mounted and
 * cross-fade, so the line leaves wearing its last words instead of blinking
 * out, and the caption below never moves while they trade places.
 */
function ActivityRow({
  tool,
  micOff,
  listening,
  getMicSpectrum,
}: {
  tool: ToolRun | null;
  micOff: boolean;
  listening: boolean;
  getMicSpectrum?: () => ArrayLike<number>;
}) {
  // held past the tool so the pill has something to fade out with
  const [shown, setShown] = useState(tool);
  useEffect(() => {
    if (tool) setShown(tool);
  }, [tool]);

  const hearing = listening && !tool;
  return (
    <div className="grid h-7 max-w-full items-center justify-items-center">
      {shown && (
        <Fade at="col-start-1 row-start-1 max-w-full" shown={tool !== null}>
          <Activity tool={shown} micOff={micOff} />
        </Fade>
      )}
      <Fade at="col-start-1 row-start-1" shown={hearing}>
        <Ear live={hearing} getMicSpectrum={getMicSpectrum} />
      </Fade>
    </div>
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

/**
 * The only hint line on screen. Says one thing at a time; outside a call it
 * shows one way in (wake phrase or hotkey), inside a call how to end and the
 * elapsed time. Keyed so changes fade.
 */
function Hint({
  status,
  idleLeft,
  since,
  wakePhrase,
  hotkeyLabel,
}: {
  status: CallStatus;
  idleLeft: number | null;
  since: number | null;
  wakePhrase: string | null;
  hotkeyLabel: string | null;
}) {
  const busy = status === "connecting";
  const live = status !== "idle" && !busy;

  let body: React.ReactNode;
  let key: string;
  if (busy) {
    key = status;
    body = status === "connecting" ? "Connecting…" : "Ending…";
  } else if (live && idleLeft !== null) {
    key = "quiet";
    body = `Quiet — ending in ${idleLeft}s. Say anything to stay.`;
  } else if (live) {
    key = "live";
    body = (
      <>
        <span>Tap Thursday to end</span>
        <span className="text-muted-foreground/40">·</span>
        <Elapsed since={since} />
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
          vary={DEFAULT_BOT.name}
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

/** Turns shown at once. */
const VISIBLE = 3;

/**
 * Wheel delta per turn. Deliberately heavy — a turn is a paragraph, and a
 * trackpad flick that pages three of them reads as losing the conversation
 * rather than moving through it. The give is what says it is not stuck.
 */
const STEP = 360;

/** How far the plates lean while the wheel is short of a turn, px. */
const GIVE = 10;

/** How long the wheel keeps what it has gathered. Past this the lean springs back and the count starts over, so half a turn never waits around to be completed by the next flick. */
const SETTLE_MS = 220;

/**
 * Where the wheel has wound the turns back to. Lives on the screen rather than
 * in the plates: the three plates are small and sit off to the sides, so a
 * wheel over the face — where the cursor is — used to reach nothing at all.
 */
function useTurnPager(messages: CallMessage[]) {
  const [back, setBack] = useState(0);
  const [give, setGive] = useState(0);
  const drag = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seen = useRef(messages.length);

  const furthest = Math.max(0, messages.length - VISIBLE);

  // stay on the turn being read when new turns arrive
  useEffect(() => {
    const grew = messages.length - seen.current;
    seen.current = messages.length;
    if (grew > 0) {
      setBack((was) => (was > 0 ? Math.min(was + grew, furthest) : 0));
    }
  }, [messages.length, furthest]);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  const onWheel = (event: React.WheelEvent) => {
    // nothing behind the three on screen: no travel, and no lean pretending there is
    if (furthest === 0) return;
    drag.current += event.deltaY;
    const steps = Math.trunc(drag.current / STEP);
    if (steps !== 0) {
      drag.current -= steps * STEP;
      setBack((was) => Math.min(furthest, Math.max(0, was - steps)));
    }
    setGive(drag.current / STEP);

    // spring back so the give reads as resistance, not position
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      drag.current = 0;
      setGive(0);
    }, SETTLE_MS);
  };

  const end = messages.length - back;
  return {
    shown: messages.slice(Math.max(0, end - VISIBLE), end),
    give,
    onWheel,
  };
}

/**
 * Recent turns beside the face: yours on the right, hers on the left, each on
 * a fill with no edge. Anchored outside the face box (`right-full` /
 * `left-full`) so they never cover it. Older turns sit higher, smaller, and
 * their plate recedes.
 */
function SideCaptions({
  shown,
  give,
}: {
  shown: CallMessage[];
  /** How far into the next turn the wheel is, -1..1; the plates lean by it. */
  give: number;
}) {
  return (
    <>
      {shown.map((message, index) => {
        // the speaker fixes the side, so a turn never switches sides as older ones stack up
        const mine = message.role === "user";
        // 18..68 rather than 20..75: a five-line newest turn has to clear the activity line
        const top = 18 + (index * 50) / Math.max(1, shown.length - 1);
        const age = shown.length - 1 - index;
        const size = atAge(CAPTION_SIZES, age);
        const pad = atAge(CAPTION_PADS, age);
        const fill = atAge(mine ? CAPTION_YOURS : CAPTION_HERS, age);
        const ink = atAge(CAPTION_HERS_INK, age);

        return (
          <div
            key={message.id}
            style={{
              top: `${top}%`,
              transform: `translateY(calc(-50% + ${-give * GIVE}px))`,
            }}
            className={cn(
              // fixed-width slot, natural-width plate: short lines stay short and hug the face
              "pointer-events-auto absolute flex w-[min(23rem,24vw)] transition-transform duration-100",
              // yours on the right, the side the settings corner already takes
              mine ? "left-full ml-6" : "right-full mr-6 justify-end",
            )}
          >
            {/* Not a `Bubble`: that sets its surface on the content from the
                parent, at a specificity a caption cannot override. One shape,
                two fills — and no edge on either, so the plate is the whole
                surface. The squared corner is the one nearest the face. */}
            <div
              className={cn(
                "w-fit max-w-full animate-in rounded-[18px] fade-in duration-500",
                pad,
                mine
                  ? cn(
                      "rounded-bl-md text-primary-foreground slide-in-from-left-2",
                      fill,
                    )
                  : cn("rounded-br-md slide-in-from-right-2", fill, ink),
              )}
            >
              {/* One truncation idiom on both sides: speech that runs past the
                  frame fades out. An ellipsis mid-sentence reads as an error. */}
              <Flow
                text={message.text}
                lines={CAPTION_TURN_LINES[age] ?? 2}
                className={size}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}

export function Thursday() {
  const {
    status,
    messages,
    tool,
    idleLeft,
    since,
    micOff,
    call,
    getSpectrum,
    getMicSpectrum,
    wakePhrase,
    hotkey,
  } = useThursday();
  // one entry point per line: the wake phrase if any, else the hotkey
  const hotkeyLabel = useHotkeyLabel(hotkey);
  // a preference, not a fact about the model (thursday.store)
  const face = useThursdayFace();
  const captionView = useThursdayStore((state) => state.captionView);
  // the tab title shows the call state off-screen
  useCallTitle(status !== "idle");

  /**
   * Same question as the server's `isCallable`, asked here because the answer
   * can change during a call (NeedsKey). Unknown counts as not callable.
   */
  const { data: config } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const callable = SPEACH_MODEL_PROVIDER_LIST.some((provider) =>
    isConfigSet(config, provider.apiKeyName),
  );

  return (
    <CallScreen
      status={status}
      messages={messages}
      tool={tool}
      onTap={call}
      wakePhrase={wakePhrase}
      hotkeyLabel={hotkeyLabel}
      idleLeft={idleLeft}
      since={since}
      micOff={micOff}
      getSpectrum={getSpectrum}
      getMicSpectrum={getMicSpectrum}
      face={face}
      captionView={captionView}
      callable={callable}
    />
  );
}
