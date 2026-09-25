"use client";

import {
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  CornerDownLeft,
  Loader2,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FoldedText } from "@/components/ui/folded-text";
import { Markdown } from "@/components/ui/markdown";
import { ShinyText } from "@/components/ui/shiny-text";
import { Textarea } from "@/components/ui/textarea";
import {
  answerThreadAction,
  cancelThreadAction,
  withdrawStepInAction,
} from "@/features/bot/bot.action";
import {
  isAppStop,
  THREAD_CONTINUE,
  type ThreadAsk,
  type ThreadStatus,
} from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import {
  type BotRef,
  screenActs,
  threadDrafts,
} from "@/features/bot/thread.store";
import { SignInAsk } from "@/features/signins/components/signin-ask";
import {
  GivenFiles,
  roomDrop,
  useGivenFiles,
} from "@/features/workspace/components/given-files";
import { composing } from "@/hooks/use-hotkey";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";
import type { RoomView } from "../room.schema";

type ReplyThread = {
  id: string;
  label: string;
  bot: string;
  ask: ThreadAsk | null;
  room: RoomView;
};

/**
 * Talking to a thread without voice, through one pipe (bot.runner answerThread). A
 * question or a pause docks where the composer was, one at a time, on a sheet
 * with no border of its own. A bot on a step shows Step in rather than an open
 * box, so the job does not turn into a chat; one that is idle inside a running
 * thread has an open box, since there is no step to step into. An open call is
 * told too (screenActs), or it asks again.
 */
