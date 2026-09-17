"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShinyText } from "@/components/ui/shiny-text";
import type { CallMessage } from "@/features/thursday/thursday.schema";
import { capturesKeys } from "@/hooks/use-hotkey";
import { cn } from "@/lib/utils";
import { ThursdayMark } from "./thursday-mark";

/**
 * Side captions (Captions › sides): the conversation beside the face, one turn
 * a side at the face's middle line and the rest receding around it.
 */

/** One speaker's words in a row, however many display groups Live cut them into. */
export type Turn = { id: string; role: CallMessage["role"]; text: string };

export function turnsOf(messages: CallMessage[]) {
  const turns: Turn[] = [];
  for (const message of messages) {
    const last = turns.at(-1);
    if (last?.role === message.role) last.text = `${last.text} ${message.text}`;
    else turns.push({ ...message });
  }
  return turns;
}

/** Wheel delta per turn: a turn is a paragraph, so a trackpad flick moves one, not three. */
const WHEEL_STEP = 120;

/** How long the wheel keeps what it has gathered before starting over. */
const WHEEL_SETTLE_MS = 220;

/**
 * Which turn the side captions are on: the latest, or as far back as the arrow
 * keys or the wheel took them. A new turn brings the focus back to now, as the
 * centre caption does with new text. The keys are the window's while the
 * captions are up, except in a field, a key capture or a dialog.
 */
export function useTurnFocus(turns: Turn[], enabled: boolean) {
  const [back, setBack] = useState(0);
  const count = useRef(turns.length);
  const drag = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const furthest = Math.max(0, turns.length - 1);

  useEffect(() => {
    if (turns.length === count.current) return;
    count.current = turns.length;
    setBack(0);
  }, [turns.length]);

  const step = useCallback(
    (by: number) => setBack((was) => Math.min(furthest, Math.max(0, was + by))),
    [furthest],
  );

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey) return;
      if (event.metaKey || event.shiftKey || capturesKeys(event.target)) return;
      if ((event.target as HTMLElement | null)?.closest?.('[role="dialog"]'))
        return;
      event.preventDefault();
      step(event.key === "ArrowUp" ? 1 : -1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, step]);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  const onWheel = (event: React.WheelEvent) => {
    drag.current += event.deltaY;
    const steps = Math.trunc(drag.current / WHEEL_STEP);
    if (steps !== 0) {
      drag.current -= steps * WHEEL_STEP;
      step(-steps);
    }
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      drag.current = 0;
    }, WHEEL_SETTLE_MS);
  };

  return { focus: Math.max(0, turns.length - 1 - back), back, onWheel };
}

/**
 * How the turns around the focus recede (canvas "Thursday Call Polish" D3, user
 * 09-17): each turn away steps back `DEPTH` px under `PERSPECTIVE`, so it draws
 * smaller, softer and a little higher. These are the drawing, not settings.
 */
const SIDE_PERSPECTIVE = 1000;
const SIDE_DEPTH = 700;
/** Space between turns at the focus's size, and the extra that lifts earlier turns. */
const SIDE_GAP = 22;
const SIDE_RISE = 10;
const SIDE_BLUR = 1.1;
/** Ink by turns away on the focused side; the other side's turn level with the focus is `SIDE_PAIR`. */
const SIDE_FADE = [1, 0.46, 0.28, 0.16];
const SIDE_PAIR = 0.62;
/** Turns farther than this are not drawn. */
const SIDE_REACH = 3;

/**
 * The conversation beside the face: her turns on the left, yours on the right,
 * no plates. Each side holds its turn level with the focus at the face's middle
 * — the focus itself, or that side's last turn before it — and the rest recede
 * above and below. Out of focus a turn keeps three lines; the turn being said
 * shines its name. Anchored outside the face box so nothing covers the face.
 */
export function SideCaptions({
  turns,
  focus,
  live,
}: {
  turns: Turn[];
  focus: number;
  /** The last turn is still being said. */
  live: boolean;
}) {
  return (
    <>
      <SideColumn turns={turns} focus={focus} live={live} role="assistant" />
      <SideColumn turns={turns} focus={focus} live={live} role="user" />
    </>
  );
}

