"use client";

import { Check, History, Plus, Trash2, Wrench, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/notify";
import ShinyText from "@/components/ui/shiny-text";
import { Swatch } from "@/components/ui/swatch";
import { Textarea } from "@/components/ui/textarea";
import { ModelPicker } from "@/features/ai/components/model-picker";
import type { TextModelProviderId } from "@/features/ai/model.schema";
import {
  createBotAction,
  createSeedBotsAction,
  deleteBotAction,
  updateBotAction,
} from "@/features/bot/bot.action";
import {
  type Bot,
  type BotForm,
  type BotIcon,
  isBudgetAsk,
  MAX_PINNED_TOOLS,
  randomBotIcon,
  type Task,
} from "@/features/bot/bot.schema";
import { BOT_SEEDS, type BotSeed } from "@/features/bot/bot.seed";
import { BotMark } from "@/features/bot/components/bot-mark";
import {
  SettingError,
  SettingPanes,
  SettingRailNote,
  SettingSkeleton,
} from "@/features/settings/components/setting-ui";
import { openSettings } from "@/features/settings/settings.store";
import { useObjectState } from "@/hooks/use-object-state";
import { type DateLike, shortAgo, whenOf } from "@/lib/date-like";
import { COMMON_VALIDATE } from "@/lib/limits";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, formatCount, WAITING_INK } from "@/lib/utils";
import { MARK_PALETTE, MARK_SHAPES, MARK_SYSTEM } from "../mark.const";

/**
 * The bots Thursday hands background work to. Roster on the left, the picked bot's
 * page on the right. Fields save on blur or on pick; only a new bot has a Create button.
 */
export function BotSetting() {
  const { data, isLoading, error } = useServerRoute<Bot[]>(queryKey.bot);
  const bots = data ?? [];
  // First page of history, not the inbox: the inbox keeps only a few finished tasks.
  const { data: history } = useServerRoute<Task[]>(queryKey.taskHistory(null));
  const jobs = history ?? [];
  /** Picked roster entry: a bot name, NEW, or null for the first bot. */
  const [picked, setPicked] = useState<string | null>(null);

  if (isLoading) return <SettingSkeleton />;
  if (error) return <SettingError message={error.message} />;

  const drafting = picked === NEW;
  const have = new Set(bots.map((bot) => bot.name));
  const missing = BOT_SEEDS.filter((seed) => !have.has(seed.name));
  const current =
    drafting || picked === SEEDS
      ? null
      : (bots.find((bot) => bot.name === picked) ?? bots[0] ?? null);

  return (
    <SettingPanes
      footer={picked === SEEDS ? null : <BotRail bot={current} />}
      left={
        <div className="flex flex-col py-2">
          <button
            type="button"
            onClick={() => setPicked(NEW)}
            className={cn(
              "mx-2 mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
              drafting
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Plus className="size-3.5 shrink-0" />
            New bot
          </button>

          {bots.map((bot) => (
            <RosterRow
              key={bot.name}
              bot={bot}
              job={jobs.find((job) => job.bot === bot.name) ?? null}
              active={!drafting && bot.name === current?.name}
              onPick={() => setPicked(bot.name)}
            />
          ))}

          {missing.length > 0 && (
            <SeedEntry
              missing={missing}
              active={picked === SEEDS}
              onPick={() => setPicked(SEEDS)}
            />
          )}
        </div>
      }
      right={
        picked === SEEDS ? (
          <SeedPackage have={have} onDone={(name) => setPicked(name)} />
        ) : drafting ? (
          <BotPage
            key="new"
            jobs={[]}
            onDone={(name) => setPicked(name)}
            onCancel={() => setPicked(null)}
          />
        ) : current ? (
          // Keyed by name so field state does not carry over to the next bot.
          <BotPage
            key={current.name}
            bot={current}
            jobs={jobs
              .filter((job) => job.bot === current.name)
              .slice(0, RECENT)}
            onDone={() => setPicked(null)}
          />
        ) : (
          <div className="space-y-4 p-8">
            <p className="text-sm leading-relaxed text-muted-foreground">
              The agent talks; bots do the rest — search the web, draft a reply,
              check a schedule. Give one a job and a model, and work gets handed
              over mid-call while the conversation keeps going.
            </p>
            <Button variant="outline" onClick={() => setPicked(NEW)}>
              <Plus />
              New bot
            </Button>
          </div>
        )
      }
    />
  );
}

/** Roster selections that are not a bot; values no bot name can be. */
const NEW = " new";
const SEEDS = " seeds";

/** Jobs shown under Recent on a bot's page. */
const RECENT = 3;

/** One roster line: face, name, and what the bot is doing now. */
function RosterRow({
  bot,
  job,
  active,
  onPick,
}: {
  bot: Bot;
  /** Latest job if it is on the first history page; `bot.lastJobAt` covers the rest. */
  job: Task | null;
  active: boolean;
  onPick: () => void;
}) {
  const line = liveLine(job, bot.lastJobAt);
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "mx-2 flex items-center gap-2.5 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        active ? "bg-secondary" : "hover:bg-muted/60",
      )}
    >
      <BotMark
        size={32}
        {...markProps(bot.name, bot.icon)}
        state={job?.status === "running" ? "thinking" : "idle"}
        notify={job?.status === "waiting"}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span
          className={cn(
            "block truncate text-[13px]",
            active ? "font-medium" : "text-foreground/90",
          )}
        >
          {bot.name}
        </span>
        {line.shine ? (
          // The colours come from CSS variables so they follow the theme.
          <span
            className={cn(
              "block",
              line.amber
                ? "[--rest:var(--color-amber-700)] [--shine:var(--color-amber-400)] dark:[--rest:var(--color-amber-400)] dark:[--shine:var(--color-amber-100)]"
                : "[--rest:var(--muted-foreground)] [--shine:var(--foreground)]",
            )}
          >
            <ShinyText
              text={line.text}
              speed={2.4}
              color="var(--rest)"
              shineColor="var(--shine)"
              className="truncate font-mono text-[11px] leading-4"
            />
          </span>
        ) : (
          <span className="block truncate font-mono text-[11px] leading-4 text-muted-foreground">
            {line.text}
          </span>
        )}
      </span>
    </button>
  );
}

