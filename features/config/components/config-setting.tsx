"use client";

import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowUpRight,
  AudioLines,
  Captions,
  Check,
  ChevronRight,
  Clapperboard,
  Ellipsis,
  Image as ImageIcon,
  KeyRound,
  type LucideIcon,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/notify";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SiteIcon } from "@/components/ui/site-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatGptSignIn } from "@/features/ai/components/chatgpt-sign-in";
import { ModelPicker } from "@/features/ai/components/model-picker";
import { ProviderIcon } from "@/features/ai/components/provider-icon";
import {
  type AiProvider,
  type GatewayCredits,
  type MediaKind,
  parseMediaModel,
  parseTextModel,
  type SubscriptionUsage,
} from "@/features/ai/model.schema";
import { BotsMark } from "@/features/bot/components/bot-mark";
import {
  removeConfigAction,
  setConfigAction,
} from "@/features/config/config.action";
import {
  CONFIG_GROUPS,
  type ConfigChoice,
  type ConfigEntry,
  type ConfigGroup,
  type ConfigStatus,
  EXA_API_KEY,
  groupSatisfied,
  isConfigSet,
} from "@/features/config/config.const";
import { ReachGuide } from "@/features/reach/components/reach-guide";
import {
  SettingDialogContent,
  SettingError,
  SettingGroup,
  SettingItems,
  SettingNote,
  SettingRailNote,
  SettingScreen,
  SettingSkeleton,
} from "@/features/settings/components/setting-ui";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";

/** A key that is not a provider's still wears a mark, or its row is a hole in the column. */
const KEY_MARKS: Record<string, LucideIcon> = { [EXA_API_KEY]: Search };

/** How many provider marks the first-run step shows before "More": one row of the narrow column. */
const ACCOUNTS_FIRST = 4;

/** One mark per studio kind, drawn as the output (transcription is captions, not a mic). */
const KIND_MARKS: Record<MediaKind, LucideIcon> = {
  image: ImageIcon,
  video: Clapperboard,
  speech: AudioLines,
  transcription: Captions,
};

/**
 * One screen per subject, each a list of the catalogue's groups in reading order: the
 * accounts (the voice key, the two easy ways as cards, every other provider as a mark to
 * tap, search), and what runs on them. Phone is its own screen, below.
 */
const SCREENS = {
  keys: ["voice", "easy", "text", "search"],
  models: ["bots", "studio"],
} as const satisfies Record<string, readonly ConfigGroup["id"][]>;

export const KeysSetting = () => <ConfigScreen screen="keys" />;
export const ModelsSetting = () => <ConfigScreen screen="models" />;

/**
 * Phone is no list of keys: each token is set inside the step that asks for it, so the whole
 * screen is `reach-guide`. Its keys stay in the catalogue — that is the write action's allow
 * list — they are simply not drawn as rows here.
 */
export const PhoneSetting = () => (
  <SettingScreen
    footer={
      <SettingRailNote>
        Nothing on this computer is opened to the internet: the app asks the
        chat service what was written.
      </SettingRailNote>
    }
  >
    <ReachGuide />
  </SettingScreen>
);