function SideColumn({
  turns,
  focus,
  live,
  role,
}: {
  turns: Turn[];
  focus: number;
  live: boolean;
  role: Turn["role"];
}) {
  const mine = role === "user";
  // Heights as laid out, before any transform: text grows while it is said, and
  // leaving focus clamps a turn to three lines
  const [heights, setHeights] = useState<Record<string, number>>({});
  const watch = useRef<ResizeObserver | null>(null);
  useEffect(() => () => watch.current?.disconnect(), []);
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    watch.current ??= new ResizeObserver((entries) =>
      setHeights((was) => {
        let next = was;
        for (const entry of entries) {
          const box = entry.target as HTMLElement;
          const id = box.dataset.turn;
          if (!id || was[id] === box.offsetHeight) continue;
          if (next === was) next = { ...was };
          next[id] = box.offsetHeight;
        }
        return next;
      }),
    );
    watch.current.observe(node);
    return () => watch.current?.unobserve(node);
  }, []);

  const own = turns.flatMap((turn, index) =>
    turn.role === role ? [{ turn, index }] : [],
  );
  if (!own.length) return null;
  const focused = turns[focus]?.role === role;
  const level = focused
    ? focus
    : (own.findLast((one) => one.index <= focus) ?? own[0]).index;
  const at = own.findIndex((one) => one.index === level);
  const scale = (k: number) =>
    SIDE_PERSPECTIVE / (SIDE_PERSPECTIVE + SIDE_DEPTH * Math.abs(k - at));
  const tall = (k: number) => heights[own[k].turn.id] ?? 42;
  // Stacked by their drawn size, then placed back by it: perspective pulls each toward the middle line
  const drawn = own.map(() => 0);
  for (let k = at - 1; k >= 0; k--) {
    drawn[k] =
      drawn[k + 1] -
      ((tall(k) * scale(k)) / 2 +
        SIDE_GAP * scale(k + 1) +
        SIDE_RISE +
        (tall(k + 1) * scale(k + 1)) / 2);
  }
  for (let k = at + 1; k < own.length; k++) {
    drawn[k] =
      drawn[k - 1] +
      ((tall(k - 1) * scale(k - 1)) / 2 +
        SIDE_GAP * scale(k - 1) +
        (tall(k) * scale(k)) / 2);
  }

  return (
    <div
      className={cn(
        "pointer-events-none absolute top-1/2 h-0 w-[min(25rem,24vw)] [perspective:1000px]",
        // the vanishing point is the face's edge on the middle line: what recedes goes toward her
        mine
          ? "left-full ml-11 [perspective-origin:0_0]"
          : "right-full mr-11 [perspective-origin:100%_0]",
      )}
    >
      {own.map(({ turn, index }, k) => {
        const away = Math.abs(k - at);
        const fade = SIDE_FADE[away] ?? 0;
        const ink =
          index === focus
            ? 1
            : focused
              ? fade
              : index === level
                ? SIDE_PAIR
                : fade * 0.8;
        const name = mine ? "You" : "Thursday";
        return (
          <div
            key={turn.id}
            ref={measure}
            data-turn={turn.id}
            aria-hidden={away > SIDE_REACH}
            style={{
              transform: `translateY(-50%) translateY(${drawn[k] / scale(k)}px) translateZ(${-SIDE_DEPTH * away}px)`,
              opacity: away > SIDE_REACH ? 0 : ink,
              filter: away ? `blur(${away * SIDE_BLUR}px)` : undefined,
            }}
            className={cn(
              "absolute top-0 w-max max-w-full text-base leading-[26px] text-foreground transition-[transform,opacity,filter] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              away > SIDE_REACH ? "invisible" : "pointer-events-auto",
              mine ? "left-0" : "right-0",
            )}
          >
            <div
              className={cn(
                "mb-1.5 flex h-4 items-center gap-1.5 text-xs font-medium",
                !mine && "justify-end",
              )}
            >
              {mine ? (
                <span className="size-2 rounded-full ring-[1.5px] ring-foreground ring-inset" />
              ) : (
                <ThursdayMark size={14} />
              )}
              {live && index === turns.length - 1 ? (
                <ShinyText text={name} />
              ) : (
                <span>{name}</span>
              )}
            </div>
            <p
              className={cn(
                "break-keep text-pretty",
                index !== focus && "line-clamp-3",
              )}
            >
              {turn.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}
