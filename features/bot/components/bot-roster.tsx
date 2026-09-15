"use client";

import type { BotRef } from "../thread.store";
import { BotMark } from "./bot-mark";

/** Faces drawn before the count carries the rest. */
const SHOWN = 3;

/**
 * Who was in this room. A thread that never left its own bot draws nothing: the
 * row already shows that bot's face, and a stack of one says less than none.
 */
export function BotRoster({ bots }: { bots: BotRef[] }) {
  if (bots.length < 2) return null;

  return (
    <span
      className="flex shrink-0 items-center gap-1.5"
      title={bots.map((bot) => bot.name).join(", ")}
    >
      <span className="flex items-center gap-0.5">
        {bots.slice(0, SHOWN).map((bot) => (
          // Side by side, not shingled: parting overlapped faces takes a ring, and
          // a ring around a shape that is not a circle covers its neighbour.
          <BotMark
            key={bot.name}
            size={18}
            seed={bot.name}
            color={bot.icon?.color}
            shape={bot.icon?.shape}
            outline={bot.icon?.outline}
            paint={bot.icon?.paint}
            notify={false}
            className="shrink-0"
          />
        ))}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground">
        {bots.length} bots
      </span>
    </span>
  );
}
