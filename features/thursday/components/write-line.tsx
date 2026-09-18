"use client";

import {
  ArrowDownToLine,
  ArrowUp,
  ChevronDown,
  Paperclip,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { GIVEN_FILES } from "@/config";
import { startThreadAction } from "@/features/bot/bot.action";
import { type Bot, DEFAULT_BOT } from "@/features/bot/bot.schema";
import { BotMark } from "@/features/bot/components/bot-mark";
import {
  type BotRef,
  roomOpens,
  useRoomOpen,
  writeLine,
} from "@/features/bot/thread.store";
import { FileThumb } from "@/features/workspace/components/file-thumb";
import { giveFilesAction } from "@/features/workspace/workspace.action";
import { capturesKeys } from "@/hooks/use-hotkey";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";

/**
 * The write line: one bar at the foot of the screen for whatever is typed or handed
 * over rather than said. It is not there until asked for — the pill's "+", the `/` key,
 * or a file dragged onto the window — and it holds who it is for, the words, and the
 * files. Files are kept in the workspace the moment they arrive (GIVEN_FILES), so they
 * wait here by path until words go with them. Sent to a bot, the room opens on the
 * thread it started.
 */

/** Where the last pick is remembered, so the line opens on whoever was written to last. */
const LAST_TO = "thursday.write.to";

type Given = {
  key: string;
  name: string;
  bytes: number;
  /** Workspace-relative once it is kept; null while it is on its way. */
  path: string | null;
};

const mentionOf = (draft: string) => /^@(\S*)$/.exec(draft.split(/\s/, 1)[0]);

export function WriteLine() {
  const { data: bots } = useServerRoute<Bot[]>(queryKey.bot);
  // A fresh install has no rows and still has a worker (bot.schema DEFAULT_BOT)
  const roster = useMemo(
    (): (BotRef & { description: string })[] =>
      bots?.length
        ? bots
            .filter((bot) => !bot.disabled)
            .map(({ name, icon, description }) => ({ name, icon, description }))
        : [DEFAULT_BOT],
    [bots],
  );

  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toName, setToName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Given[]>([]);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const aside = useRoomOpen();

  useEffect(() => {
    try {
      setToName(window.localStorage.getItem(LAST_TO));
    } catch {
      // storage may be blocked; the first bot is as good a start
    }
  }, []);
  const to = roster.find((bot) => bot.name === toName) ?? roster[0];

  const show = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => field.current?.focus());
  }, []);

  const [give] = useServerAction(giveFilesAction);
  const take = useCallback(
    async (list: File[]) => {
      const room = GIVEN_FILES.perMessage - files.length;
      if (list.length > room)
        toast.add({
          type: "error",
          title: `At most ${GIVEN_FILES.perMessage} files at a time.`,
        });
      const taken = list.slice(0, Math.max(0, room));
      if (!taken.length) return;
      show();
      const batch = taken.map((file) => ({
        key: crypto.randomUUID(),
        name: file.name,
        bytes: file.size,
        path: null,
      }));
      setFiles((all) => [...all, ...batch]);
      const form = new FormData();
      for (const file of taken) form.append("file", file);
      try {
        const paths = await give(form);
        setFiles((all) =>
          all.map((one) => {
            const at = batch.findIndex((mine) => mine.key === one.key);
            return at < 0 ? one : { ...one, path: paths[at] ?? null };
          }),
        );
      } catch {
        // the hook has already said why; what did not arrive does not wait here
        setFiles((all) =>
          all.filter((one) => !batch.some((mine) => mine.key === one.key)),
        );
      }
    },
    [files.length, give, show],
  );

  // The three ways in. `/` is the window's unless something is being typed into
  useEffect(() => writeLine.subscribe(show), [show]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (event.defaultPrevented || capturesKeys(event.target)) return;
      if ((event.target as HTMLElement | null)?.closest?.('[role="dialog"]'))
        return;
      event.preventDefault();
      show();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [show]);
  useEffect(() => {
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
      void take([...(event.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [take]);

  const [start, starting] = useServerAction(startThreadAction, {
    onOk: ({ id }) => {
      revalidate(queryKey.threads);
      setDraft("");
      setFiles([]);
      setOpen(false);
      roomOpens.open(id);
    },
  });

  const pick = (bot: BotRef) => {
    setToName(bot.name);
    setPicking(false);
    // typed as a mention, the pick replaces it
    setDraft((text) => (mentionOf(text) ? text.replace(/^@\S*\s?/, "") : text));
    try {
      window.localStorage.setItem(LAST_TO, bot.name);
    } catch {
      // remembered for this visit only
    }
    field.current?.focus();
  };

  const mention = mentionOf(draft);
  const matches = mention
    ? roster.filter((bot) =>
        bot.name.toLowerCase().startsWith(mention[1].toLowerCase()),
      )
    : roster;
  const arriving = files.some((file) => file.path === null);
  const ready = Boolean(draft.trim()) && !mention && !arriving && !starting;

  const send = () => {
    if (!ready) return;
    const paths = files.flatMap((file) => file.path ?? []);
    // A path in the words is how a file is handed to a bot, and how the room draws it
    void start(to.name, [draft.trim(), ...paths].join("\n"));
  };

  if (!open && !dragging) return null;

  return (
    <>
      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-20 bg-background/60"
        >
          <div className="absolute inset-3 rounded-3xl border-[1.5px] border-dashed border-brand/55" />
        </div>
      )}
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-7 z-30 flex justify-center px-5 transition-[padding] duration-500 ease-out max-[1100px]:bottom-18",
          // the same step aside the call takes for the open room
          aside && "min-[1180px]:pr-[41.25rem]",
        )}
      >
        <div className="pointer-events-auto flex w-160 max-w-full animate-in flex-col gap-2 fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex flex-col gap-2 rounded-[26px] bg-background p-2 shadow-[0_22px_44px_-20px_rgb(0_0_0/0.22)] ring-1 ring-border">
            {(files.length > 0 || dragging) && (
              <div className="flex flex-wrap gap-1.5 px-0.5 pt-0.5">
                {files.map((file) => (
                  <span
                    key={file.key}
                    className="flex h-13 max-w-64 items-center gap-2.5 rounded-[14px] bg-muted/70 py-1.5 pr-2 pl-1.5"
                  >
                    {file.path ? (
                      <FileThumb
                        path={file.path}
                        bytes={file.bytes}
                        className="size-10 shrink-0 overflow-hidden rounded-[9px] ring-1 ring-foreground/6"
                      />
                    ) : (
                      <span className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-background ring-1 ring-foreground/6">
                        <span className="size-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[12.5px] leading-4.5">
                        {file.name}
                      </span>
                      <span className="font-mono text-[10px] leading-3.5 text-muted-foreground">
                        {sizeOf(file.bytes)}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Take ${file.name} out`}
                      onClick={() =>
                        setFiles((all) =>
                          all.filter((one) => one.key !== file.key),
                        )
                      }
                      className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
                {dragging && (
                  <span className="flex h-13 items-center gap-2 rounded-[14px] border-[1.5px] border-dashed border-brand px-4 text-[13px] text-brand">
                    <ArrowDownToLine className="size-4" />
                    Let go — it waits here
                  </span>
                )}
              </div>
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
                  {matches.map((bot) => (
                    <button
                      key={bot.name}
                      type="button"
                      onClick={() => pick(bot)}
                      className={cn(
                        "flex h-11.5 w-full items-center gap-2.5 rounded-xl px-2.5 text-left outline-none hover:bg-muted focus-visible:bg-muted",
                        bot.name === to.name && !mention && "bg-muted",
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
                disabled={starting}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => {
                  const pasted = [...event.clipboardData.files];
                  if (!pasted.length) return;
                  event.preventDefault();
                  void take(pasted);
                }}
                // During IME composition Enter confirms the character, not the message
                // (keyCode 229 for browsers without isComposing).
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                    return;
                  }
                  if (event.key !== "Enter" || event.shiftKey) return;
                  if (event.nativeEvent.isComposing || event.keyCode === 229)
                    return;
                  event.preventDefault();
                  if (mention) {
                    if (matches[0]) pick(matches[0]);
                    return;
                  }
                  send();
                }}
                placeholder={
                  files.length
                    ? "Say what to do with them"
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
                  void take([...(event.target.files ?? [])]);
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
                  "grid size-9 shrink-0 place-items-center rounded-full outline-none transition-colors focus-visible:ring-3 focus-visible:ring-brand/30",
                  ready
                    ? "bg-brand text-brand-foreground hover:bg-brand/85"
                    : "bg-muted text-muted-foreground/40",
                )}
              >
                {starting ? (
                  <span className="size-3.5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </button>
            </form>
          </div>

          <p className="flex items-center justify-center gap-2 font-mono text-[10.5px] text-muted-foreground/70">
            <Key>Enter</Key> send
            <span className="text-muted-foreground/40">·</span>
            <Key>@</Key> pick a bot
            <span className="text-muted-foreground/40">·</span>
            <Key>Esc</Key> close
          </p>
        </div>
      </div>
    </>
  );
}

function Mark({ bot, size }: { bot: BotRef; size: number }) {
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

const sizeOf = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
