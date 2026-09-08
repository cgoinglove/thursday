"use client";

import {
  ArrowUp,
  ChevronsRight,
  CornerDownLeft,
  Loader2,
  Square,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { FoldedText } from "@/components/ui/folded-text";
import ShinyText from "@/components/ui/shiny-text";
import { Textarea } from "@/components/ui/textarea";
import { BOT_RUN } from "@/config";
import { answerTaskAction, cancelTaskAction } from "@/features/bot/bot.action";
import {
  isBudgetAsk,
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
  task: { id: string; label: string; bot: string; ask: TaskAsk | null };
  status: TaskStatus;
  /** Thread lines; a queued note shows until it appears here as a user line. */
  lines?: Chatter[];
  className?: string;
}) {
  // Drafts belong to the task (task.store taskDrafts) and survive switching threads.
  const [draft, setDraft] = useState(() => taskDrafts.get(task.id));
  // Not remounted per task, so swap the draft here.
  useEffect(() => setDraft(taskDrafts.get(task.id)), [task.id]);

  const write = (text: string) => {
    setDraft(text);
    taskDrafts.set(task.id, text);
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
  const [queued, setQueued] = useState<string | null>(null);
  useEffect(() => {
    setStepping(false);
    setQueued(null);
  }, [task.id]);
  useEffect(() => {
    if (status !== "running") setQueued(null);
  }, [status]);
  useEffect(() => {
    if (
      queued &&
      lines.some((line) => line.kind === "user" && line.text === queued)
    ) {
      setQueued(null);
    }
  }, [lines, queued]);

  const send = async (text: string) => {
    if (busy) return;
    // On failure the draft stays; the hook already toasted.
    if (await answer(task, text)) {
      write("");
      if (status === "running") {
        setQueued(text.trim());
        setStepping(false);
      }
    }
  };

  const asking = status === "waiting" ? task.ask : null;
  const budget = isBudgetAsk(asking);
  const placeholder = asking
    ? asking.options.length
      ? "Or put it another way…"
      : "Your answer"
    : status === "running"
      ? `What's off? ${task.bot} reads this before its next step`
      : "Anything more? It picks up where it left off";

  const form = (
    // Enter sends, Shift+Enter breaks a line.
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send(draft);
      }}
      className="flex items-end gap-1 rounded-2xl bg-background py-1.5 pr-1.5 pl-3.5 ring-1 ring-border/80 transition-shadow focus-within:ring-ring/60"
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
        className="max-h-32 min-h-0 flex-1 resize-none border-0 bg-transparent px-0 py-1 text-[13px] leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
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
  );

  if (status === "running" && !stepping) {
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
            <ShinyText
              text={queued}
              speed={2.2}
              color="var(--muted-foreground)"
              shineColor="var(--foreground)"
              className="min-w-0 truncate"
            />
          </p>
        ) : (
          // The job is moving while this line is up, so the line moves too.
          <ShinyText
            text={`${task.bot} is on it — Thursday steers it by voice.`}
            speed={2.4}
            color="var(--muted-foreground)"
            shineColor="var(--foreground)"
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
        "space-y-2.5 rounded-2xl px-3.5 py-3 ring-1",
        // A budget stop is not a question, so it does not take the waiting colour.
        budget
          ? "bg-muted/40 ring-border/50"
          : "bg-amber-500/8 ring-amber-500/25",
        className,
      )}
    >
      <p className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
        <span className="shrink-0">To</span>
        <span className="truncate text-foreground">{task.bot}</span>
        <span className="shrink-0 text-muted-foreground/50">·</span>
        <span className="truncate">{task.label}</span>
      </p>

      {/* Empty when the question already is the last thread line (bot-room askFor).
          A bot that stops on its own result sends the whole report as the question, and
          this panel does not scroll — the thread above it does — so it is folded. */}
      {asking.question && (
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
              {budget && option === TASK_CONTINUE && (
                <ChevronsRight className="size-3.5 text-muted-foreground" />
              )}
              {option}
              {budget && option === TASK_CONTINUE && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  +{BOT_RUN.steps} steps
                </span>
              )}
            </Button>
          ))}
        </div>
      )}

      {form}

      <button
        type="button"
        disabled={busy}
        onClick={() => stop(task.id)}
        className="font-mono text-[10px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        Stop this task instead
      </button>
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
  ): Promise<boolean> => {
    const said = text.trim();
    if (!said) return false;
    try {
      const done = await answer(task.id, said);
      // Tell the open call, or it asks the question again.
      screenActs.announce({
        kind: "answered",
        id: done.id,
        label: done.label,
        answer: said,
      });
      return true;
    } catch {
      return false;
    }
  };

  return [send, answering] as const;
}