export function ThreadReply({
  thread,
  status,
  faces = [],
  to = null,
  className,
}: {
  thread: ReplyThread;
  status: ThreadStatus;
  /** Bots in the thread, for their faces; a name missing here draws without its colours. */
  faces?: BotRef[];
  /** The bot whose tab the thread is on: the composer's words go to it. */
  to?: string | null;
  className?: string;
}) {
  const [selected, setSelected] = useState<string>();
  const [recipient, setRecipient] = useState(
    () => threadDrafts.recipient(thread.id) ?? thread.bot,
  );
  const [stepping, setStepping] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    setRecipient(threadDrafts.recipient(thread.id) ?? thread.bot);
    setSelected(undefined);
    setStepping(false);
  }, [thread.id, thread.bot]);
  // Opening a bot's tab addresses the composer to it, kept like a pick in RecipientPicker.
  useEffect(() => {
    if (!to) return;
    threadDrafts.select(thread.id, to);
    setRecipient(to);
  }, [thread.id, to]);

  const participants = thread.room.participants;
  const questions = thread.room.questions;
  const questionIndex = Math.max(
    0,
    questions.findIndex((question) => question.id === selected),
  );
  const question = questions[questionIndex];
  const asking = status === "waiting" ? thread.ask : null;
  const paused = isAppStop(asking);
  const recipientName =
    question?.bot ??
    (participants.some((participant) => participant.bot === recipient)
      ? recipient
      : thread.bot);
  const replyTo = question?.id;
  const [answer, answering] = useAnswerThread();
  const [stop, stopping] = useServerAction(cancelThreadAction, {
    onOk: (stopped) => {
      revalidate(queryKey.threads);
      screenActs.announce({
        kind: "stopped",
        id: stopped.id,
        label: stopped.label,
      });
    },
  });
  const busy = answering || stopping;
  const waiting = thread.room.deliveries.filter(
    (delivery) => !delivery.delivered,
  );
  const [withdraw, withdrawing] = useServerAction(withdrawStepInAction, {
    onOk: () => revalidate(queryKey.threads),
  });
  const queued = waiting
    .map((delivery) => `${delivery.bot}: ${delivery.text}`)
    .join(" · ");
  const working = participants
    .filter((participant) => participant.state === "running")
    .map((participant) => participant.bot);
  const active = working.join(", ") || thread.bot;
  // Step in interrupts a bot on a step, or about to take one. A bot that handed its part over
  // and waits is on none: words sent to it start it again at once (room.query deliver), so its
  // box is open, and nothing here calls that stepping in.
  const onStep =
    status === "running" &&
    participants.some(
      (participant) =>
        participant.bot === recipientName &&
        (participant.state === "running" || participant.state === "queued"),
    );
  const idle = status === "running" && !onStep;
  // Only the bot the job went to answers the user. Anyone it pulled in reports to it,
  // so words addressed to them come back one step removed (room.query finishRoomWork).
  const relayed = recipientName !== thread.bot;
  const faceOf = (name: string): BotRef =>
    faces.find((bot) => bot.name === name) ?? { name };

  const send = async (text: string) => {
    if (busy) return false;
    const sent = await answer(thread, text, recipientName, replyTo);
    if (sent && onStep) setStepping(false);
    return sent;
  };
  /** A choice is sent as it is, through the same pipe as typed words. */
  const choose = async (option: string) => {
    setPicked(option);
    await send(option);
    setPicked(null);
  };

  // Only a job still going can be stopped: a cancel clears the outcome, which on a
  // finished job is the answer itself. It is a word, never a glyph alone, and never beside
  // Send: on a working row it follows Step in, on a question or a pause it heads the sheet.
  const stopButton = (onSheet = false) =>
    status === "running" || status === "waiting" ? (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        loading={stopping}
        disabled={busy}
        onClick={() => stop(thread.id)}
        aria-label="Stop this thread"
        className={cn(
          "h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-[12px]",
          // on a sheet it wears what the sheet's own choices wear
          onSheet &&
            "bg-background px-3 hover:bg-background/60 dark:hover:bg-background/60",
        )}
      >
        {!stopping && <Square className="size-2.5 fill-current" />}
        Stop
      </Button>
    ) : null;

  if (question) {
    const options = question.options ?? [];
    const text = question.text;
    return (
      <Sheet className={className}>
        <SheetHead bot={faceOf(recipientName)} word="Question">
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {questions.length > 1 && (
              <span className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous question"
                  disabled={busy || questionIndex === 0}
                  onClick={() => setSelected(questions[questionIndex - 1].id)}
                >
                  <ChevronLeft />
                </Button>
                <span
                  className="font-mono text-[10px] text-muted-foreground tabular-nums"
                  aria-live="polite"
                >
                  {questionIndex + 1} / {questions.length}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next question"
                  disabled={busy || questionIndex === questions.length - 1}
                  onClick={() => setSelected(questions[questionIndex + 1].id)}
                >
                  <ChevronRight />
                </Button>
              </span>
            )}
            {stopButton(true)}
          </span>
        </SheetHead>
        {text && (
          <div className="max-h-[min(14rem,30vh)] min-w-0 overflow-y-auto overscroll-contain pr-1.5">
            <Markdown className="min-w-0 text-[13px] leading-snug wrap-anywhere break-keep [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              {text}
            </Markdown>
          </div>
        )}
        {options.length > 0 && (
          <Choices
            options={options}
            picked={picked}
            busy={busy}
            onChoose={choose}
          />
        )}
        <SignInAsk bot={recipientName} onAllowed={send} />
        <DraftComposer
          key={JSON.stringify([thread.id, recipientName, question.id])}
          threadId={thread.id}
          recipient={recipientName}
          draftKey={question.id}
          send={send}
          busy={busy}
          placeholder={
            options.length ? "Or write your own answer…" : "Your answer…"
          }
          label={`Answer for ${recipientName}`}
        />
      </Sheet>
    );
  }

  if (paused) {
    return (
      <Sheet className={className}>
        <SheetHead bot={faceOf(thread.bot)} word="Paused">
          <span className="ml-auto flex shrink-0">{stopButton(true)}</span>
        </SheetHead>
        {asking?.question && (
          <FoldedText
            text={asking.question}
            subject="message"
            clamp="line-clamp-3"
            tall="max-h-40"
          />
        )}
        <Choices
          options={asking?.options.length ? asking.options : [THREAD_CONTINUE]}
          picked={picked}
          busy={busy}
          onChoose={choose}
        />
        <DraftComposer
          key={JSON.stringify([thread.id, recipientName, "paused"])}
          threadId={thread.id}
          recipient={recipientName}
          send={send}
          busy={busy}
          placeholder="Or put it another way…"
          label={`Message for ${recipientName}`}
        />
      </Sheet>
    );
  }

  if (onStep && !stepping) {
    return (
      <div
        className={cn(
          "flex min-w-0 flex-col rounded-2xl bg-muted/40 ring-1 ring-border/50",
          className,
        )}
      >
        {/* Words stepped in with sit here, registered, until the bot's next step
            takes them; only then do they join the conversation. They wait on the
            bot, not on the user, so they take no amber: a loader, and a line that
            shines like everything still moving. */}
        {waiting.map((note) => (
          <div
            key={note.id}
            className="flex items-start gap-2 border-border/60 border-b py-2.5 pr-1.5 pl-3.5"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] leading-4">
                <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                <ShinyText
                  text={`Step-in · waits for ${note.bot}'s next step`}
                  speed={2.2}
                  className="min-w-0 truncate"
                />
              </p>
              <p className="whitespace-pre-wrap break-keep wrap-anywhere text-[13px] leading-snug">
                {note.text}
              </p>
            </div>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={withdrawing}
              onClick={() => withdraw(thread.id, note.id)}
              aria-label="Take it back"
              className="shrink-0 text-muted-foreground/60 hover:text-foreground"
            >
              <X />
            </Button>
          </div>
        ))}
        <div className="flex min-w-0 items-center gap-2 py-1.5 pr-1.5 pl-3.5">
          {/* The job is moving while this line is up, so the line moves too. */}
          <ShinyText
            text={`${active} · Working`}
            speed={2.4}
            className="min-w-0 flex-1 truncate text-[12.5px] leading-5 break-keep"
          />
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
          {stopButton()}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {/* Nothing of this bot's is moving, so the line is still: no loader, no shine.
          The job goes on without it, so the stop stays within reach. */}
      {idle && (
        <div className="flex min-w-0 items-center gap-2 pr-1.5 pl-3.5">
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] leading-5">
            {/* This bot is on no step, so its own half does not shine; whoever holds
                the job up still does, as every line that is still moving does. */}
            <span className="shrink-0 text-muted-foreground">
              {recipientName} is idle
            </span>
            {working.length > 0 && (
              <>
                <span className="shrink-0 text-muted-foreground/50">·</span>
                <ShinyText
                  text={`${working.join(", ")} working`}
                  speed={2.4}
                  className="min-w-0 truncate"
                />
              </>
            )}
          </p>
          <span className="h-4 w-px shrink-0 bg-border" />
          {stopButton()}
        </div>
      )}
      <DraftComposer
        key={JSON.stringify([thread.id, recipientName])}
        threadId={thread.id}
        recipient={recipientName}
        send={send}
        busy={busy}
        // The box appears only after Step in; focus it.
        autoFocus={onStep}
        onEscape={onStep ? () => setStepping(false) : undefined}
        placeholder={
          onStep
            ? `What's off? ${recipientName} reads this before its next step`
            : idle
              ? `Anything for ${recipientName}? It starts again as soon as you send`
              : "Anything more? It picks up where it left off"
        }
        label={`Message for ${recipientName}`}
        className="rounded-2xl bg-background py-1.5 pr-1.5 pl-3.5 ring-1 ring-border/80 transition-shadow focus-within:ring-ring/60"
        leading={
          participants.length > 1 ? (
            <RecipientPicker
              current={faceOf(recipientName)}
              bots={participants.map((participant) => faceOf(participant.bot))}
              disabled={busy}
              onPick={(bot) => {
                threadDrafts.select(thread.id, bot);
                setRecipient(bot);
              }}
            />
          ) : null
        }
        trailing={
          onStep ? (
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
          ) : null
        }
      />
      {relayed && (
        <p className="min-w-0 truncate px-1 text-xs text-muted-foreground">
          {recipientName}&rsquo;s answer goes back to {thread.bot}
        </p>
      )}
      {!!queued && !onStep && (
        <p className="flex min-w-0 items-center gap-2 px-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 shrink-0 animate-spin" />
          <span className="truncate">Sending to {queued}</span>
        </p>
      )}
    </div>
  );
}

