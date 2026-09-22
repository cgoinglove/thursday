"use client";

import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { BotIcon } from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";

/**
 * A tooltip about a bot opens with the bot: its own mark and its name, as one badge, and then the
 * line. Every place that says something about a bot says it this way, so the face under the
 * pointer and the face in the tip are the same thing rather than a name to look up.
 */
export function BotTip({
  bot,
  icon,
  line,
  children,
}: {
  bot: string;
  icon?: BotIcon | null;
  /** What this bot is doing, in a few words; nothing leaves the badge alone. */
  line?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{children}</TooltipTrigger>
      <TooltipContent className="flex items-center gap-2 py-1 pr-2.5 pl-1">
        <span className="flex items-center gap-1.5 rounded-full bg-background/15 py-0.5 pr-2 pl-1">
          <BotMark
            size={15}
            seed={bot}
            color={icon?.color}
            shape={icon?.shape}
            outline={icon?.outline}
            paint={icon?.paint}
          />
          <span className="font-medium text-[11px]">{bot}</span>
        </span>
        {line && <span className="text-[11.5px] opacity-80">{line}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
