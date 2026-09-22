"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Letters } from "@/components/ui/letters";
import type { CallMessage } from "@/features/thursday/thursday.schema";
import { windowKey } from "@/hooks/use-hotkey";
import { cn } from "@/lib/utils";

/**
 * Side captions (Captions › sides): the conversation beside the face, hers on
 * the left and yours on the right. Each side holds one turn level with the face
 * and the rest recede above and below it.
 */

/** One speaker's words in a row, however many display groups Live cut them into. */
export type Turn = { id: string; role: CallMessage["role"]; text: string };

type Role = Turn["role"];

export function turnsOf(messages: CallMessage[]) {
  const turns: Turn[] = [];
  for (const message of messages) {
    const last = turns.at(-1);
    if (last?.role === message.role && !message.fresh)
      last.text = `${last.text} ${message.text}`;
    else turns.push({ id: message.id, role: message.role, text: message.text });
  }
  return turns;
}

/** Per side, the turn a click went back to; null follows that side's latest. */
type Pinned = Record<Role, number | null>;

const NOW: Pinned = { assistant: null, user: null };

/**
 * Which turn each side holds level with the face. A click on a receded turn
 * brings it level on its own side only; a side that went back keeps its turn
 * while new ones arrive below it, and ↓ brings both back to now. The key is the
 * window's while the captions are up, except in a field, a key capture or a
 * dialog.
 */