/** What the bot is doing, most urgent first. A budget stop waits but is not amber (isBudgetAsk). */
function liveLine(
  job: Task | null,
  lastJobAt: Bot["lastJobAt"],
): {
  text: string;
  shine?: boolean;
  amber?: boolean;
} {
  if (!job) {
    if (!lastJobAt) return { text: "idle · no jobs yet" };
    return { text: `idle · last job ${sinceWord(lastJobAt)}` };
  }
  if (job.status === "waiting") {
    return isBudgetAsk(job.ask)
      ? { text: "out of steps" }
      : { text: "waiting on you", shine: true, amber: true };
  }
  if (job.status === "running") {
    return { text: `working · ${job.label}`, shine: true };
  }
  return { text: `idle · last job ${sinceWord(job.updatedAt)}` };
}

/** "just now" or "3h ago". */
function sinceWord(at: DateLike): string {
  const ago = shortAgo(at);
  return ago === "now" ? "just now" : `${ago} ago`;
}

/**
 * The ready-made bots (bot.seed) as one entry rather than three rows.
 *
 * They used to fill an empty roster, which made a roster with nothing in it look
 * full and made the row you clicked create rather than open. Here they sit behind
 * a single line carrying the faces of the ones you do not have, and it is shown
 * only while at least one is still on offer.
 */
