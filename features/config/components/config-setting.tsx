"use client";

import { formatDistanceToNowStrict } from "date-fns";
import {
  AudioLines,
  Captions,
  Check,
  ChevronRight,
  Clapperboard,
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
  type TextModelProviderId,
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
import {
  SettingChoiceRows,
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

/** The "keys" half of the config catalogue; reads set/unset only, never a value. */
export function ConfigSetting() {
  return <ConfigGroups section="keys" />;
}

/** A key that is not a provider's still wears a mark, or its row is a hole in the column. */
const KEY_MARKS: Record<string, LucideIcon> = { [EXA_API_KEY]: Search };

/** One mark per studio kind, drawn as the output (transcription is captions, not a mic). */
const KIND_MARKS: Record<MediaKind, LucideIcon> = {
  image: ImageIcon,
  video: Clapperboard,
  speech: AudioLines,
  transcription: Captions,
};

export function ConfigGroups({ section }: { section: ConfigGroup["section"] }) {
  const { data, isLoading, error } = useServerRoute<ConfigStatus[]>(
    queryKey.config,
  );

  if (isLoading) return <SettingSkeleton rows={4} />;
  if (error) return <SettingError message={error.message} />;

  const isSet = (key: string) => isConfigSet(data, key);
  // Only choice entries carry a value
  const valueOf = (key: string) =>
    data?.find((entry) => entry.key === key)?.value;

  const groups = CONFIG_GROUPS.filter((group) => group.section === section);
  const entries = groups.flatMap((group) => group.entries);

  return (
    <SettingScreen
      footer={
        <SettingRailNote>
          {section === "keys" ? (
            <>
              {entries.filter((entry) => isSet(entry.key)).length} of{" "}
              {entries.length} set
              {groups.some((group) => !groupSatisfied(group, isSet))
                ? " · a call needs one voice key"
                : " · your keys stay on this machine"}
            </>
          ) : (
            <>
              {entries.length} of {entries.length} resolved ·{" "}
              {entries.filter((entry) => valueOf(entry.key)).length} pinned
            </>
          )}
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
        </SettingGroup>
      ))}
    </SettingScreen>
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
}: {
  entry: ConfigEntry;
  set: boolean;
  /** Its group must have a key and has none, so this row is waiting on the user. */
  needed: boolean;
}) {
  const credits = useGatewayCredits(entry, set);
  const usage = useSubscriptionUsage(entry, set);
  const plan = useSignInPlan(entry, set);
  const state = usage.data
    ? usageState(usage.data)
    : keyState(set, needed, credits.data, entry.signIn);

  return (
    <button
      type="button"
      onClick={() =>
        entry.signIn ? openSignInDialog(entry) : openConfigDialog(entry, set)
      }
      className="group flex w-full items-center gap-3 p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/60">
        <KeyMark entry={entry} />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block truncate text-sm font-medium">
          {entry.label}
        </span>
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {/* A sign-in's config key is nothing to read; the plan it is on is */}
          {entry.signIn
            ? set
              ? usageLine(usage.data, plan)
              : "sign in with your account"
            : entry.key}
        </span>
      </span>

      {credits.isLoading || usage.isLoading ? (
        // Only this end waits, so the row keeps its shape while the gateway or the plan answers
        <Skeleton className="h-3 w-20 shrink-0" />
      ) : (
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
  return <Mark className="size-4 text-muted-foreground" />;
}

/**
 * A choice, not a secret. Unset is normal, so the row says what runs
 * automatically. The value sits under the label rather than across the row:
 * at this width the two ends of a row are not read in one glance.
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
  const picked = choices.find((choice) => choice.value === value);
  const usable = choices.filter((choice) => isSet(choice.needs));
  // A value typed outside the list (gateway) has no label
  const typed = value && !picked ? value : null;
  // A text model is what a bot thinks with, so it wears the bots mark; Cpu here was the memory glyph (memory-mark).
  const Mark = entry.kind ? KIND_MARKS[entry.kind] : BotsMark;

  return (
    <button
      type="button"
      onClick={() =>
        entry.kind || entry.text
          ? openModelDialog(entry)
          : openChoiceDialog(entry, choices)
      }
      className="group flex w-full items-center gap-3 p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/60">
        <Mark className="size-4 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate text-sm font-medium">
          {entry.label}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          {!picked && !typed && (
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
          <span className="truncate font-mono text-xs text-muted-foreground">
            {picked?.label ??
              typed ??
              (entry.kind
                ? "Not offered to bots until you pick one"
                : (usable[0]?.label ?? "No key for any of these yet"))}
          </span>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
    </button>
  );
}

function openModelDialog(entry: ConfigEntry) {
  return notify.component({
    className: "sm:max-w-lg",
    renderer: ({ close }) => <ModelDialog entry={entry} onDone={close} />,
  });
}

/**
 * Picks one model entry — a studio kind, or the bots' default — with the picker bots use.
 * Clearing means different things: the bots' default falls back to whatever has a key, a studio
 * kind stops being offered at all (ai/model resolveMediaRef).
 */
function ModelDialog({
  entry,
  onDone,
}: {
  entry: ConfigEntry;
  onDone: () => void;
}) {
  const { data } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const stored = data?.find((status) => status.key === entry.key)?.value;
  // Local state: a provider picked without a model yet is not stored, but must still render
  const [pick, setPick] = useState<{
    provider: TextModelProviderId | null;
    model: string;
  }>(() => {
    const ref = entry.text ? parseTextModel(stored) : parseMediaModel(stored);
    return { provider: ref?.provider ?? null, model: ref?.model ?? "" };
  });

  const done = () => {
    revalidate(queryKey.config);
    onDone();
  };
  const [save] = useServerAction(setConfigAction, {
    okMessage: `${entry.label} saved`,
    onOk: done,
  });
  const [clear, clearing] = useServerAction(removeConfigAction, {
    okMessage: entry.kind
      ? `${entry.label} switched off`
      : `${entry.label} back to automatic`,
    onOk: done,
  });

  return (
    <SettingDialogContent
      title={entry.label}
      description={entry.hint}
      footer={
        <>
          {stored && (
            <Button
              variant="ghost"
              loading={clearing}
              onClick={() => clear(entry.key)}
            >
              {entry.kind ? "Turn off" : "Automatic"}
            </Button>
          )}
          <Button variant="ghost" onClick={onDone}>
            Close
          </Button>
        </>
      }
    >
      <ModelPicker
        kind={entry.kind}
        provider={pick.provider}
        model={pick.model}
        onChange={(next) => {
          setPick(next);
          // Provider alone is not a model; save once the name is filled
          if (next.model.trim()) {
            save(entry.key, `${next.provider}/${next.model.trim()}`);
          }
        }}
      />
    </SettingDialogContent>
  );
}

function openChoiceDialog(entry: ConfigEntry, choices: ConfigChoice[]) {
  return notify.component({
    className: "sm:max-w-md",
    renderer: ({ close }) => (
      <ChoiceDialog entry={entry} choices={choices} onDone={close} />
    ),
  });
}

/**
 * Choices without a key stay listed, disabled with the reason. Set/unset is
 * read live here: a key added while this dialog is open must unlock its row.
 */
function ChoiceDialog({
  entry,
  choices,
  onDone,
}: {
  entry: ConfigEntry;
  choices: ConfigChoice[];
  onDone: () => void;
}) {
  const { data } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const value = data?.find((status) => status.key === entry.key)?.value;
  const done = () => {
    revalidate(queryKey.config);
    onDone();
  };
  const [save, saving] = useServerAction(setConfigAction, {
    okMessage: `${entry.label} saved`,
    onOk: done,
  });
  const [clear, clearing] = useServerAction(removeConfigAction, {
    okMessage: entry.kind
      ? `${entry.label} switched off`
      : `${entry.label} back to automatic`,
    onOk: done,
  });

  return (
    <SettingDialogContent
      title={entry.label}
      description={entry.hint}
      footer={
        <>
          {value && (
            <Button
              variant="ghost"
              loading={clearing}
              onClick={() => clear(entry.key)}
            >
              {entry.kind ? "Turn off" : "Automatic"}
            </Button>
          )}
          <Button variant="ghost" onClick={onDone}>
            Close
          </Button>
        </>
      }
    >
      <SettingChoiceRows
        options={choices.map((choice) => ({
          value: choice.value,
          label: choice.label,
          disabled: !isConfigSet(data, choice.needs) && `needs ${choice.needs}`,
        }))}
        value={value}
        onChange={(picked) => save(entry.key, picked)}
        disabled={saving}
      />
    </SettingDialogContent>
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
          {set && (
            <Button
              variant="ghost"
              loading={removing}
              onClick={() => remove(entry.key)}
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
          placeholder={set ? "New value — replaces the current key" : entry.key}
          spellCheck={false}
          type="password"
          autoFocus
        />
        {credits && "refused" in credits && (
          <SettingNote className="wrap-break-word text-destructive">
            {credits.refused}
          </SettingNote>
        )}
      </div>
    </SettingDialogContent>
  );
}