/** Reads set/unset only, never a value. */
function ConfigScreen({ screen }: { screen: keyof typeof SCREENS }) {
  const { data, isLoading, error } = useServerRoute<ConfigStatus[]>(
    queryKey.config,
  );

  if (isLoading) return <SettingSkeleton rows={4} />;
  if (error) return <SettingError message={error.message} />;

  const isSet = (key: string) => isConfigSet(data, key);
  // Only choice entries carry a value
  const valueOf = (key: string) =>
    data?.find((entry) => entry.key === key)?.value;

  const groups = SCREENS[screen].flatMap(
    (id) => CONFIG_GROUPS.find((group) => group.id === id) ?? [],
  );
  const keys = groups
    .filter((group) => group.section === "keys")
    .flatMap((group) => group.entries);

  return (
    <SettingScreen
      footer={
        <SettingRailNote>
          {screen === "models"
            ? "Her own voice and backend models are in Thursday. A bot can pick its own on its page."
            : `${keys.filter((entry) => isSet(entry.key)).length} of ${keys.length} set${
                groups.some((group) => !groupSatisfied(group, isSet))
                  ? " · a call needs one voice key"
                  : " · your keys stay on this machine"
              }`}
        </SettingRailNote>
      }
    >
      {groups.map((group) => (
        <SettingGroup
          key={group.id}
          label={group.title}
          hint={group.hint}
          right={<RequirementBadge group={group} isSet={isSet} />}
        >
          {group.id === "easy" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {group.entries.map((entry) => (
                <KeyRow
                  key={entry.key}
                  card
                  entry={entry}
                  set={isSet(entry.key)}
                  needed={false}
                />
              ))}
            </div>
          ) : group.id === "text" ? (
            <div className="flex flex-wrap gap-x-1.5 gap-y-3.5">
              {group.entries.map((entry) => (
                <KeyTile key={entry.key} entry={entry} set={isSet(entry.key)} />
              ))}
            </div>
          ) : (
            <SettingItems>
              {group.entries.map((entry) =>
                entry.choices ? (
                  <ChoiceRow
                    key={entry.key}
                    entry={entry}
                    choices={entry.choices}
                    value={valueOf(entry.key)}
                    isSet={isSet}
                  />
                ) : (
                  <KeyRow
                    key={entry.key}
                    entry={entry}
                    set={isSet(entry.key)}
                    // Amber only where something is actually missing: an
                    // unsatisfied required group is waiting on the user
                    needed={!groupSatisfied(group, isSet)}
                  />
                ),
              )}
            </SettingItems>
          )}
        </SettingGroup>
      ))}
    </SettingScreen>
  );
}

/**
 * The accounts alone, stacked for a narrow column: the first-run intro's step on what
 * bots think with. The same cards, marks and dialogs as the screen above, so a key set
 * on the way in is the key Settings shows.
 */