function SeedEntry({
  missing,
  active,
  onPick,
}: {
  missing: BotSeed[];
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "mx-2 mt-1 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        active ? "bg-secondary" : "hover:bg-muted/60",
      )}
    >
      <span className="flex shrink-0 items-center">
        {missing.map((seed, index) => (
          <span key={seed.name} className={cn("block", index > 0 && "-ml-1.5")}>
            <BotMark size={22} {...markProps(seed.name, seed.icon)} />
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span
          className={cn(
            "block truncate text-[13px]",
            active ? "font-medium" : "text-foreground/90",
          )}
        >
          Ready-made
        </span>
        <span className="block truncate font-mono text-[10px] leading-4 text-muted-foreground">
          {missing.length === BOT_SEEDS.length
            ? `${missing.length} bots`
            : `${missing.length} left`}
        </span>
      </span>
    </button>
  );
}

/**
 * The package itself: the seeds ticked already, because the package is the
 * recommendation (`BotSeed.recommended`) and unticking is the decision. One
 * already on the roster is locked on and says so — `createBot` would only answer
 * "already exists", which is an error about something this screen already knows.
 *
 * One call creates all of them; `createSeedBotsAction` has always taken an array.
 */
function SeedPackage({
  have,
  onDone,
}: {
  /** Names already on the roster. */
  have: Set<string>;
  onDone: (name: string | null) => void;
}) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const [add, adding] = useServerAction(createSeedBotsAction, {
    onOk: (made) => {
      revalidate(queryKey.bot);
      onDone(made.created[0] ?? null);
    },
  });

  const wanted = BOT_SEEDS.filter(
    (seed) => !have.has(seed.name) && !off.has(seed.name),
  );

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex h-11 shrink-0 items-center border-b border-border/60 px-4 font-mono text-[11px] text-muted-foreground">
        Ready-made
      </div>

      <div className="px-8 pt-7 pb-1">
        <h3 className="text-[17px] font-medium tracking-tight">
          {BOT_SEEDS.length === 1
            ? "One bot comes with her"
            : `${BOT_SEEDS.length === 2 ? "Two" : BOT_SEEDS.length} bots come with her`}
        </h3>
        <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted-foreground break-keep">
          They take the work that would leave the call silent, and report back.
          Untick anything you would rather not have; each runs on the app
          default model until you give it one of its own.
        </p>
      </div>

      <div className="flex flex-col gap-2 px-8 pt-4">
        {BOT_SEEDS.map((seed) => {
          const owned = have.has(seed.name);
          const on = owned || !off.has(seed.name);
          return (
            <div
              key={seed.name}
              className={cn(
                "rounded-2xl ring-1 transition-colors",
                owned
                  ? "opacity-45 ring-border/60"
                  : on
                    ? "ring-foreground"
                    : "ring-border/60",
              )}
            >
              <button
                type="button"
                disabled={owned || adding}
                aria-pressed={on}
                onClick={() =>
                  setOff((was) => {
                    const next = new Set(was);
                    if (next.has(seed.name)) next.delete(seed.name);
                    else next.add(seed.name);
                    return next;
                  })
                }
                className="flex w-full items-center gap-3.5 rounded-2xl px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
              >
                <BotMark
                  size={32}
                  {...markProps(seed.name, seed.icon)}
                  className={cn(
                    "shrink-0 transition-opacity",
                    !on && "opacity-35",
                  )}
                />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-[14px] font-medium">
                    {seed.name}
                  </span>
                  <span className="block text-[12px] leading-normal text-muted-foreground break-keep">
                    {seed.description}
                  </span>
                </span>
                {owned && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    already added
                  </span>
                )}
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full transition-colors",
                    on
                      ? "bg-foreground text-background"
                      : "ring-1 ring-border/60 ring-inset",
                  )}
                >
                  {on && <Check className="size-3.5" />}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-auto flex items-center gap-3 border-t border-border/60 px-8 py-4">
        <span className="flex-1 font-mono text-[11px] text-muted-foreground">
          {wanted.length === 0
            ? "nothing ticked"
            : `${wanted.length} of ${BOT_SEEDS.length - have.size} ticked`}
        </span>
        <Button variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        {/* Says what it will do, so the count is checkable before the click. */}
        <Button
          loading={adding}
          disabled={wanted.length === 0}
          onClick={() => add(wanted.map((seed) => ({ name: seed.name })))}
        >
          {wanted.length === 1
            ? `Add ${wanted[0].name}`
            : `Add ${wanted.length} bots`}
        </Button>
      </div>
    </div>
  );
}

/**
 * The mark seed is the name, not the row id, so a new bot's preview is the face the
 * roster will show. An unpicked colour stays empty and means the theme ink.
 */
function markProps(name: string, icon?: BotIcon | null) {
  return {
    seed: name || "bot",
    color: icon?.color,
    shape: icon?.shape,
    outline: icon?.outline,
  };
}

/**
 * One bot's page, or the form for a new one when `bot` is absent. Existing bots save
 * on blur or on pick; a new bot becomes a row on Create. The name is not editable:
 * renaming is delete and recreate (bot.query updateBot).
 */