export function useTurnFocus(turns: Turn[], enabled: boolean) {
  const [pinned, setPinned] = useState<Pinned>(NOW);

  // a new call starts from now
  useEffect(() => {
    if (!enabled) setPinned(NOW);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      if (!windowKey(event)) return;
      event.preventDefault();
      setPinned(NOW);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);

  const pick = useCallback(
    (role: Role, at: number) => {
      const latest = turns.filter((turn) => turn.role === role).length - 1;
      setPinned((was) => ({ ...was, [role]: at >= latest ? null : at }));
    },
    [turns],
  );

  return {
    pinned,
    pick,
    back: pinned.assistant !== null || pinned.user !== null,
  };
}

/**
 * How the turns around the one level with the face recede: each turn away steps
 * back `DEPTH` px under `PERSPECTIVE` and is drawn at `SMALL` of its size, so it
 * reads smaller and a little toward the face. These are the drawing, not settings.
 */
const PERSPECTIVE = 1150;
const DEPTH = 700;
const SMALL = 0.78;
/** Space between two turns, and how far each step away drifts toward the face. */
const GAP = 49;
const ARC = 14;
/** Turns drawn before and after the level one. A receded turn keeps four lines. */
const BEFORE = 2;
const AFTER = 2;
/** Ink of the first receded turn (each further one keeps 0.6 of it), and on hover. */
const RECEDED_INK = 0.56;
const HOVER_INK = 0.9;
/** The words are 17px on 1.675; the level turn's first line sits here against the face's middle. */
const LINE = 17 * 1.675;
/** The level turn scrolls in place past this many of its own lines, instead of growing forever. */
const LEVEL_MAX_LINES = 10;
const LIFT = -40;
/** Between her level words and what stands under them. */
const UNDER_GAP = 8;
/** The height key of what stands under the level turn, beside the turns' own ids. */
const UNDER = "(under)";

/**
 * The conversation beside the face, no plates and no names: a filled dot at
 * the head of each side's level turn says whose it is, and pulses while that
 * turn is still being said. Anchored past her canvas (the face box's
 * `--face-bleed` beyond its edge) so nothing covers the face.
 */
export function SideCaptions({
  turns,
  pinned,
  live,
  onPick,
  under = null,
  ahead = false,
  workOf,
  typed = false,
}: {
  turns: Turn[];
  pinned: Pinned;
  /** The last turn is still being said. */
  live: boolean;
  onPick: (role: Role, at: number) => void;
  /** Her turn in the making: the work under way before she has said anything to it. */
  under?: ReactNode;
  /**
   * That work is her turn in the making — theirs came last and she has not spoken yet — so
   * it takes her level line, and the words she said before it step back as they would for a
   * new turn.
   */
  ahead?: boolean;
  /** The work behind one of her turns, drawn under it while it is level; null for none. */
  workOf?: (turn: string) => ReactNode;
  /** A call in writing: their words were typed whole, so they arrive whole. */
  typed?: boolean;
}) {
  const last = turns.at(-1);
  return (
    <>
      {(["assistant", "user"] as const).map((role) => (
        <SideColumn
          key={role}
          role={role}
          turns={turns.filter((turn) => turn.role === role)}
          pinned={pinned[role]}
          saying={live ? last?.id : undefined}
          onPick={(at) => onPick(role, at)}
          under={role === "assistant" ? under : null}
          ahead={role === "assistant" && ahead}
          workOf={role === "assistant" ? workOf : undefined}
          whole={typed && role === "user"}
        />
      ))}
    </>
  );
}

function SideColumn({
  role,
  turns,
  pinned,
  saying,
  onPick,
  under,
  ahead,
  workOf,
  whole,
}: {
  role: Role;
  /** This side's turns only. */
  turns: Turn[];
  pinned: number | null;
  /** The turn still being said, if any. */
  saying: string | undefined;
  onPick: (at: number) => void;
  under: ReactNode;
  ahead: boolean;
  workOf: ((turn: string) => ReactNode) | undefined;
  /** The latest turn is drawn at once rather than letter by letter. */
  whole: boolean;
}) {
  const mine = role === "user";
  // Heights as laid out, before any transform: text grows while it is said, and
  // receding clamps a turn to four lines
  const [heights, setHeights] = useState<Record<string, number>>({});
  // Widths too: what stands under her level words is as wide as they are
  const [widths, setWidths] = useState<Record<string, number>>({});
  const watch = useRef<ResizeObserver | null>(null);
  useEffect(() => () => watch.current?.disconnect(), []);
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const sizes =
      (read: (box: HTMLElement) => number) =>
      (was: Record<string, number>, entries: ResizeObserverEntry[]) => {
        let next = was;
        for (const entry of entries) {
          const box = entry.target as HTMLElement;
          const id = box.dataset.turn;
          if (!id || was[id] === read(box)) continue;
          if (next === was) next = { ...was };
          next[id] = read(box);
        }
        return next;
      };
    const tall = sizes((box) => box.offsetHeight);
    const wide = sizes((box) => box.offsetWidth);
    watch.current ??= new ResizeObserver((entries) => {
      setHeights((was) => tall(was, entries));
      setWidths((was) => wide(was, entries));
    });
    watch.current.observe(node);
    return () => watch.current?.unobserve(node);
  }, []);

  const latest = turns.length - 1;
  // One past the latest is a level line with no words on it yet: what stands under takes it
  const at =
    pinned === null && (ahead || !turns.length)
      ? turns.length
      : Math.min(pinned ?? latest, latest);
  // The level turn scrolls in place past LEVEL_MAX_LINES; keep it pinned to the
  // newest words as they stream in, the way a chat log stays at its foot.
  const scrollRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns[at]?.text]);

  if (!turns.length && !under) return null;
  const near = (k: number) =>
    PERSPECTIVE / (PERSPECTIVE + DEPTH * Math.abs(k - at));
  const size = (k: number) => (k === at ? 1 : SMALL);
  const tall = (k: number) =>
    (heights[turns[k].id] ?? LINE) * near(k) * size(k);
  // Every turn is placed by its top edge and scales from it. Centring the box
  // instead jumps a turn half a line the moment its text wraps, then slides it
  // back once the taller box is measured a frame later
  // Under the level line: her turn in the making, else the work behind the turn that is
  // level — the latest, or one gone back to
  const below = at === turns.length ? under : (workOf?.(turns[at].id) ?? null);
  const top: number[] = Array(turns.length + 1).fill(0);
  top[at] = -LINE / 2;
  for (let k = at - 1; k >= 0; k--) top[k] = top[k + 1] - GAP - tall(k);
  // what stands under a turn gone back to pushes the turns after it down, not over them
  const room =
    below && at < turns.length ? (heights[UNDER] ?? 0) + UNDER_GAP : 0;
  for (let k = at + 1; k < turns.length; k++)
    top[k] = top[k - 1] + tall(k - 1) + GAP + (k - 1 === at ? room : 0);
  const underTop = !below
    ? null
    : at === turns.length
      ? top[at]
      : top[at] + (heights[turns[at].id] ?? LINE) + UNDER_GAP;

  return (
    <div
      className={cn(
        "pointer-events-none absolute h-0 w-[min(21.25rem,24vw)]",
        // the vanishing point is the face's edge on the middle line: what recedes goes toward her
        mine
          ? "left-full ml-[calc(var(--face-bleed,0px)+0.375rem)] [perspective-origin:0_0]"
          : "right-full mr-[calc(var(--face-bleed,0px)+0.375rem)] [perspective-origin:100%_0]",
      )}
      style={{ top: `calc(50% + ${LIFT}px)`, perspective: PERSPECTIVE }}
    >
      {turns.map((turn, k) => {
        const away = Math.abs(k - at);
        const shown = k < at ? at - k <= BEFORE : k - at <= AFTER;
        const level = k === at;
        const ink = !shown ? 0 : level ? 1 : RECEDED_INK * 0.6 ** (away - 1);
        const pickable = shown && !level;
        const x = (ARC * away * (mine ? -1 : 1)) / near(k);
        const y = top[k] / near(k);
        return (
          <div
            key={turn.id}
            ref={measure}
            data-turn={turn.id}
            aria-hidden={!shown}
            onClick={pickable ? () => onPick(k) : undefined}
            style={
              {
                transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translateZ(${-DEPTH * away}px) scale(${size(k)})`,
                "--ink": ink,
                "--lift": Math.max(ink, HOVER_INK),
              } as CSSProperties
            }
            className={cn(
              "group/turn absolute top-0 w-max max-w-full text-[17px] leading-[1.675] tracking-[0.3px] text-foreground transition-transform duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              whole &&
                k === turns.length - 1 &&
                "animate-in fade-in duration-200 motion-reduce:animate-none",
              mine ? "left-0 origin-top-left" : "right-0 origin-top-right",
              !shown && "invisible",
              pickable && "pointer-events-auto cursor-pointer",
              level && "pointer-events-auto",
            )}
          >
            <p
              ref={level ? scrollRef : undefined}
              className={cn(
                "break-keep text-pretty opacity-(--ink) transition-opacity duration-[520ms] motion-reduce:transition-none",
                !level && "line-clamp-4",
                level && "overflow-y-auto overscroll-contain scrollbar-none",
                pickable && "group-hover/turn:opacity-(--lift)",
              )}
              style={level ? { maxHeight: LINE * LEVEL_MAX_LINES } : undefined}
            >
              {level && (
                <span
                  className={cn(
                    "mr-4 inline-block size-2.5 rounded-full align-middle",
                    turn.id === saying
                      ? "animate-pulse motion-reduce:animate-none"
                      : "opacity-55",
                    // hers is the brand colour, yours the foreground
                    mine ? "bg-foreground" : "bg-brand",
                  )}
                />
              )}
              {/* Each side's latest turn keeps its letters wherever it sits, so going back and returning never draws it again */}
              {k === turns.length - 1 && !whole ? (
                <Letters text={turn.text} />
              ) : (
                turn.text
              )}
            </p>
          </div>
        );
      })}
      {below && (
        <div
          ref={measure}
          data-turn={UNDER}
          style={{
            transform: `translateY(${(underTop ?? 0).toFixed(1)}px)`,
            // under her words it takes their width, so its lines start where they do;
            // before she has said any, the side's
            width: at < turns.length ? widths[turns[at].id] : undefined,
          }}
          className={cn(
            "absolute top-0 flex w-full transition-transform duration-[520ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            mine ? "left-0 justify-start" : "right-0 justify-end",
          )}
        >
          {below}
        </div>
      )}
    </div>
  );
}
