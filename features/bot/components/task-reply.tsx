"use client";

import {
  ArrowUp,
  ChevronDown,
  ChevronsRight,
  CornerDownLeft,
  Loader2,
  Square,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FoldedText } from "@/components/ui/folded-text";
import { Markdown } from "@/components/ui/markdown";
import { ShinyText } from "@/components/ui/shiny-text";
import { Textarea } from "@/components/ui/textarea";
import { answerTaskAction, cancelTaskAction } from "@/features/bot/bot.action";
import {
  isAppStop,
  TASK_CONTINUE,
  type TaskAsk,
  type TaskStatus,
} from "@/features/bot/bot.schema";
import {
  type Chatter,
  screenActs,
  taskDrafts,
} from "@/features/bot/task.store";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";
import type { RoomView } from "../room.schema";

/**
 * Talking to a task without voice, through one pipe (bot.runner answerTask): answer a
 * waiting task, step into a running one (read before its next step), or continue a
 * finished one. A running task shows a button rather than an open box so this does
 * not become chat. An open call is told too (screenActs), or it asks again.
 */
export function TaskReply({
  task,
  status,
  lines = [],
  className,
}: {
  task: {
    id: string;
    label: string;
    bot: string;
    ask: TaskAsk | null;
    room?: RoomView | null;
  };
  status: TaskStatus;
  /** Thread lines; a queued note shows until it appears here as a user line. */
  lines?: Chatter[];
  className?: string;
}) {
  const initialRecipient =
    taskDrafts.recipient(task.id) ?? task.ask?.bot ?? task.bot;
  const [recipient, setRecipient] = useState(initialRecipient);
  const [replyTo, setReplyTo] = useState<string | undefined>(
    task.ask?.messageId,
  );
  const [draft, setDraft] = useState(() =>
    taskDrafts.get(task.id, initialRecipient),
  );
  useEffect(() => {
    const bot = taskDrafts.recipient(task.id) ?? task.ask?.bot ?? task.bot;
    setRecipient(bot);
    setDraft(taskDrafts.get(task.id, bot));
    setReplyTo(task.ask?.bot === bot ? task.ask?.messageId : undefined);
  }, [task.id, task.ask?.bot, task.ask?.messageId, task.bot]);

  const write = (text: string) => {
    setDraft(text);
    taskDrafts.set(task.id, recipient, text);
  };
  const selectRecipient = (bot: string, messageId?: string) => {
    taskDrafts.select(task.id, bot);
    setRecipient(bot);
    setReplyTo(messageId);
    setDraft(taskDrafts.get(task.id, bot));
  };
  const [answer, answering] = useAnswerTask();
  const [stop, stopping] = useServerAction(cancelTaskAction, {
    onOk: (stopped) => {
      revalidate(queryKey.tasks);
      // Cancel is not relayed on its own; tell the open call.
      screenActs.announce({
        kind: "stopped",
        id: stopped.id,
        label: stopped.label,
      });
    },
  });
  const busy = answering || stopping;

  // Running task: whether the box is open, and a sent note still waiting between
  // steps. Notes land in the thread only after the current step (bot.run notes).
  const [stepping, setStepping] = useState(false);
  const [legacyQueued, setQueued] = useState<string | null>(null);
  useEffect(() => {
    setStepping(false);
    setQueued(null);
  }, [task.id]);
  useEffect(() => {
    if (status !== "running") setQueued(null);
  }, [status]);
  useEffect(() => {
    if (
      legacyQueued &&
      lines.some((line) => line.kind === "user" && line.text === legacyQueued)
    ) {
      setQueued(null);
    }
  }, [lines, legacyQueued]);

  const pending =
    task.room?.deliveries.filter((delivery) => !delivery.delivered) ?? [];
  const queued = task.room
    ? pending.map((delivery) => `${delivery.bot}: ${delivery.text}`).join(" · ")
    : legacyQueued;

  const send = async (text: string) => {
    if (busy) return;
    // On failure the draft stays; the hook already toasted.
    if (await answer(task, text, recipient, replyTo)) {
      write("");
      if (status === "running") {
        setQueued(text.trim());
        setStepping(false);
      }
    }
  };

  const asking = status === "waiting" ? task.ask : null;
  const appStop = isAppStop(asking);
  const placeholder = asking
    ? asking.options.length
      ? "Or put it another way…"
      : "Your answer"
    : status === "running"
      ? `What's off? ${recipient} reads this before its next step`
      : "Anything more? It picks up where it left off";

  const active =
    task.room?.participants
      .filter((participant) => participant.state === "running")
      .map((participant) => participant.bot)
      .join(", ") || task.bot;
  const routing = (
    <div className="flex min-w-0 flex-col gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="ghost" size="sm" className="w-fit" />
          }
        >
          To {recipient}
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {(task.room?.participants ?? [{ bot: task.bot, state: "done" }]).map(
            (participant) => (
              <DropdownMenuItem
                key={participant.bot}
                onClick={() => {
                  selectRecipient(participant.bot);
                }}
              >
                {participant.bot} · {participant.state}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {!!task.room?.questions.length && (
        <div className="max-h-48 space-y-2 overflow-y-auto">
          {task.room.questions.map((question) => (
            <div key={question.id} className="min-w-0 rounded-xl border p-2">
              <Button
                type="button"
                variant={replyTo === question.id ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={replyTo === question.id}
                onClick={() => {
                  selectRecipient(question.bot, question.id);
                  setStepping(true);
                }}
              >
                {replyTo === question.id ? "Replying to" : "Reply to"}{" "}
                {question.bot}
              </Button>
              <Markdown className="min-w-0 text-sm wrap-anywhere">
                {question.text}
              </Markdown>
            </div>
          ))}
        </div>
      )}
    </div>
  );
  const form = (
    <div className="flex min-w-0 flex-col gap-2">
      {routing}
      {/* Enter sends, Shift+Enter breaks a line. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        className="flex min-w-0 items-end gap-1 rounded-2xl bg-background py-1.5 pr-1.5 pl-3.5 ring-1 ring-border/80 transition-shadow focus-within:ring-ring/60"
      >
        <Textarea
          value={draft}
          rows={1}
          disabled={busy}
          // The box appears only after Step in; focus it.
          autoFocus={status === "running"}
          onChange={(event) => write(event.target.value)}
          // During IME composition Enter confirms the character, not the message
          // (keyCode 229 for browsers without isComposing).
          onKeyDown={(event) => {
            if (event.key === "Escape" && status === "running") {
              setStepping(false);
              return;
            }
            if (event.key !== "Enter" || event.shiftKey) return;
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            void send(draft);
          }}
          placeholder={placeholder}
          aria-label={`Message for ${task.label}`}
          className="max-h-32 min-h-0 min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-1 text-[13px] leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        {status === "running" && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setStepping(false)}
            aria-label="Never mind"
            className="text-muted-foreground"
          >
            <X />
          </Button>
        )}
        <Button
          type="submit"
          size="icon-sm"
          variant={draft.trim() ? "default" : "ghost"}
          disabled={!draft.trim() || busy}
          aria-label="Send"
          className="rounded-full"
        >
          {answering ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </form>
    </div>
  );

  if (status === "running" && !stepping && !task.room?.questions.length) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-2xl bg-muted/40 py-1.5 pr-1.5 pl-3.5 ring-1 ring-border/50",
          className,
        )}
      >
        {queued ? (
          <p className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] leading-5 text-muted-foreground">
            <Loader2 className="size-3 shrink-0 animate-spin" />
            <span className="shrink-0">Before its next step:</span>
            {/* Still in the air until the bot picks it up, so it shines like every
                other line that is still moving. */}
            <ShinyText text={queued} speed={2.2} className="min-w-0 truncate" />
          </p>
        ) : (
          // The job is moving while this line is up, so the line moves too.
          <ShinyText
            text={`${active} · Working`}
            speed={2.4}
            className="min-w-0 flex-1 truncate text-[12.5px] leading-5 break-keep"
          />
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setStepping(true)}
          className="h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-[12px]"
        >
          <CornerDownLeft className="size-3.5" />
          Step in
        </Button>
        <span className="h-4 w-px shrink-0 bg-border" />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={busy}
          onClick={() => stop(task.id)}
          aria-label="Stop this task"
          className="shrink-0 text-muted-foreground/60 hover:text-foreground"
        >
          {stopping ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Square className="size-3" />
          )}
        </Button>
      </div>
    );
  }

  if (!asking) return <div className={className}>{form}</div>;

  return (
    <div
      className={cn(
        // The frame separates a question from the moving thread without adding
        // a third surface colour to the app's black-and-white conversation.
        "space-y-2.5 rounded-2xl bg-muted/35 px-3.5 py-3 ring-1 ring-border/80",
        className,
      )}
    >
      {!task.room && (
        <p className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="shrink-0">To</span>
          <span className="truncate text-foreground">{recipient}</span>
          <span className="shrink-0 text-muted-foreground/50">·</span>
          <span className="truncate">{task.label}</span>
        </p>
      )}

      {/* Empty when the question already is the last thread line (bot-room askFor).
          A bot that stops on its own result sends the whole answer as the question, and
          this panel does not scroll — the thread above it does — so it is folded. */}
      {asking.question && !task.room?.questions.length && (
        <FoldedText
          text={asking.question}
          subject="message"
          clamp="line-clamp-6"
          tall="max-h-56"
        />
      )}

      {asking.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {asking.options.map((option) => (
            <Button
              key={option}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => send(option)}
              className="h-7 gap-1.5 rounded-full bg-background px-3 text-[12px]"
            >
              {appStop && option === TASK_CONTINUE && (
                <ChevronsRight className="size-3.5 text-muted-foreground" />
              )}
              {option}
            </Button>
          ))}
        </div>
      )}

      {form}

      {/* Only a job still going can be stopped: cancelling writes "Cancelled."
          over the outcome, which on a finished job is the answer itself. */}
      {status === "waiting" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => stop(task.id)}
          className="font-mono text-[10px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          Stop this task instead
        </button>
      )}
    </div>
  );
}

/** The one path for answering a task, shared with inbox rows; announces to the call once (screenActs). */
export function useAnswerTask() {
  const [answer, answering] = useServerAction(answerTaskAction, {
    onOk: () => revalidate(queryKey.tasks),
  });

  /** True once sent. Failures are already toasted by the hook. */
  const send = async (
    task: { id: string; label: string },
    text: string,
    recipient?: string,
    replyTo?: string,
  ): Promise<boolean> => {
    const said = text.trim();
    if (!said) return false;
    try {
      const done = await answer(task.id, said, recipient, replyTo);
      // Tell the open call, or it asks the question again.
      screenActs.announce({
        kind: "answered",
        id: done.id,
        label: done.label,
        answer: said,
        recipient,
        replyTo,
      });
      return true;
    } catch {
      return false;
    }
  };

  return [send, answering] as const;
}
