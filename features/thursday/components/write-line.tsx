"use client";

import {
  ArrowDownToLine,
  ArrowUp,
  ChevronDown,
  Paperclip,
  RotateCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { ModelPicker } from "@/features/ai/components/model-picker";
import {
  TEXT_MODEL_PROVIDERS,
  type TextModelRef,
} from "@/features/ai/model.schema";
import { startThreadAction } from "@/features/bot/bot.action";
import { type Bot, DEFAULT_BOT } from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import { ROOM_THURSDAY } from "@/features/bot/room.schema";
import {
  type BotRef,
  roomOpens,
  screenActs,
  useRoomOpen,
  writeLine,
} from "@/features/bot/thread.store";
import { openSettings } from "@/features/settings/settings.store";
import { useCallHeld } from "@/features/thursday/call-signal";
import { useThursdayStore } from "@/features/thursday/thursday.store";
import type { TextCall } from "@/features/thursday/use-text-call";
import {
  GivenFiles,
  roomDrop,
  useGivenFiles,
} from "@/features/workspace/components/given-files";
import { useEscape, windowKey } from "@/hooks/use-hotkey";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";
import { ThursdayMark } from "./thursday-mark";

/**
 * The write line: one bar at the foot of the screen for whatever is typed or handed
 * over rather than said. It is not there until asked for — the pill's "+", the `/` key,
 * or a file dragged onto the window — and it holds who it is for, the words, and the
 * files. Files are kept in the workspace the moment they arrive (given-files), so they
 * wait here by path until words go with them. Sent to a bot, the room opens on the
 * thread it started. Sent to Thursday — who it opens on until someone else is picked —
 * it becomes a call in writing (use-text-call): the line stays up as that call's way
 * in, says what the call runs on, and Esc ends the call rather than closing the line. A
 * bot can still be picked during it, for one message; then the line is hers again.
 */

/** What the line needs of a call in writing, and what such a call would run on. */
export type WrittenCall = Pick<
  TextCall,
  "on" | "busy" | "error" | "say" | "again" | "end"
> & {
  /**
   * What it would run on: the model picked here, else the rule's (the plan, else the
   * OpenAI key, on the call's backend model). Null when nothing is picked and neither is
   * set: the line says what to set instead of sending.
   */
  runsOn: TextModelRef | null;
  /** Where a turn that broke can be sent again: the OpenAI key, when it is set and is not what broke. */
  fallback: TextModelRef | null;
};

/** Who the line writes to: a bot by its name, or her. No bot can take her name (bot.schema). */
type Recipient = BotRef & { description: string };
const HER: Recipient = {
  name: ROOM_THURSDAY,
  description: "A call in writing — she answers here",
};

/** Where the last pick is remembered, so the line opens on whoever was written to last. */
const LAST_TO = "thursday.write.to";

const mentionOf = (draft: string) => /^@(\S*)$/.exec(draft.split(/\s/, 1)[0]);

/** How long the line takes to go, so it can be watched leaving. */
const LEAVE_MS = 200;

export function WriteLine({
  written,
  onCall = false,
}: {
  written: WrittenCall | null;
  /** A spoken call is on: she is told of a file the moment it is put down (screenActs). */
  onCall?: boolean;
}) {
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  // A fresh install has no rows and still has a worker (bot.schema DEFAULT_BOT)
  const roster = useMemo(
    (): Recipient[] => [
      ...(written ? [HER] : []),
      ...(bots?.length
        ? bots
            .filter((bot) => !bot.disabled)
            .map(({ name, icon, description }) => ({ name, icon, description }))
        : [DEFAULT_BOT]),
    ],
    [bots, written],
  );

  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toName, setToName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const spoken = useRef(onCall);
  spoken.current = onCall;
  const given = useGivenFiles({
    // On a call the file is a fact she is given as it lands; what it is for is said aloud
    onKept: (paths) => {
      if (!spoken.current) return undefined;
      screenActs.announce({ kind: "gave", paths });
      return "she knows it is here";
    },
  });
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setToName(window.localStorage.getItem(LAST_TO));
    } catch {
      // storage may be blocked; the first bot is as good a start
    }
  }, []);
  const calling = Boolean(written?.on);
  // While a call in writing is on the line is hers, until a bot is picked for one message:
  // that pick lasts for the message and is not what the line opens on next time
  const [besides, setBesides] = useState<string | null>(null);
  useEffect(() => {
    if (!calling) setBesides(null);
  }, [calling]);
  const to = calling
    ? (roster.find((bot) => bot.name === besides) ?? HER)
    : (roster.find((bot) => bot.name === toName) ?? roster[0]);
  const toHer = to === HER;

  // The first run is drawn over this screen: nothing opens behind it (call-signal)
  const held = useCallHeld();
  const show = useCallback(() => {
    if (held) return;
    setOpen(true);
    requestAnimationFrame(() => field.current?.focus());
  }, [held]);

  // The three ways in all ask through the store, so the room hears it and folds: the line
  // and the open room never share the screen (thread.store roomOpen)
  const room = useRoomOpen();
  const { take: keep } = given;
  const take = useCallback(
    (list: File[]) => {
      writeLine.open();
      void keep(list);
    },
    [keep],
  );

  // `/` is the window's unless something is being typed into, and an open thread's:
  // there the key goes to that thread's own message box (bot-room)
  useEffect(() => writeLine.subscribe(show), [show]);
  useEffect(() => {
    if (room === "thread") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (!windowKey(event)) return;
      event.preventDefault();
      writeLine.open();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [room]);
  useEffect(() => {
    if (held) return;
    const carriesFiles = (event: DragEvent) =>
      Boolean(event.dataTransfer?.types.includes("Files"));
    const over = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    // leaving the window, not moving between two elements inside it
    const leave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      const dropped = [...(event.dataTransfer?.files ?? [])];
      // a thread open in the room takes what lands on the room
      if (!roomDrop.offer(event.target, dropped)) take(dropped);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [take, held]);

  const [start, starting] = useServerAction(startThreadAction, {
    onOk: ({ id }) => {
      revalidate(queryKey.threads);
      setDraft("");
      given.clear();
      setOpen(false);
      // one message to a bot, then the line is hers again
      setBesides(null);
      roomOpens.open(id);
    },
  });

  /**
   * The list a typed `@` opens: where the arrow keys stand in it, and whether Esc has left
   * the typed word alone so it can be sent as words.
   */
  const [cursor, setCursor] = useState(0);
  const [asWords, setAsWords] = useState(false);

  const pick = (bot: BotRef) => {
    setPicking(false);
    // typed as a mention, the pick replaces it
    setDraft((text) => (mentionOf(text) ? text.replace(/^@\S*\s?/, "") : text));
    setCursor(0);
    field.current?.focus();
    if (calling) return setBesides(bot.name === HER.name ? null : bot.name);
    setToName(bot.name);
    try {
      window.localStorage.setItem(LAST_TO, bot.name);
    } catch {
      // remembered for this visit only
    }
  };

  const mention = asWords ? null : mentionOf(draft);
  const matches = mention
    ? roster.filter((bot) =>
        bot.name.toLowerCase().startsWith(mention[1].toLowerCase()),
      )
    : roster;
  // Taken modulo the list, which a keystroke shortens and the roster can too
  const at = matches.length ? cursor % matches.length : 0;
  const walk = (by: number) =>
    setCursor((was) =>
      matches.length ? (was + by + matches.length) % matches.length : 0,
    );
  const [reaching, setReaching] = useState(false);
  // Words to her while she answers join that answer (use-text-call), so they never wait on it
  const waiting = starting || reaching;
  const ready =
    Boolean(draft.trim()) &&
    !mention &&
    !given.arriving &&
    !waiting &&
    !(toHer && !written?.runsOn);

  const send = () => {
    if (!ready) return;
    // A path in the words is how a file is handed over, and how the room draws it
    const words = given.withPaths(draft);
    if (!toHer) return void start(to.name, words);
    if (!written) return;
    setReaching(true);
    written
      .say(words)
      .then(() => {
        setDraft("");
        given.clear();
      })
      // the action has already said why; the words stay to be sent again
      .catch(() => {})
      .finally(() => setReaching(false));
  };

  /**
   * Esc. A bot picked during her call: it gives the line back to her. Hers, it ends the
   * call in writing, and the line goes with it.
   */
  const leave = () => {
    if (calling && !toHer) return setBesides(null);
    if (calling) written?.end();
    setOpen(false);
  };
  // A spoken call that picks up has the screen: a line left open with nothing in it steps
  // aside, and one holding words or files stays, since those are the user's
  const wasOnCall = useRef(onCall);
  useEffect(() => {
    const pickedUp = onCall && !wasOnCall.current;
    wasOnCall.current = onCall;
    if (pickedUp && !draft.trim() && !given.files.length) setOpen(false);
  }, [onCall, draft, given.files.length]);

  // Put away while the room stands open and back as it was once it folds, the words in it
  // and a call in writing both kept: the room has the foot, and one message box is enough.
  // The pill's card would grow where the line stands, so the pill is told (room-pill)
  const up = (open || dragging || calling) && !room;
  // Esc is the line's while it is up, not the field's: the field is disabled while words are
  // on their way and the browser drops its focus then, which is also when a call that broke
  // has to be left.
  useEscape(up, leave);
  // and the focus comes back once they have gone, or failed to
  const sending = starting || reaching;
  useEffect(() => {
    if (up && !sending) field.current?.focus();
  }, [up, sending]);
  useEffect(() => {
    writeLine.shown(up);
    return () => writeLine.shown(false);
  }, [up]);
  // Put away with her call still on, the line cannot say so itself: the room does (bot-room)
  const waits = calling && Boolean(room);
  useEffect(() => {
    writeLine.waits(waits);
    return () => writeLine.waits(false);
  }, [waits]);

  const [standing, setStanding] = useState(up);
  useEffect(() => {
    if (up) {
      setStanding(true);
      return;
    }
    const leaving = setTimeout(() => setStanding(false), LEAVE_MS);
    return () => clearTimeout(leaving);
  }, [up]);

  // The line outlives `up` by as long as it takes to go: without that it is there and then it
  // is not, which is what made the key read as a switch rather than as something opening.
  if (!standing) return null;

  return (
    <>
      {dragging && (
        <div
          aria-hidden
          // over everything the foot holds: it is drawn after the corners and before the line
          className="pointer-events-none fixed inset-0 bg-background/60"
        >
          <div className="absolute inset-3 rounded-3xl border-[1.5px] border-dashed border-foreground/30" />
        </div>
      )}
      {/* The row above the rail, in the middle of the window: the pill has the rail to
          itself and the two ends of this row take equal tracks, so the line stands under
          her face whatever the pill is saying (thursday CallFoot). */}
      <div className="col-start-2 row-start-1 flex min-w-0 items-end justify-center">
        <div
          className={cn(
            "flex w-160 max-w-full flex-col gap-2",
            up
              ? "pointer-events-auto animate-in duration-200 fade-in slide-in-from-bottom-2"
              : "pointer-events-none animate-out duration-200 fade-out fill-mode-forwards slide-out-to-bottom-2",
          )}
        >
          <div className="flex flex-col gap-2 rounded-[26px] bg-background p-2 shadow-[0_22px_44px_-20px_rgb(0_0_0/0.22)] ring-1 ring-border">
            {(given.files.length > 0 || dragging) && (
              <GivenFiles
                files={given.files}
                onRemove={given.remove}
                className="px-0.5 pt-0.5"
              >
                {dragging && (
                  <span className="flex h-13 items-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-foreground/60 px-4 text-[13px]">
                    <ArrowDownToLine className="size-4" />
                    Let go — it waits here
                  </span>
                )}
              </GivenFiles>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
              className="flex items-end gap-2"
            >
              <Popover
                open={picking || Boolean(mention)}
                onOpenChange={setPicking}
              >
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`To ${to.name}. Choose someone else`}
                      className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-muted pr-2.5 pl-1.5 text-[13px] font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                    />
                  }
                >
                  <Mark bot={to} size={22} />
                  {to.name}
                  <ChevronDown className="size-3 text-muted-foreground" />
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  sideOffset={14}
                  // typing a mention keeps the caret where it is
                  initialFocus={mention ? false : undefined}
                  className="w-90 gap-0 rounded-[18px] p-1.5"
                >
                  <p className="px-2.5 pt-1.5 pb-1 font-mono text-[10px] text-muted-foreground">
                    to
                  </p>
                  {matches.map((bot, index) => (
                    <button
                      key={bot.name}
                      type="button"
                      onClick={() => pick(bot)}
                      className={cn(
                        "flex h-11.5 w-full items-center gap-2.5 rounded-xl px-2.5 text-left outline-none hover:bg-muted focus-visible:bg-muted",
                        (mention ? index === at : bot.name === to.name) &&
                          "bg-muted",
                      )}
                    >
                      <Mark bot={bot} size={24} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[13.5px] leading-4.5 font-medium">
                          {bot.name}
                        </span>
                        <span className="truncate text-xs leading-4 text-muted-foreground">
                          {bot.description}
                        </span>
                      </span>
                    </button>
                  ))}
                  {matches.length === 0 && (
                    <p className="px-2.5 py-2 text-[13px] text-muted-foreground">
                      Nobody by that name.
                    </p>
                  )}
                </PopoverContent>
              </Popover>

              <Textarea
                ref={field}
                value={draft}
                rows={1}
                disabled={starting || reaching}
                onChange={(event) => {
                  const next = event.target.value;
                  setDraft(next);
                  setCursor(0);
                  // once left alone the word stays words, until it is no longer one
                  if (!mentionOf(next)) setAsWords(false);
                }}
                onPaste={(event) => {
                  const pasted = [...event.clipboardData.files];
                  if (!pasted.length) return;
                  event.preventDefault();
                  take(pasted);
                }}
                // During IME composition the keys belong to the character being made:
                // Enter confirms it and the arrows walk its own candidates
                // (keyCode 229 for browsers without isComposing).
                onKeyDown={(event) => {
                  const composing =
                    event.nativeEvent.isComposing || event.keyCode === 229;
                  if (event.key === "Escape" && !composing) {
                    event.preventDefault();
                    // a typed name is left alone first: the words and the line stay
                    if (mention) return setAsWords(true);
                    return leave();
                  }
                  const arrow =
                    event.key === "ArrowDown" || event.key === "ArrowUp";
                  if (mention && arrow && !composing) {
                    event.preventDefault();
                    return walk(event.key === "ArrowDown" ? 1 : -1);
                  }
                  if (event.key !== "Enter" || event.shiftKey || composing)
                    return;
                  event.preventDefault();
                  if (mention) {
                    if (matches[at]) pick(matches[at]);
                    return;
                  }
                  send();
                }}
                placeholder={
                  given.files.length
                    ? "Say what to do with them"
                    : calling && toHer
                      ? "Write back"
                      : toHer
                        ? "Write to her instead of calling"
                        : `Say the whole job — ${to.name} cannot hear the call`
                }
                aria-label={`Message for ${to.name}`}
                className="max-h-36 min-h-9 flex-1 resize-none border-0 bg-transparent px-0 py-1.5 text-[15px] leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
              />

              <input
                ref={picker}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  take([...(event.target.files ?? [])]);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                aria-label="Add files"
                onClick={() => picker.current?.click()}
                className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Paperclip className="size-4" />
              </button>
              <button
                type="submit"
                aria-label="Send"
                disabled={!ready}
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-full outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  // Black, because blue is what is set and black is what to press — and the
                  // one blue at this end of the screen is the orb on the button that opened
                  // this line (write-orb), which would be two of them.
                  ready
                    ? "bg-primary text-primary-foreground hover:bg-primary/85"
                    : "bg-muted text-muted-foreground/40",
                )}
              >
                {waiting ? (
                  <span className="size-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </button>
            </form>
          </div>

          {toHer && written?.error && (
            <p className="px-4 text-center text-xs leading-5 text-destructive">
              {written.error}
            </p>
          )}
          {/* The way on from a turn that broke: the same words again, and where keys are set.
              Never by itself: what a turn costs changes with what it runs on, so they press it */}
          {toHer && written?.error && (
            <div className="flex items-center justify-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="brand"
                disabled={written.busy}
                onClick={() => {
                  if (written.fallback)
                    useThursdayStore
                      .getState()
                      .patch({ textModel: written.fallback });
                  written.again();
                }}
              >
                <RotateCw />
                {written.fallback
                  ? "Send it again on your OpenAI key"
                  : "Send it again"}
              </Button>
              <span className="font-mono text-[10.5px] text-muted-foreground/70">
                <KeysLink>API keys</KeysLink>
              </span>
            </div>
          )}
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 font-mono text-[10.5px] text-muted-foreground/70">
            {mention ? (
              // an open list has the keys: nothing is sent or left while it is up
              <>
                <Key>↑↓</Key> walk
                <Dot />
                <Key>Enter</Key> take
                <Dot />
                <Key>Esc</Key> close the list
              </>
            ) : (
              <>
                {toHer && !written?.runsOn ? (
                  // nothing to run on: what to set is the only thing worth saying
                  <RunsOn runsOn={null} />
                ) : (
                  <>
                    <Key>Enter</Key> send
                    <Dot />
                    <Key>@</Key> {toHer ? "a bot" : "pick a bot"}
                    {toHer && (
                      <>
                        <Dot />
                        <RunsOn runsOn={written?.runsOn ?? null} />
                      </>
                    )}
                  </>
                )}
                <Dot />
                <Key>Esc</Key>{" "}
                {calling ? (toHer ? "to end" : "back to her") : "close"}
              </>
            )}
          </p>
        </div>
      </div>
    </>
  );
}

/**
 * What a call in writing runs on, said before the first word is sent: the plan when a GPT
 * subscription is signed in, else the OpenAI key with the way to the plan, else what to set.
 */
function RunsOn({ runsOn }: { runsOn: TextModelRef | null }) {
  const plan = TEXT_MODEL_PROVIDERS.chatgpt.label;
  const pick = (
    <ModelPicker
      compact
      provider={runsOn?.provider ?? null}
      model={runsOn?.model ?? ""}
      unset="pick a model"
      onChange={(textModel) => useThursdayStore.getState().patch({ textModel })}
    />
  );
  if (runsOn)
    return (
      <>
        <span>runs on</span>
        {pick}
      </>
    );
  return (
    <>
      <span>Writing to her needs a {plan}, an OpenAI key, or</span>
      {pick}
      <Dot />
      <KeysLink>API keys</KeysLink>
    </>
  );
}

const Dot = () => <span className="text-muted-foreground/40">·</span>;

/** The way to Settings › API keys, as words in the line's small print. */
function KeysLink({ children }: { children: string }) {
  return (
    <button
      type="button"
      onClick={() => openSettings("keys")}
      className="rounded-sm text-foreground/80 underline underline-offset-3 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </button>
  );
}

function Mark({ bot, size }: { bot: BotRef; size: number }) {
  if (bot === HER) return <ThursdayMark size={size} className="shrink-0" />;
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

function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground/80 shadow-[0_1px_0_var(--border)]">
      {children}
    </kbd>
  );
}