export function AccountsSetup({
  /** Leave the voice key out: the screen asked for it already. */
  withoutVoice = false,
}: {
  withoutVoice?: boolean;
}) {
  const { data } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const isSet = (key: string) => isConfigSet(data, key);
  const entries = (id: ConfigGroup["id"]) =>
    CONFIG_GROUPS.find((group) => group.id === id)?.entries ?? [];
  // A newcomer reads one row: the providers most people have a key for, and any that is
  // already set. The rest are one press away, over the row rather than below it, so the
  // screen around it does not move
  const [more, setMore] = useState(false);
  const voice = entries("voice");
  const marks = [...voice, ...entries("text")];
  // Without the voice key the row is one shorter, not refilled from the rest
  const first = marks.filter(
    (entry, at) =>
      (at < ACCOUNTS_FIRST || isSet(entry.key)) &&
      !(withoutVoice && voice.includes(entry)),
  );
  const rest = marks.filter(
    (entry) =>
      !first.includes(entry) && !(withoutVoice && voice.includes(entry)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {entries("easy").map((entry) => (
          <KeyRow
            key={entry.key}
            card
            narrow
            entry={entry}
            set={isSet(entry.key)}
            needed={false}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-y-2.5">
        {first.map((entry) => (
          <KeyTile key={entry.key} entry={entry} set={isSet(entry.key)} />
        ))}
        {rest.length > 0 && (
          <Popover open={more} onOpenChange={setMore}>
            <PopoverTrigger
              aria-label={`${rest.length} more providers`}
              className="group flex w-17 flex-col items-center gap-1.5 rounded-xl py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="grid size-10.5 place-items-center rounded-[13px] bg-muted/60 text-muted-foreground transition-colors group-hover:bg-muted">
                <Ellipsis className="size-4" />
              </span>
              <span className="text-[11px] text-muted-foreground">More</span>
            </PopoverTrigger>
            {/* A tile opens its key's dialog; the list goes first so the dialog is not under it */}
            <PopoverContent
              align="end"
              className="w-78 flex-row flex-wrap gap-0 gap-y-2.5 rounded-2xl p-2.5"
              onClick={() => setMore(false)}
            >
              {rest.map((entry) => (
                <KeyTile key={entry.key} entry={entry} set={isSet(entry.key)} />
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
      {entries("search").map((entry) => (
        <KeyRow
          key={entry.key}
          card
          narrow
          entry={entry}
          set={isSet(entry.key)}
          needed={false}
        />
      ))}
    </div>
  );
}

/** One provider's key as its mark: tap it, paste the key. A key that is set wears a check. */
function KeyTile({ entry, set }: { entry: ConfigEntry; set: boolean }) {
  return (
    <button
      type="button"
      onClick={() => openConfigDialog(entry, set)}
      aria-label={`${entry.label}: ${set ? "set" : "not set"}`}
      className="group flex w-17 flex-col items-center gap-1.5 rounded-xl py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="relative grid size-10.5 place-items-center rounded-[13px] bg-muted/60 transition-colors group-hover:bg-muted">
        <KeyMark entry={entry} />
        {set && (
          <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
            <Check className="size-2.5" />
          </span>
        )}
      </span>
      <span
        className={cn(
          "max-w-full truncate text-[11px]",
          set ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {entry.label}
      </span>
    </button>
  );
}

function RequirementBadge({
  group,
  isSet,
}: {
  group: ConfigGroup;
  isSet: (key: string) => boolean;
}) {
  if (group.require === "none") return null;
  if (groupSatisfied(group, isSet)) {
    return (
      <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
        <Check className="size-3" />
        ready
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex items-center gap-1 font-mono text-[11px]",
        WAITING_INK,
      )}
    >
      <TriangleAlert className="size-3" />
      {group.note ?? "Required"}
    </span>
  );
}

function KeyRow({
  entry,
  set,
  needed,
  card = false,
  narrow = false,
}: {
  entry: ConfigEntry;
  set: boolean;
  /** Drawn as a card of its own rather than a row in a list. */
  card?: boolean;
  /** In a narrow column the state takes the second line, where the key's name is of no use. */
  narrow?: boolean;
  /** Its group must have a key and has none, so this row is waiting on the user. */
  needed: boolean;
}) {
  const credits = useGatewayCredits(entry, set);
  const usage = useSubscriptionUsage(entry, set);
  const plan = useSignInPlan(entry, set);
  const state = usage.data
    ? usageState(usage.data)
    : keyState(set, needed, credits.data, entry.signIn);

  const waiting = credits.isLoading || usage.isLoading;
  const stateLine = (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 font-mono text-xs",
        state.ink,
      )}
    >
      {state.warn ? (
        <TriangleAlert className="size-3" />
      ) : (
        set && <Check className="size-3" />
      )}
      {state.text}
    </span>
  );

  return (
    <button
      type="button"
      onClick={() =>
        entry.signIn ? openSignInDialog(entry) : openConfigDialog(entry, set)
      }
      className={cn(
        "group flex w-full items-center gap-3 p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        card && "rounded-xl border border-border/60",
      )}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/60">
        <KeyMark entry={entry} />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex items-center gap-2 truncate text-sm font-medium">
          {entry.label}
          {entry.recommended && (
            <span className="rounded-full px-1.5 font-mono text-[9.5px] leading-4 font-normal text-muted-foreground ring-1 ring-border ring-inset">
              recommended
            </span>
          )}
        </span>
        {narrow ? (
          waiting ? (
            <Skeleton className="h-3 w-20" />
          ) : (
            stateLine
          )
        ) : (
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {/* A sign-in's config key is nothing to read; the plan it is on is */}
            {entry.signIn
              ? set
                ? usageLine(usage.data, plan)
                : "sign in with your account"
              : entry.key}
          </span>
        )}
      </span>

      {narrow ? null : waiting ? (
        // Only this end waits, so the row keeps its shape while the gateway or the plan answers
        <Skeleton className="h-3 w-20 shrink-0" />
      ) : (
        stateLine
      )}

      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
    </button>
  );
}

/** US dollars, as the gateway bills. */
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * What a key says at the end of its row. A key only knows whether it is set, except the
 * gateway's, which also says what is left on it: amber waits on a top-up, red is a refusal.
 */
function keyState(
  set: boolean,
  needed: boolean,
  credits: GatewayCredits | null | undefined,
  signIn?: true,
): { text: string; ink: string; warn: boolean } {
  if (!set)
    return needed
      ? { text: "Needed", ink: WAITING_INK, warn: true }
      : {
          text: signIn ? "Signed out" : "Not set",
          ink: "text-muted-foreground/60",
          warn: false,
        };
  if (!credits)
    return {
      text: signIn ? "Signed in" : "Set",
      ink: "text-muted-foreground",
      warn: false,
    };
  if ("refused" in credits)
    return { text: "Key refused", ink: "text-destructive", warn: true };
  return {
    text: `${USD.format(credits.balance)} left`,
    ink: credits.low ? WAITING_INK : "text-muted-foreground",
    warn: credits.low,
  };
}

/** What is left on the gateway key (ai/model readGatewayCredits); any other key reads nothing. */
function useGatewayCredits(entry: ConfigEntry, set: boolean) {
  return useServerRoute<GatewayCredits | null>(
    set && entry.provider === "vercel-ai-gateway"
      ? queryKey.gatewayCredits
      : null,
  );
}

/** The plan a signed-in account is on (llm-model route); a key row reads nothing. */
function useSignInPlan(entry: ConfigEntry, set: boolean) {
  const { data } = useServerRoute<AiProvider[]>(
    set && entry.signIn ? queryKey.llmModel : null,
  );
  return data?.find((provider) => provider.id === entry.provider)?.plan ?? null;
}

/** How much of the subscription's plan is used (ai/chatgpt readChatGptUsage); a key row reads nothing. */
function useSubscriptionUsage(entry: ConfigEntry, set: boolean) {
  return useServerRoute<SubscriptionUsage | null>(
    set && entry.signIn ? queryKey.subscriptionUsage : null,
  );
}

/**
 * What a subscription says at the end of its row: the share of its tightest window used. Amber
 * once it is nearly or wholly spent, because the jobs on it are about to wait for the reset; red
 * is a sign-in the plan refused.
 */
function usageState(usage: SubscriptionUsage): {
  text: string;
  ink: string;
  warn: boolean;
} {
  if ("refused" in usage)
    return { text: "Sign-in refused", ink: "text-destructive", warn: true };
  return {
    text: usage.spent ? "Limit reached" : `${usage.usedPercent}% used`,
    ink: usage.high ? WAITING_INK : "text-muted-foreground",
    warn: usage.high,
  };
}

/** A signed-in row's second line: the plan as the backend names it now, and when its window frees up. */
function usageLine(
  usage: SubscriptionUsage | null | undefined,
  plan: string | null,
): string {
  const live = usage && !("refused" in usage) ? usage : null;
  const name = `${live?.plan ?? plan ?? "unknown"} plan`;
  return live?.resetsAt
    ? `${name} · resets in ${formatDistanceToNowStrict(new Date(live.resetsAt))}`
    : name;
}

/** Whose key it is, or what it buys when it belongs to no provider. */
function KeyMark({ entry }: { entry: ConfigEntry }) {
  if (entry.provider)
    return <ProviderIcon provider={entry.provider} className="size-4" />;
  const Mark = KEY_MARKS[entry.key] ?? KeyRound;
  const glyph = <Mark className="size-4 text-muted-foreground" />;
  // A service that is not a model provider wears its own icon, as a site does in a thread
  return entry.site ? (
    <SiteIcon
      host={entry.site}
      className="size-4 rounded-[4px]"
      fallback={glyph}
    />
  ) : (
    glyph
  );
}

/**
 * A choice, not a secret: a studio kind, or the bots' default, picked where it stands with
 * the picker bots use — its list opens over the row, not a dialog around one field. Unset is
 * normal, so the field says what runs then. The value sits under the label rather than
 * across the row: at this width the two ends of a row are not read in one glance. Clearing
 * means different things: the bots' default falls back to whatever has a key, a studio kind
 * stops being offered at all (ai/model resolveMediaRef).
 */
function ChoiceRow({
  entry,
  choices,
  value,
  isSet,
}: {
  entry: ConfigEntry;
  choices: ConfigChoice[];
  value?: string;
  isSet: (key: string) => boolean;
}) {
  const ref = entry.text ? parseTextModel(value) : parseMediaModel(value);
  const usable = choices.filter((choice) => isSet(choice.needs));
  // A text model is what a bot thinks with, so it wears the bots mark; Cpu here was the memory glyph (memory-mark).
  const Mark = entry.kind ? KIND_MARKS[entry.kind] : BotsMark;
  const [save] = useServerAction(setConfigAction, {
    okMessage: `${entry.label} saved`,
    onOk: () => revalidate(queryKey.config),
  });
  const [clear] = useServerAction(removeConfigAction, {
    okMessage: entry.kind
      ? `${entry.label} switched off`
      : `${entry.label} back to automatic`,
    onOk: () => revalidate(queryKey.config),
  });

  return (
    <div className="flex w-full items-start gap-3 p-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/60">
        <Mark className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <span className="flex min-w-0 items-center gap-1.5 pt-1.5">
          <span className="truncate text-sm font-medium">{entry.label}</span>
          {!value && (
            <span
              className={cn(
                "shrink-0 rounded-[5px] border border-border/60 px-1 font-mono text-[10px]",
                entry.kind ? WAITING_INK : "text-muted-foreground",
              )}
            >
              {/* A studio kind unpicked is not automatic: the tool is not offered
                  at all (ai/model resolveMediaRef). Only the bots' default falls back. */}
              {entry.kind ? "off" : "auto"}
            </span>
          )}
        </span>
        <ModelPicker
          kind={entry.kind}
          provider={ref?.provider ?? null}
          model={ref?.model ?? ""}
          unset={
            entry.kind
              ? "Not offered to bots until you pick one"
              : (usable[0]?.label ?? "No key for any of these yet")
          }
          onChange={(next) =>
            save(entry.key, `${next.provider}/${next.model.trim()}`)
          }
          onUnset={value ? () => clear(entry.key) : undefined}
        />
      </div>
    </div>
  );
}

function openSignInDialog(entry: ConfigEntry) {
  return notify.component({
    className: "sm:max-w-md",
    renderer: ({ close }) => <SignInDialog entry={entry} onDone={close} />,
  });
}

/**
 * An account instead of a key. Read live: the sign-in finishes in a window of its own, and the
 * `config` signal it raises (use-thursday) is what turns this dialog to signed in.
 */
function SignInDialog({
  entry,
  onDone,
}: {
  entry: ConfigEntry;
  onDone: () => void;
}) {
  const { data } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const signedIn = isConfigSet(data, entry.key);
  const plan = useSignInPlan(entry, signedIn);
  const usage = useSubscriptionUsage(entry, signedIn);
  const state = usage.data ? usageState(usage.data) : null;
  const [signOut, signingOut] = useServerAction(removeConfigAction, {
    okMessage: `Signed out of ${entry.label}`,
    onOk: () => {
      revalidate(queryKey.config);
      revalidate(queryKey.llmModel);
      onDone();
    },
  });

  return (
    <SettingDialogContent
      title={entry.label}
      description={
        signedIn ? (
          <>
            Signed in ·{" "}
            <span className="font-mono">{usageLine(usage.data, plan)}</span>
            {state && (
              <>
                {" · "}
                <span className={cn("font-mono", state.ink)}>{state.text}</span>
              </>
            )}
          </>
        ) : (
          "Sign in with your ChatGPT account instead of a key"
        )
      }
      footer={
        <>
          {signedIn && (
            <Button
              variant="ghost"
              loading={signingOut}
              onClick={() => signOut(entry.key)}
            >
              Sign out
            </Button>
          )}
          <Button variant="ghost" onClick={onDone}>
            {signedIn ? "Close" : "Cancel"}
          </Button>
          {!signedIn && <ChatGptSignIn />}
        </>
      }
    >
      <div className="space-y-2">
        <SettingNote>
          {signedIn
            ? "Bots on this subscription spend your plan's usage, not a key. When it runs out, the job stops and says when it resets."
            : "The sign-in opens in its own window. Approve it there, and this turns to signed in by itself."}
        </SettingNote>
        {usage.data && "refused" in usage.data && (
          <SettingNote className="wrap-break-word text-destructive">
            {usage.data.refused}
          </SettingNote>
        )}
      </div>
    </SettingDialogContent>
  );
}

function openConfigDialog(entry: ConfigEntry, set: boolean) {
  return notify.component({
    className: "sm:max-w-md",
    renderer: ({ close }) => (
      <ConfigDialog entry={entry} set={set} onDone={close} />
    ),
  });
}

/** Set, replace or remove one key. The current value is never shown. */
function ConfigDialog({
  entry,
  set,
  onDone,
}: {
  entry: ConfigEntry;
  set: boolean;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const { data: credits } = useGatewayCredits(entry, set);
  const state = credits ? keyState(set, false, credits) : null;

  // The model picker reads hasKey too, and the gateway's credits sit under the same url
  const refresh = () => {
    revalidate(queryKey.config);
    revalidate(queryKey.llmModel);
  };

  const [save, saving] = useServerAction(setConfigAction, {
    okMessage: `${entry.label} key saved`,
    onOk: () => {
      refresh();
      onDone();
    },
  });
  const [remove, removing] = useServerAction(removeConfigAction, {
    okMessage: `${entry.label} key removed`,
    onOk: () => {
      refresh();
      onDone();
    },
  });

  return (
    <SettingDialogContent
      title={entry.label}
      description={
        <>
          <span className="font-mono">{entry.key}</span>
          {entry.hint && <> · {entry.hint}</>}
          {state && (
            <>
              {" · "}
              <span className={cn("font-mono", state.ink)}>{state.text}</span>
            </>
          )}
        </>
      }
      footer={
        <>
          {/* set apart from what saves, at the far end and in red */}
          {set && (
            <Button
              variant="ghost"
              loading={removing}
              onClick={() => remove(entry.key)}
              className="mr-auto text-destructive hover:text-destructive"
            >
              Remove
            </Button>
          )}
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={value.trim().length < 8}
            onClick={() => save(entry.key, value)}
          >
            {set ? "Replace" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim().length >= 8)
              save(entry.key, value);
          }}
          // what a key looks like says more than the setting's name, which is above
          placeholder={
            set
              ? "New value — replaces the current key"
              : (entry.keyLooks ?? "Paste the key")
          }
          spellCheck={false}
          type="password"
          autoFocus
        />
        {!set && entry.keysAt && (
          <a
            href={entry.keysAt}
            target="_blank"
            rel="noreferrer"
            className="flex w-fit items-center gap-1 px-0.5 text-[13px] text-foreground underline underline-offset-3 hover:text-foreground/80"
          >
            Get a key at {new URL(entry.keysAt).host}
            <ArrowUpRight className="size-3.5" />
          </a>
        )}
        {credits && "refused" in credits && (
          <SettingNote className="wrap-break-word text-destructive">
            {credits.refused}
          </SettingNote>
        )}
      </div>
    </SettingDialogContent>
  );
}