/** The one surface a question or a pause waits on. No border, so the composer on it is never a box in a box. */
function Sheet({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2.5 rounded-[18px] bg-muted py-2 pr-2 pl-3.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Who is waiting and on what: the bot's face and one amber word. */
function SheetHead({
  bot,
  word,
  children,
}: {
  bot: BotRef;
  word: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-7 min-w-0 items-center gap-1.5">
      <span title={bot.name} className="shrink-0 leading-none">
        <Face bot={bot} size={16} />
      </span>
      <span
        className={cn(
          "truncate text-[12px] leading-4 font-medium",
          WAITING_INK,
        )}
      >
        {word}
      </span>
      {children}
    </div>
  );
}

/** Offered answers as chips; one being sent trades its icon for the loader. */
function Choices({
  options,
  picked,
  busy,
  onChoose,
}: {
  options: string[];
  picked: string | null;
  busy: boolean;
  onChoose: (option: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant="ghost"
          loading={picked === option}
          disabled={busy}
          onClick={() => onChoose(option)}
          className="h-7 gap-1.5 rounded-full bg-background px-3 text-[12.5px] hover:bg-background/60 dark:hover:bg-background/60"
        >
          {option === THREAD_CONTINUE && picked !== option && (
            <ChevronsRight className="size-3.5 text-muted-foreground" />
          )}
          {option}
        </Button>
      ))}
    </div>
  );
}

/**
 * One draft and the line it is typed on, mounted per thread, recipient and
 * question (the caller's key) so a late answer cannot clear another question's
 * text. Enter sends and Shift+Enter breaks a line.
 */