function BotPage({
  bot,
  jobs,
  onDone,
  onCancel,
}: {
  bot?: Bot;
  /** Recent jobs for this bot (RECENT); empty for a new bot. */
  jobs: Task[];
  /** Created or deleted; where the roster should look next. */
  onDone: (name: string | null) => void;
  /** New bot only: folds the form. */
  onCancel?: () => void;
}) {
  // Lazy init so a new bot's icon is not re-rolled per render; the page is keyed per bot.
  const [fields, patch] = useObjectState(() => ({
    name: bot?.name ?? "",
    description: bot?.description ?? "",
    systemPrompt: bot?.systemPrompt ?? "",
    // Stored as a value so every screen draws the same face.
    icon: bot?.icon ?? randomBotIcon(),
    provider: (bot?.provider ?? null) as TextModelProviderId | null,
    model: bot?.model ?? "",
    toolIds: bot?.tools.map((tool) => tool.id) ?? [],
  }));
  const { name, description, systemPrompt, icon, provider, model, toolIds } =
    fields;

  const [save] = useServerAction(updateBotAction, {
    onOk: () => revalidate(queryKey.bot),
  });
  /** Saves now for an existing bot; a new bot holds everything until Create. */
  const commit = (next: Partial<BotForm>) => {
    if (bot) save(bot.name, next);
  };

  const [create, creating, , createError] = useServerAction(createBotAction, {
    errorMessage: false,
    okMessage: "Bot created",
    onOk: (made) => {
      revalidate(queryKey.bot);
      onDone(made.name);
    },
  });
  const [remove, removing] = useServerAction(deleteBotAction, {
    okMessage: "Bot deleted",
    onOk: () => {
      revalidate(queryKey.bot);
      onDone(null);
    },
  });

  const ready =
    name.trim() && description.trim() && provider && model.trim() && !creating;

  const submit = () => {
    if (!ready || !provider) return;
    create({
      name: name.trim(),
      description: description.trim(),
      systemPrompt: systemPrompt.trim() || undefined,
      icon,
      provider,
      model: model.trim(),
      toolIds,
    });
  };

  const confirmRemove = async () => {
    if (!bot) return;
    const confirmed = await notify.confirm({
      title: `Delete ${bot.name}?`,
      description: "The agent can no longer hand work to it.",
      okText: "Delete",
      destructive: true,
    });
    if (confirmed) remove(bot.name);
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {bot ? bot.name : "New bot"}
        </span>
        {bot && (
          <Button
            size="icon-sm"
            variant="ghost"
            loading={removing}
            aria-label="Delete this bot"
            onClick={confirmRemove}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        )}
      </div>

      <div className="flex-1 space-y-5 p-6">
        <div className="flex items-start gap-4">
          <BotMark size={72} {...markProps(name, icon)} className="shrink-0" />
          <div className="min-w-0 flex-1 space-y-2.5">
            {bot ? (
              <p className="truncate text-lg leading-8 font-medium">
                {bot.name}
              </p>
            ) : (
              <Input
                value={name}
                onChange={(event) => patch({ name: event.target.value })}
                placeholder="researcher"
                spellCheck={false}
                maxLength={COMMON_VALIDATE.name.max}
                autoFocus
              />
            )}
            <Input
              value={description}
              onChange={(event) => patch({ description: event.target.value })}
              onBlur={() => {
                const next = description.trim();
                if (bot && next && next !== bot.description) {
                  commit({ description: next });
                }
              }}
              placeholder="Searches the web and reports back"
              maxLength={COMMON_VALIDATE.description.max}
            />
          </div>
        </div>

        <MarkPicker
          icon={icon}
          onChange={(next) => {
            patch({ icon: next });
            commit({ icon: next });
          }}
        />

        <Row label="Runs on">
          <ModelPicker
            provider={provider}
            model={model}
            onChange={(next) => {
              patch({ provider: next.provider, model: next.model });
              // A provider without a model is not a model; save once both are picked.
              if (next.model) commit(next);
            }}
          />
        </Row>

        <Row label="Tools">
          <ToolPicker
            selected={toolIds}
            onChange={(next) => {
              patch({ toolIds: next });
              commit({ toolIds: next });
            }}
          />
        </Row>

        <Row label="Prompt">
          <Textarea
            value={systemPrompt}
            onChange={(event) => patch({ systemPrompt: event.target.value })}
            onBlur={() => {
              const next = systemPrompt.trim();
              if (bot && next !== (bot.systemPrompt ?? "")) {
                commit({ systemPrompt: next });
              }
            }}
            placeholder={`How it should work (optional). e.g.\nSearch the web, answer with a short summary and links.`}
            maxLength={COMMON_VALIDATE.prompt.max}
            // field-sizing-content grows with the text; cap it so a long prompt does not push the rest off screen.
            className="max-h-48 min-h-24 resize-none overflow-y-auto text-sm"
          />
          {systemPrompt.length > 0 && (
            <p className="text-right font-mono text-[10px] text-muted-foreground">
              {systemPrompt.length}/{COMMON_VALIDATE.prompt.max}
            </p>
          )}
        </Row>

        {bot && <Recent jobs={jobs} />}

        {!bot && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button loading={creating} disabled={!ready} onClick={submit}>
              Create
            </Button>
          </div>
        )}

        {createError && (
          <p className="font-mono text-xs text-destructive">{createError}</p>
        )}
      </div>
    </div>
  );
}

