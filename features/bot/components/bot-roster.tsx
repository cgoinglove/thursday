"use client";

import type { BotRef } from "../task.store";
import { BotMark } from "./bot-mark";

/** Faces drawn before the count carries the rest. */
const SHOWN = 3;

/**
 * Who was in this room. A task that never left its own bot draws nothing: the
 * row already shows that bot's face, and a stack of one says less than none.
 */
export function BotRoster({
  bots,
  taskId,
}: {
  bots: BotRef[];
  taskId: string;
}) {
  if (bots.length < 2) return null;

  return (
    <span
      className="flex shrink-0 items-center gap-1.5"
      title={bots.map((bot) => bot.name).join(", ")}
    >
      <span className="flex items-center">
        {bots.slice(0, SHOWN).map((bot) => (
          // A 3px shingle: enough to read as a group, not enough to hide a face.
          <BotMark
            key={bot.name}
            size={18}
            seed={bot.name}
            vary={taskId}
            color={bot.icon?.color}
            shape={bot.icon?.shape}
            outline={bot.icon?.outline}
            notify={false}
            className="-ml-[3px] rounded-[7px] ring-2 ring-background first:ml-0"
          />
        ))}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground">
        {bots.length} bots
      </span>
    </span>
  );
}
