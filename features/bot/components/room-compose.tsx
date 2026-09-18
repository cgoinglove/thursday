"use client";
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { startThreadAction } from "@/features/bot/bot.action";
import { type Bot, DEFAULT_BOT } from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate } from "@/lib/protocol/use-server-route";
import { type BotRef } from "../thread.store";

/** Writing to a bot from the room: who it is for, then the words. Split out of bot-room by subject; see it for the room as a whole. */

/** Starts a job. Lives in the header of whichever list is on screen. */
export function ComposeButton({ onClick }: { onClick: () => void }) {
  return (
    <RoundButton onClick={onClick} label="Message a bot">
      <Plus className="size-4" />
    </RoundButton>
  );
}

export function RoundButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </button>
  );
}

/**
 * Handing a bot a job without the call in the room: pick one, write, send
 * (bot.action startThreadAction). The message is the whole request — there is no
 * conversation to draw the rest from, which is why the box asks for a sentence.
 *
 * Nothing announces itself from here. The job shows up as a row on the next poll
 * and the chip says the bot took it on, exactly as a delegated one does.
 */
export function Compose({
  bots,
  onDone,
}: {
  bots?: Bot[];
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<BotRef | null>(null);
  const [draft, setDraft] = useState("");
  const [start, starting] = useServerAction(startThreadAction, {
    onOk: () => {
      revalidate(queryKey.threads);
      onDone();
    },
  });

  // A fresh install has no rows and still has a worker (bot.schema DEFAULT_BOT).
  // Switched-off bots are left out for the same reason no model is shown one —
  // but the fallback answers "no rows", not "every row off", so switching them
  // all off leaves nothing to pick rather than conjuring a worker.
  const roster: BotRef[] = bots?.length
    ? bots
        .filter((bot) => !bot.disabled)
        .map((bot) => ({ name: bot.name, icon: bot.icon }))
    : [{ name: DEFAULT_BOT.name, icon: DEFAULT_BOT.icon }];

  const send = () => {
    if (!picked || !draft.trim() || starting) return;
    start(picked.name, draft.trim());
  };

  // The picker holds three rows' worth of height whatever the roster has in it:
  // one row reads as a slot rather than a choice, and the panel must not resize
  // the day a second bot exists. The writing step keeps the same floor.
  if (!picked) {
    return (
      <div className="min-h-32 pb-3">
        <p className="px-3 pt-3 pb-1.5 font-mono text-[10px] tracking-wide text-muted-foreground">
          message a bot
        </p>
        <div className="px-1">
          {roster.map((bot) => (
            <button
              key={bot.name}
              type="button"
              onClick={() => setPicked(bot)}
              className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <BotMark
                size={22}
                seed={bot.name}
                color={bot.icon?.color}
                shape={bot.icon?.shape}
                outline={bot.icon?.outline}
                paint={bot.icon?.paint}
                className="shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {bot.name}
              </span>
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    // Holds roughly the height the picker had, so choosing a bot does not snap the
    // panel shut to one line and back open on the way back.
    <div className="flex min-h-32 flex-col pb-3">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <button
          type="button"
          onClick={() => setPicked(null)}
          aria-label="Choose a different bot"
          className="grid size-6 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <BotMark
          size={22}
          seed={picked.name}
          color={picked.icon?.color}
          shape={picked.icon?.shape}
          outline={picked.icon?.outline}
          paint={picked.icon?.paint}
          className="shrink-0"
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
          To {picked.name}
        </span>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        className="mx-3 mt-auto flex items-end gap-1 rounded-2xl bg-background py-2 pr-2 pl-3 ring-1 ring-border/80 transition-shadow focus-within:ring-ring/60"
      >
        <Textarea
          value={draft}
          rows={1}
          autoFocus
          disabled={starting}
          onChange={(event) => setDraft(event.target.value)}
          // During IME composition Enter confirms the character, not the message
          // (keyCode 229 for browsers without isComposing).
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            send();
          }}
          placeholder={`What should ${picked.name} do? It cannot hear the call, so say the whole job.`}
          aria-label={`Message for ${picked.name}`}
          className="max-h-32 min-h-15 flex-1 resize-none border-0 bg-transparent px-0 py-0 text-[13px] leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <Button
          type="submit"
          size="icon-sm"
          variant={draft.trim() ? "default" : "ghost"}
          disabled={!draft.trim() || starting}
          aria-label="Send"
          className="rounded-full"
        >
          {starting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </form>
    </div>
  );
}
