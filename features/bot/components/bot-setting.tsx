"use client";

import {
  Check,
  CircleAlert,
  History,
  PencilLine,
  Plus,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BOT_NOTES, PROMPT_CROWDED } from "@/config";
import { ModelPicker } from "@/features/ai/components/model-picker";
import type { TextModelProviderId } from "@/features/ai/model.schema";
import {
  clearBotNoteAction,
  createBotAction,
  createSeedBotsAction,
  deleteBotAction,
  setBotNotesOnAction,
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
import {
  BOT_SEEDS,
  type BotSeed,
  rollSeedColors,
} from "@/features/bot/bot.seed";
import { BotMark } from "@/features/bot/components/bot-mark";
import {
  type ConfigStatus,
  isConfigSet,
  MEDIA_MODEL_KEYS,
  mediaModelWords,
} from "@/features/config/config.const";
import {
  SettingDialogContent,
  SettingError,
  SettingNote,
  SettingPanes,
  SettingPanesSkeleton,
  SettingRailNote,
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

  /**
   * One roll for this screen, in BOT_SEEDS order. The faces on the invite, in the
   * picker and on the bot that gets created are then the same colour, because
   * `createSeedBotsAction` takes it (bot.seed rollSeedColors rolls per install so
   * no two rosters look alike; a seed itself carries none).
   */
  const [inks] = useState(rollSeedColors);

  if (isLoading) return <SettingPanesSkeleton />;
  if (error) return <SettingError message={error.message} />;

  const drafting = picked === NEW;
  const on = bots.filter((bot) => !bot.disabled).length;
  const have = new Set(bots.map((bot) => bot.name));
  const missing = BOT_SEEDS.filter((seed) => !have.has(seed.name));
  const current = drafting
    ? null
    : (bots.find((bot) => bot.name === picked) ?? bots[0] ?? null);

  return (
    <SettingPanes
      footer={bots.length === 0 ? null : <BotRail bot={current} />}
      left={
        <div className="flex flex-col py-2">
          {/* The two ways to get a bot, on one line and apart from the roster
              under it: a seed is not a bot you have */}
          <div className="mx-2 mb-1 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPicked(NEW)}
              className={cn(
                "flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
                drafting
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Plus className="size-3.5 shrink-0" />
              New bot
            </button>

            {bots.length > 0 && missing.length > 0 && (
              <SeedInvite
                missing={missing}
                inks={inks}
                have={have}
                onDone={(name) => setPicked(name)}
              />
            )}
          </div>

          {bots.map((bot) => (
            <RosterRow
              key={bot.name}
              bot={bot}
              job={jobs.find((job) => job.bot === bot.name) ?? null}
              active={!drafting && bot.name === current?.name}
              onPick={() => setPicked(bot.name)}
            />
          ))}

          {/* Only bots that are on: a switched-off one is in no prompt to crowd. */}
          {on > PROMPT_CROWDED.bots && (
            <SettingNote className="mx-3 mt-2 leading-relaxed">
              {on} bots are on. Each is a line in every prompt, and one more for
              Thursday to choose between.
            </SettingNote>
          )}
        </div>
      }
      right={
        drafting ? (
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
        ) : missing.length > 0 ? (
          // Nothing on the roster: the offer is the only thing this pane could
          // hold, so it fills it rather than sitting in a dialog nobody opened
          <SeedPackage
            have={have}
            inks={inks}
            onDone={(name) => setPicked(name)}
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
  const line = liveLine(job, bot.lastJobAt, bot.disabled);
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
        className={cn("shrink-0", bot.disabled && "opacity-45")}
      />
      <span
        className={cn(
          "min-w-0 flex-1 space-y-0.5",
          bot.disabled && "opacity-45",
        )}
      >
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
  disabled: boolean,
): {
  text: string;
  shine?: boolean;
  amber?: boolean;
} {
  if (job?.status === "waiting") {
    return isBudgetAsk(job.ask)
      ? { text: "out of steps" }
      : { text: "waiting on you", shine: true, amber: true };
  }
  if (job?.status === "running") {
    return { text: `working · ${job.label}`, shine: true };
  }
  // Switched off, and no colour: off is the user's own choice, not something
  // waiting on them, so the word carries it. It stands where the idle line
  // would — the two cases above are a job it already had, which off never
  // stopped, and hiding an ask behind "off" is how one goes unanswered.
  if (disabled) return { text: "off" };
  if (!job) {
    if (!lastJobAt) return { text: "idle · no jobs yet" };
    return { text: `idle · last job ${sinceWord(lastJobAt)}` };
  }
  return { text: `idle · last job ${sinceWord(job.updatedAt)}` };
}

/** "just now" or "3h ago". */
function sinceWord(at: DateLike): string {
  const ago = shortAgo(at);
  return ago === "now" ? "just now" : `${ago} ago`;
}
/**
 * What a seed still needs before it can work, as one line, or null when it needs
 * nothing. A missing studio model is not a fallback — the tool is absent — so the
 * row says so before the bot finds out mid-job. Ticking is never blocked: the list
 * states the cost, it does not cap it.
 */
function unmetLine(
  seed: BotSeed,
  isSet: (key: string) => boolean,
): string | null {
  const unmet = (seed.requires ?? []).filter(
    (kind) => !isSet(MEDIA_MODEL_KEYS[kind]),
  );
  if (!unmet.length) return null;
  return `needs ${unmet.map(mediaModelWords).join(" and ")}`;
}

/**
 * The picker's state, shared by the two places the offer appears: the pane an
 * empty roster opens on, and the dialog the roster's invite opens. Seeds are
 * ticked already, because the set is the recommendation and unticking is the
 * decision; one already on the roster is locked on and says so, since `createBot`
 * would only answer "already exists", which is an error about something this
 * screen already knows. One call creates all of them.
 */
function useSeedPicks(
  have: Set<string>,
  inks: string[],
  onDone: (name: string | null) => void,
) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const [add, adding] = useServerAction(createSeedBotsAction, {
    onOk: (made) => {
      revalidate(queryKey.bot);
      onDone(made.created[0] ?? null);
    },
  });
  // Same key the Models section and its badge read, so one fetch answers all three.
  const { data: config } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const isSet = (key: string) => isConfigSet(config, key);

  // Seeds not on the roster yet. `have` is the whole roster, so counting against
  // its size goes negative the moment a bot nobody seeded is on it.
  const addable = BOT_SEEDS.filter((seed) => !have.has(seed.name));
  const wanted = addable.filter((seed) => !off.has(seed.name));

  return {
    isSet,
    adding,
    addable,
    wanted,
    ticked: (seed: BotSeed) => have.has(seed.name) || !off.has(seed.name),
    toggle: (name: string) =>
      setOff((was) => {
        const next = new Set(was);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      }),
    submit: () =>
      add(
        wanted.map((seed) => ({
          name: seed.name,
          color: inks[BOT_SEEDS.indexOf(seed)],
        })),
      ),
  };
}

/** The rows themselves. Both wrappers draw these and supply their own chrome. */
function SeedRows({
  have,
  inks,
  picks,
}: {
  have: Set<string>;
  inks: string[];
  picks: ReturnType<typeof useSeedPicks>;
}) {
  return (
    <div className="flex flex-col gap-2">
      {BOT_SEEDS.map((seed, at) => {
        const owned = have.has(seed.name);
        const on = picks.ticked(seed);
        const needs = unmetLine(seed, picks.isSet);
        return (
          <div
            key={seed.name}
            className={cn(
              "rounded-xl ring-1 transition-colors",
              owned
                ? "opacity-45 ring-border/60"
                : on
                  ? "ring-foreground"
                  : "ring-border/60",
            )}
          >
            <button
              type="button"
              disabled={owned || picks.adding}
              aria-pressed={on}
              onClick={() => picks.toggle(seed.name)}
              className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
            >
              <BotMark
                size={28}
                {...markProps(seed.name, seed.icon)}
                color={inks[at]}
                className={cn(
                  "shrink-0 transition-opacity",
                  !on && "opacity-35",
                )}
              />
              {/* The hint stays on one line: the list grows, and a wrapping
                  sentence per row is what made this read as a page of prose */}
              <span className="min-w-0 flex-1 space-y-px">
                <span className="block text-[14px] leading-[18px] font-medium">
                  {seed.name}
                </span>
                <span className="block truncate text-[12px] leading-[17px] text-muted-foreground">
                  {seed.hint}
                </span>
              </span>
              {owned ? (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  already added
                </span>
              ) : needs ? (
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 font-mono text-[11px]",
                    WAITING_INK,
                  )}
                >
                  <CircleAlert className="size-3" />
                  {needs}
                </span>
              ) : null}
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full transition-colors",
                  on
                    ? "bg-foreground text-background"
                    : "ring-1 ring-border/60 ring-inset",
                )}
              >
                {on && <Check className="size-3" />}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Says what Add will do, so the count is checkable before the click. */
function SeedActions({
  picks,
  onCancel,
}: {
  picks: ReturnType<typeof useSeedPicks>;
  onCancel: () => void;
}) {
  return (
    <>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        loading={picks.adding}
        disabled={picks.wanted.length === 0}
        onClick={picks.submit}
      >
        <Plus />
        {picks.wanted.length === 1
          ? `Add ${picks.wanted[0].name}`
          : `Add ${picks.wanted.length} bots`}
      </Button>
    </>
  );
}

/**
 * The offer as a pane: what an empty roster opens on, because nothing else could
 * be there. A roster with bots on it gets `SeedInvite` and a dialog instead — a
 * row among the bots read as a bot the user already had.
 */
function SeedPackage({
  have,
  inks,
  onDone,
}: {
  /** Names already on the roster. */
  have: Set<string>;
  inks: string[];
  onDone: (name: string | null) => void;
}) {
  const picks = useSeedPicks(have, inks, onDone);

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex h-11 shrink-0 items-center border-b border-border/60 px-4 font-mono text-[11px] text-muted-foreground">
        Ready-made
      </div>

      <div className="px-8 pt-7 pb-1">
        <h3 className="text-[17px] font-medium tracking-tight">
          Bots you can add
        </h3>
        <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-muted-foreground break-keep">
          Each one is a starting point — rename it, re-prompt it, give it a
          model of its own. What a bot needs before it can work stands on its
          row; until then it runs on the app default model.
        </p>
      </div>

      <div className="px-8 pt-4">
        <SeedRows have={have} inks={inks} picks={picks} />
      </div>

      <div className="mt-auto flex items-center gap-3 border-t border-border/60 px-8 py-4">
        <span className="flex-1 font-mono text-[11px] text-muted-foreground">
          {picks.wanted.length === 0
            ? "nothing ticked"
            : `${picks.wanted.length} of ${picks.addable.length} ticked`}
        </span>
        <SeedActions picks={picks} onCancel={() => onDone(null)} />
      </div>
    </div>
  );
}

/** The same offer in a dialog, which brings its own padding and its own footer. */
function SeedDialog({
  have,
  inks,
  onDone,
}: {
  have: Set<string>;
  inks: string[];
  onDone: (name: string | null) => void;
}) {
  const picks = useSeedPicks(have, inks, onDone);

  return (
    <SettingDialogContent
      title="Bots you can add"
      description="Each one is a starting point — rename it, re-prompt it, give it a model of its own. What a bot needs before it can work stands on its row."
      footer={<SeedActions picks={picks} onCancel={() => onDone(null)} />}
    >
      <SeedRows have={have} inks={inks} picks={picks} />
    </SettingDialogContent>
  );
}

/**
 * The invite, on the New bot line rather than in the roster: both are ways to get
 * a bot, and neither is a bot you have. It carries the faces of the ones still on
 * offer, in the colours they would be created with, because a row of names would
 * read as one more list and the faces are what says these are bots.
 */
function SeedInvite({
  missing,
  inks,
  have,
  onDone,
}: {
  missing: BotSeed[];
  inks: string[];
  have: Set<string>;
  onDone: (name: string | null) => void;
}) {
  return (
    <button
      type="button"
      title="Ready-made bots"
      aria-label={`Ready-made bots, ${missing.length} on offer`}
      onClick={() =>
        notify.component({
          className: "sm:max-w-xl",
          renderer: ({ close }) => (
            <SeedDialog
              have={have}
              inks={inks}
              onDone={(name) => {
                close();
                onDone(name);
              }}
            />
          ),
        })
      }
      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      {/* Says the same thing the words next to it do, about a different set: these
          are bots to add. It carries the affordance on its own when one seed is
          left and the faces are a single dot */}
      <Plus className="size-3 shrink-0" />
      {missing.map((seed, at) => (
        <span
          key={seed.name}
          className={cn("block", at > 0 && "-ml-1.5")}
          style={{ zIndex: missing.length - at }}
        >
          <BotMark
            size={20}
            {...markProps(seed.name, seed.icon)}
            color={inks[BOT_SEEDS.indexOf(seed)]}
            notify={false}
          />
        </span>
      ))}
    </button>
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
  // Shared with the rail's switch; SWR dedups the read
  const { data: notesOn } = useServerRoute<boolean>(queryKey.botNotes);
  const [clearNote, clearingNote] = useServerAction(clearBotNoteAction, {
    okMessage: "Notes cleared",
    onOk: () => revalidate(queryKey.bot),
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

  /** The bot writes its own notes; the only thing to do to them from here is throw them away. */
  const confirmClearNote = async () => {
    if (!bot) return;
    const confirmed = await notify.confirm({
      title: `Clear ${bot.name}'s own prompt?`,
      description:
        "What it worked out about doing jobs here is gone, and it starts the next one without it.",
      okText: "Clear",
      destructive: true,
    });
    if (confirmed) clearNote(bot.name);
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
          <>
            {/* Only when off: on is the resting state and needs no word. */}
            {bot.disabled && (
              <span className="font-mono text-[10px] text-muted-foreground">
                off
              </span>
            )}
            <Switch
              checked={!bot.disabled}
              onCheckedChange={(on) => commit({ disabled: !on })}
              aria-label={`${bot.name} on or off`}
              /* mr-1 keeps it off Delete: one is a setting, the other is not. */
              className="mr-1 shrink-0"
            />
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
          </>
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

        {bot?.note && (
          /* Not a Row like the fields above it: those are settings the owner
             typed, this is what the bot has worked out, and a block under its
             face reads as part of who it is rather than one more control. */
          <div className="overflow-hidden rounded-xl border border-border/60 bg-muted/25">
            <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3">
              <PencilLine className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                What {bot.name} has worked out
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {bot.note.length}/{BOT_NOTES.chars}
              </span>
            </div>
            <p className="px-4 py-3.5 text-[13px] leading-relaxed whitespace-pre-wrap">
              {bot.note}
            </p>
            <div className="flex items-center gap-2 px-4 pb-3">
              {/* No amber: switched off is the user's own choice, not something
                  waiting on them. The word carries it. */}
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                {notesOn === false
                  ? "Paused — bots are not keeping their own prompt"
                  : "It writes this itself when a job ends"}
                {bot.noteAt && (
                  <>
                    <span className="px-1.5 opacity-50">·</span>
                    {shortAgo(bot.noteAt)}
                  </>
                )}
              </span>
              <Button
                size="sm"
                variant="ghost"
                loading={clearingNote}
                onClick={confirmClearNote}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                Clear
              </Button>
            </div>
          </div>
        )}

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

/**
 * What the roster's pick is, and the one setting that is the whole set's rather
 * than any bot's: whether bots keep their own instructions at all.
 */
function BotRail({ bot }: { bot: Bot | null }) {
  const { data: notesOn, mutate } = useServerRoute<boolean>(queryKey.botNotes);
  const [setNotesOn] = useServerAction(setBotNotesOnAction, {
    onOk: () => revalidate(queryKey.botNotes),
  });

  const tokens = bot ? bot.tokens.input + bot.tokens.output : 0;
  return (
    <>
      <SettingRailNote>
        {bot ? (
          <span className="font-mono text-[11px]">
            {bot.name}
            {bot.disabled && (
              <>
                <span className="px-1.5 opacity-50">·</span>off
              </>
            )}
            <span className="px-1.5 opacity-50">·</span>
            <span
              title={`in ${formatCount(bot.tokens.input)} · out ${formatCount(bot.tokens.output)}`}
            >
              {tokens > 0 ? `${formatCount(tokens)} tokens` : "no tokens yet"}
            </span>
            <span className="px-1.5 opacity-50">·</span>
            since {whenOf(bot.createdAt)}
          </span>
        ) : (
          "Becomes a bot once it has a name and a model"
        )}
      </SettingRailNote>
      <span className="shrink-0 text-xs text-muted-foreground">
        Bots keep their own prompt
      </span>
      <Switch
        checked={notesOn ?? true}
        disabled={notesOn === undefined}
        onCheckedChange={(on) => {
          void mutate(on, false);
          setNotesOn(on);
        }}
        aria-label="Bots keep their own prompt"
      />
    </>
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