function DraftComposer({
  threadId,
  recipient,
  draftKey,
  send,
  busy,
  placeholder,
  label,
  autoFocus = false,
  onEscape,
  leading,
  trailing,
  className,
}: {
  threadId: string;
  recipient: string;
  draftKey?: string;
  send: (text: string) => Promise<boolean>;
  busy: boolean;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
  onEscape?: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  const [draft, setDraft] = useState(() =>
    threadDrafts.get(threadId, recipient, draftKey),
  );
  const [sending, setSending] = useState(false);
  const write = (text: string) => {
    setDraft(text);
    threadDrafts.set(threadId, recipient, text, draftKey);
  };
  // Files go with the words as paths (given-files); what is dropped on the room is this thread's
  const given = useGivenFiles();
  const picker = useRef<HTMLInputElement>(null);
  const { take } = given;
  useEffect(() => roomDrop.claim((files) => void take(files)), [take]);
  const ready = Boolean(draft.trim()) && !busy && !given.arriving;
  const submit = async () => {
    if (!ready) return;
    setSending(true);
    // On failure the draft stays; the hook already toasted.
    if (await send(given.withPaths(draft))) {
      write("");
      given.clear();
    }
    setSending(false);
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className={cn("flex min-w-0 flex-wrap items-end gap-1", className)}
    >
      {given.files.length > 0 && (
        <GivenFiles
          dense
          files={given.files}
          onRemove={given.remove}
          className="w-full pb-1"
        />
      )}
      {leading}
      <Textarea
        value={draft}
        rows={1}
        disabled={busy}
        autoFocus={autoFocus}
        onChange={(event) => write(event.target.value)}
        onPaste={(event) => {
          const pasted = [...event.clipboardData.files];
          if (!pasted.length) return;
          event.preventDefault();
          void take(pasted);
        }}
        onKeyDown={(event) => {
          // During IME composition the keys belong to the character being made: Enter
          // confirms it and Esc drops it.
          const midWord = composing(event);
          if (event.key === "Escape" && onEscape && !midWord) {
            // taken here, so the same key does not also close the room around it
            event.preventDefault();
            onEscape();
            return;
          }
          if (event.key !== "Enter" || event.shiftKey || midWord) return;
          event.preventDefault();
          void submit();
        }}
        placeholder={placeholder}
        aria-label={label}
        className="max-h-32 min-h-0 min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-1 text-[13px] leading-5 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          void take([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={busy}
        aria-label="Add files"
        onClick={() => picker.current?.click()}
        className="rounded-full text-muted-foreground"
      >
        <Paperclip />
      </Button>
      {trailing}
      <Button
        type="submit"
        size="icon-sm"
        variant={ready ? "default" : "ghost"}
        disabled={!ready}
        aria-label="Send"
        className="rounded-full"
      >
        {sending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
      </Button>
    </form>
  );
}

/**
 * Who a message goes to when several bots share the room: the same mention the
 * thread draws at the head of a message, opening to the others.
 */
function RecipientPicker({
  current,
  bots,
  disabled,
  onPick,
}: {
  current: BotRef;
  bots: BotRef[];
  disabled: boolean;
  onPick: (bot: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            aria-label={`Message ${current.name}; choose another bot`}
            className="mt-1 inline-flex h-5 shrink-0 items-center gap-1 self-start rounded-full bg-muted pr-1.5 pl-[3px] text-[12px] leading-none font-medium outline-none transition-colors hover:bg-muted-foreground/15 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          />
        }
      >
        <span className="pl-1 text-muted-foreground">To</span>
        <Face bot={current} size={14} />
        <span className="max-w-32 truncate">{current.name}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          {bots.map((bot) => (
            <DropdownMenuItem key={bot.name} onClick={() => onPick(bot.name)}>
              <Face bot={bot} size={16} />
              {bot.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Face({ bot, size }: { bot: BotRef; size: number }) {
  return (
    <BotMark
      size={size}
      seed={bot.name}
      color={bot.icon?.color}
      shape={bot.icon?.shape}
      outline={bot.icon?.outline}
      paint={bot.icon?.paint}
      notify={false}
      className="shrink-0"
    />
  );
}

/** The one path for answering a thread, shared with inbox rows; announces to the call once (screenActs). */
export function useAnswerThread() {
  const [answer, answering] = useServerAction(answerThreadAction, {
    onOk: () => revalidate(queryKey.threads),
  });

  /** True once sent. Failures are already toasted by the hook. */
  const send = async (
    thread: { id: string; label: string },
    text: string,
    recipient?: string,
    replyTo?: string,
  ): Promise<boolean> => {
    const said = text.trim();
    if (!said) return false;
    try {
      const done = await answer(thread.id, said, recipient, replyTo);
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