/** What the roster's pick is, in the section's rail. */
function BotRail({ bot }: { bot: Bot | null }) {
  if (!bot)
    return (
      <SettingRailNote>
        Becomes a bot once it has a name and a model
      </SettingRailNote>
    );
  const tokens = bot.tokens.input + bot.tokens.output;
  return (
    <SettingRailNote>
      <span className="font-mono text-[11px]">
        {bot.name}
        <span className="px-1.5 opacity-50">·</span>
        <span
          title={`in ${formatCount(bot.tokens.input)} · out ${formatCount(bot.tokens.output)}`}
        >
          {tokens > 0 ? `${formatCount(tokens)} tokens` : "no tokens yet"}
        </span>
        <span className="px-1.5 opacity-50">·</span>
        since {whenOf(bot.createdAt)}
      </span>
    </SettingRailNote>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 pt-2 font-mono text-xs text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
    </div>
  );
}

/** This bot's recent jobs; the full list is in Settings > Tasks. */
function Recent({ jobs }: { jobs: Task[] }) {
  return (
    <div className="pt-1">
      <div className="flex h-6 items-center">
        <span className="font-mono text-xs text-muted-foreground">Recent</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => openSettings("tasks")}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <History className="size-3" />
          History
        </button>
      </div>
      {jobs.length === 0 ? (
        <p className="py-2 text-[13px] text-muted-foreground">
          Nothing handed over yet.
        </p>
      ) : (
        jobs.map((job) => {
          const state = jobState(job);
          return (
            <div
              key={job.id}
              className="flex h-9 items-center gap-3 border-t border-border/60 text-[13px]"
            >
              <span className="min-w-0 flex-1 truncate">{job.label}</span>
              <span
                className={cn("shrink-0 font-mono text-[11px]", state.tone)}
              >
                {state.text}
              </span>
              <span className="w-28 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                {whenOf(job.updatedAt)}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

function jobState(job: Task): { text: string; tone: string } {
  switch (job.status) {
    case "waiting":
      return isBudgetAsk(job.ask)
        ? { text: "out of steps", tone: "text-muted-foreground" }
        : {
            text: "waiting on you",
            tone: WAITING_INK,
          };
    case "running":
      return { text: "working", tone: "text-muted-foreground" };
    case "failed":
      return { text: "failed", tone: "text-destructive" };
    default:
      return { text: "done", tone: "text-muted-foreground" };
  }
}

/** Palette swatch and silhouette for a BotMark; the caller draws the face. */
function MarkPicker({
  icon,
  onChange,
}: {
  icon: BotIcon;
  onChange: (icon: BotIcon) => void;
}) {
  return (
    <>
      <Row label="Color">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* MARK_SYSTEM is an explicit "follow the theme ink", distinct from no colour. */}
          <Swatch
            color={null}
            picked={icon.color === MARK_SYSTEM}
            onPick={() => onChange({ ...icon, color: MARK_SYSTEM })}
          />
          {MARK_PALETTE.map((color) => (
            <Swatch
              key={color}
              color={color}
              picked={icon.color === color}
              onPick={() =>
                onChange({
                  ...icon,
                  color: icon.color === color ? undefined : color,
                })
              }
            />
          ))}
        </div>
      </Row>

      {/* Every chip is a toggle: unpicked means "whatever the name seeds", not a value */}
      <Row label="Face">
        <div className="flex gap-1">
          {MARK_SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              onClick={() =>
                onChange({
                  ...icon,
                  shape: icon.shape === shape ? undefined : shape,
                })
              }
              className={cn(
                "rounded-md px-2 py-1 font-mono text-[11px] capitalize transition-colors",
                icon.shape === shape
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {shape}
            </button>
          ))}
          <span className="mx-1 w-px self-stretch bg-border/60" />
          <button
            type="button"
            onClick={() =>
              onChange({ ...icon, outline: icon.outline ? undefined : true })
            }
            className={cn(
              "rounded-md px-2 py-1 font-mono text-[11px] transition-colors",
              icon.outline
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            outline
          </button>
        </div>
      </Row>
    </>
  );
}

type McpToolPick = {
  id: number;
  name: string;
  serverName: string;
  description: string | null;
};

/** Chips beyond this fold into "+N". */
const CHIP_LIMIT = 4;

/**
 * Which MCP tools are loaded from the start; everything else stays searchable, so the
 * cap is a prompt-size budget, not a limit on ability.
 */
function ToolPicker({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (toolIds: number[]) => void;
}) {
  const { data: tools = [] } = useServerRoute<McpToolPick[]>(queryKey.mcpTools);
  const [open, setOpen] = useState(false);

  const full = selected.length >= MAX_PINNED_TOOLS;
  const servers = [...new Set(tools.map((tool) => tool.serverName))];
  const picked = selected
    .map((id) => tools.find((tool) => tool.id === id))
    .filter((tool): tool is McpToolPick => Boolean(tool));
  const shown = open ? picked : picked.slice(0, CHIP_LIMIT);
  const folded = picked.length - shown.length;

  const toggle = (id: number) =>
    onChange(
      selected.includes(id)
        ? selected.filter((entry) => entry !== id)
        : [...selected, id],
    );

  if (tools.length === 0) {
    return (
      <p className="pt-1.5 text-xs text-muted-foreground">
        Nothing to pin — connect an MCP server first (Settings › Connectors).
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="icon-sm"
          variant={open ? "secondary" : "outline"}
          onClick={() => setOpen(!open)}
          aria-label="Pick tools"
          className="border-dashed"
        >
          <Wrench />
        </Button>

        {shown.map((tool) => (
          <span
            key={tool.id}
            className="flex items-center gap-1 rounded-full bg-muted py-1 pr-1.5 pl-2.5 font-mono text-[11px]"
          >
            {tool.name}
            <button
              type="button"
              aria-label={`Unpin ${tool.name}`}
              onClick={() => toggle(tool.id)}
              className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}

        {folded > 0 && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            +{folded}
          </button>
        )}

        {picked.length === 0 && (
          <span className="text-xs text-muted-foreground">
            Loaded from the start — everything else stays searchable
          </span>
        )}

        <span className="flex-1" />
        <span
          className={cn(
            "font-mono text-[11px] text-muted-foreground",
            full && "text-foreground",
          )}
        >
          {selected.length}/{MAX_PINNED_TOOLS}
        </span>
      </div>

      {open && (
        <Command className="rounded-lg border border-input">
          <CommandInput placeholder="Search tools" />
          <CommandList className="max-h-44">
            <CommandEmpty>Nothing matches</CommandEmpty>
            {servers.map((server) => (
              <CommandGroup key={server} heading={server}>
                {tools
                  .filter((tool) => tool.serverName === server)
                  .map((tool) => {
                    const isPicked = selected.includes(tool.id);
                    return (
                      <CommandItem
                        key={tool.id}
                        // Names collide across servers.
                        value={`${tool.serverName}/${tool.name}`}
                        disabled={!isPicked && full}
                        onSelect={() => toggle(tool.id)}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {tool.name}
                        </span>
                        {isPicked && <Check className="size-3.5 shrink-0" />}
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      )}
    </div>
  );
}
