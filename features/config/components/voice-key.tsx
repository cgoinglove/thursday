"use client";

import { ArrowUpRight, Check, X } from "lucide-react";
import { type ReactNode, type Ref, useImperativeHandle, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KEY_MIN } from "@/config";
import { ChatGptSignIn } from "@/features/ai/components/chatgpt-sign-in";
import { ProviderIcon } from "@/features/ai/components/provider-icon";
import {
  LIVE_PROVIDER,
  type LiveLine,
  liveLineOf,
} from "@/features/ai/live.schema";
import {
  type AiProvider,
  planCallsOf,
  planName,
  TEXT_MODEL_PROVIDERS,
  type TextModelProviderId,
} from "@/features/ai/model.schema";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";
import { setConfigAction } from "../config.action";
import {
  type ConfigStatus,
  isConfigSet,
  isConfigUnreadable,
  lostWords,
} from "../config.const";

/**
 * Lets the parent save unsaved fields before navigating away. A ref rather
 * than lifted state, so typing a key does not re-render the intro.
 */
export type VoiceKeysHandle = {
  /** Whether a field holds something worth saving. */
  pending: () => boolean;
  /** Saves them; false if any failed. */
  flush: () => Promise<boolean>;
};

/** Where the voice key is made, beside its field: a pill that opens the page, and the page's address. */
export function GetKeyLink() {
  const at = TEXT_MODEL_PROVIDERS[LIVE_PROVIDER.id].keysAt;
  if (!at) return null;
  return (
    <a
      href={at}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 text-[13px] font-medium text-foreground no-underline"
    >
      <span className="flex h-7.5 shrink-0 items-center gap-1.5 rounded-full bg-muted px-3.5 whitespace-nowrap transition-colors hover:bg-accent">
        Get a key
        <ArrowUpRight className="size-3.5" />
      </span>
      <span className="truncate font-mono text-[11px] font-normal text-muted-foreground/70">
        {at.replace(/^https:\/\//, "")}
      </span>
    </a>
  );
}

/**
 * What her voice stands on, as the screen knows it: whether the GPT Subscription is signed in
 * and on which plan, whether that plan has spoken calls (model.schema planCallsOf), and the line
 * a call would open on (live.schema liveLineOf). `known` is false until both the keys and, when
 * signed in, the plan have answered, so a screen keeps its own answer meanwhile.
 */
export function useVoiceLine(): {
  known: boolean;
  signedIn: boolean;
  /** The plan as the token names it; null when it does not say or nobody is signed in. */
  plan: string | null;
  planCalls: boolean;
  line: LiveLine | null;
  /**
   * Whether a key counts toward a call, for the voice group's "ready" (config.const
   * groupSatisfied): the sign-in only on a plan with calls, so Free does not read as ready.
   */
  countsForCall: (key: string) => boolean;
} {
  const { data: config } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const signedIn = isConfigSet(config, TEXT_MODEL_PROVIDERS.chatgpt.apiKeyName);
  const { data: providers } = useServerRoute<AiProvider[]>(
    signedIn ? queryKey.llmModel : null,
  );
  const plan =
    providers?.find((provider) => provider.id === "chatgpt")?.plan ?? null;
  const known = config !== undefined && (!signedIn || providers !== undefined);
  const planCalls = planCallsOf(signedIn ? { plan } : null);
  return {
    known,
    signedIn,
    plan,
    planCalls,
    line: known
      ? liveLineOf(null, (key) => isConfigSet(config, key), plan)
      : null,
    countsForCall: (key) =>
      isConfigSet(config, key) &&
      (key !== TEXT_MODEL_PROVIDERS.chatgpt.apiKeyName || planCalls),
  };
}

/**
 * The two ways a call gets her voice, side by side: the GPT Subscription first, as the one that
 * bills nothing per minute and opens bots and pictures too, then an OpenAI key, whose field opens
 * under both when asked for. The first run and the call screen ask with this while neither is
 * set, so both read the same; which one a call then opens on is live.schema `liveLineOf`.
 */
export function CallLines({
  onSaved,
}: {
  /** The key was saved here; a sign-in lands on the server and reaches the screen as `config`. */
  onSaved?: () => void;
}) {
  const { data: config } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const [keyOpen, setKeyOpen] = useState(
    // a key saved before and no longer readable is asked for again where it was given
    () => isConfigUnreadable(config, LIVE_PROVIDER.apiKeyName),
  );
  const planLost = isConfigUnreadable(
    config,
    TEXT_MODEL_PROVIDERS.chatgpt.apiKeyName,
  );
  // Signed in on a plan without spoken calls: the card says so, and signs in another account
  const voice = useVoiceLine();
  const noCalls = voice.signedIn && !voice.planCalls;
  return (
    // Left-aligned wherever it stands: the call screen centres what is under her face
    <div className="flex w-full flex-col gap-3 text-left">
      {/* Equal cards whose buttons share one line at their foot, whatever each says above */}
      <div className="grid grid-cols-2 gap-2">
        <LineCard
          provider="chatgpt"
          title={TEXT_MODEL_PROVIDERS.chatgpt.label}
          tag={noCalls ? (planName(voice.plan) ?? undefined) : "recommended"}
          about={
            planLost
              ? "The sign-in saved before can't be unlocked any more. Sign in again."
              : noCalls
                ? "This plan runs bots and calls in writing, but not spoken calls. A paid plan or a key does."
                : "Your ChatGPT plan. No key, and no bill by the minute."
          }
          lost={planLost || noCalls}
        >
          <ChatGptSignIn
            variant={noCalls ? "outline" : "brand"}
            size="sm"
            className="w-full"
            label={noCalls ? "Sign in again" : undefined}
          />
        </LineCard>
        <LineCard
          provider="openai"
          title="OpenAI API key"
          about="Billed by the minute of call, apart from ChatGPT."
        >
          <Button
            size="sm"
            variant={noCalls ? "brand" : "outline"}
            aria-expanded={keyOpen}
            onClick={() => setKeyOpen((open) => !open)}
            className="w-full"
          >
            Paste a key
          </Button>
        </LineCard>
      </div>
      {keyOpen && (
        <div className="flex animate-in flex-col gap-2.5 fade-in slide-in-from-top-1 duration-200">
          <VoiceKeys dense plain autoFocus onSaved={onSaved} />
          <GetKeyLink />
        </div>
      )}
    </div>
  );
}

function LineCard({
  provider,
  title,
  tag,
  about,
  lost = false,
  children,
}: {
  provider: TextModelProviderId;
  title: string;
  tag?: string;
  about: string;
  lost?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl p-3 ring-1 ring-border ring-inset">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex h-4.5 items-center justify-between gap-1.5">
          <ProviderIcon provider={provider} className="size-4 shrink-0" />
          {tag && (
            <span className="rounded-full px-1.5 font-mono text-[9.5px] leading-4 text-muted-foreground ring-1 ring-border ring-inset">
              {tag}
            </span>
          )}
        </span>
        <span className="text-[13px] leading-tight font-medium">{title}</span>
        <span
          className={cn(
            "text-[11.5px] leading-snug text-pretty",
            lost ? WAITING_INK : "text-muted-foreground",
          )}
        >
          {about}
        </span>
      </div>
      {children}
    </div>
  );
}

/** The OpenAI key for Live voice and Responses delegation. Used by the intro and by the call screen while no key is set. */
export function VoiceKeys({
  ref,
  autoFocus,
  /** Compact layout for the call screen. */
  dense = false,
  /** The field alone, the provider's mark inside it: for a spot whose heading already names the key. */
  plain = false,
  onCancel,
  onSaved,
  className,
}: {
  ref?: Ref<VoiceKeysHandle>;
  autoFocus?: boolean;
  dense?: boolean;
  plain?: boolean;
  onCancel?: () => void;
  onSaved?: (provider: "openai") => void;
  className?: string;
}) {
  const { data: config } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  /** Why the last key was not kept, in the provider's words. */
  const [refused, setRefused] = useState<string | null>(null);

  // Said under the field rather than as an error toast: this is setup, where a key that
  // was turned away waits on the user and nothing is broken
  const [save] = useServerAction(setConfigAction, {
    errorMessage: false,
    onError: (message) => setRefused(message ?? "That key was not saved."),
    onOk: () => {
      revalidate(queryKey.config);
      revalidate(queryKey.llmModel);
    },
  });

  const ready = (name: string) => (drafts[name]?.trim().length ?? 0) >= KEY_MIN;

  /** Saves one field. Why it failed shows under it. */
  const commit = async (provider: typeof LIVE_PROVIDER) => {
    const name = provider.apiKeyName;
    if (!ready(name) || saving) return false;
    setRefused(null);
    setSaving(name);
    try {
      await save(name, drafts[name]);
      setDrafts((all) => ({ ...all, [name]: "" }));
      onSaved?.(provider.id);
      return true;
    } catch {
      return false;
    } finally {
      setSaving(null);
    }
  };

  useImperativeHandle(ref, () => ({
    pending: () => ready(LIVE_PROVIDER.apiKeyName),
    flush: async () => {
      return ready(LIVE_PROVIDER.apiKeyName) ? commit(LIVE_PROVIDER) : true;
    },
  }));

  return (
    <div className={cn("w-full", dense ? "space-y-2" : "space-y-4", className)}>
      {dense && !plain && (
        <div className="flex h-6 items-center justify-between gap-2">
          <span className="px-0.5 font-mono text-[11px] text-muted-foreground">
            Voice key
          </span>
          {onCancel && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Not now"
              onClick={onCancel}
              className="-my-1 size-6"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      )}

      <KeyField
        provider={LIVE_PROVIDER}
        saved={isConfigSet(config, LIVE_PROVIDER.apiKeyName)}
        autoFocus={autoFocus}
        dense={dense}
        plain={plain}
        value={drafts[LIVE_PROVIDER.apiKeyName] ?? ""}
        ready={ready(LIVE_PROVIDER.apiKeyName)}
        saving={saving === LIVE_PROVIDER.apiKeyName}
        onValue={(next) => {
          setRefused(null);
          setDrafts((all) => ({ ...all, [LIVE_PROVIDER.apiKeyName]: next }));
        }}
        onSubmit={() => void commit(LIVE_PROVIDER)}
      />

      {(refused || isConfigUnreadable(config, LIVE_PROVIDER.apiKeyName)) && (
        <p
          className={cn(
            "px-0.5 leading-5 break-words",
            dense ? "text-xs" : "text-center text-[13px]",
            WAITING_INK,
          )}
        >
          {/* A key saved before that can no longer be opened is asked for again, saying why */}
          {refused ??
            lostWords("The OpenAI key saved before", "Paste it again.")}
        </p>
      )}

      {!plain && (
        <p
          className={cn(
            "px-0.5 font-mono text-muted-foreground",
            dense ? "text-[11px]" : "pt-1 text-center text-[12.5px]",
          )}
        >
          {dense
            ? "Live voice and reasoning share this OpenAI API key."
            : "Live uses an OpenAI API key, billed separately from ChatGPT. Stored on this machine, in this app's database."}
        </p>
      )}
    </div>
  );
}

function KeyField({
  provider,
  saved,
  autoFocus,
  dense,
  plain,
  value,
  ready,
  saving,
  onValue,
  onSubmit,
}: {
  provider: typeof LIVE_PROVIDER;
  saved: boolean;
  autoFocus?: boolean;
  dense?: boolean;
  plain?: boolean;
  value: string;
  ready: boolean;
  saving: boolean;
  onValue: (next: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-2">
      {!plain && (
        <span className="flex items-center gap-2 px-0.5 text-muted-foreground">
          <ProviderIcon provider={provider.id} className="size-4 shrink-0" />
          <span
            className={cn("font-mono", dense ? "text-[11px]" : "text-[12.5px]")}
          >
            {provider.label}
          </span>
        </span>
      )}

      <KeyInput
        provider={provider}
        saved={saved}
        autoFocus={autoFocus}
        dense={dense}
        mark={plain}
        value={value}
        ready={ready}
        saving={saving}
        onValue={onValue}
        onSubmit={onSubmit}
      />
    </div>
  );
}

/** How a provider's keys begin, from the catalogue's `keyLooks` ("xai-…" → "xai-"). */
const prefixOf = (looks?: string) => looks?.replace(/…$/, "") ?? "";

/**
 * How every other provider's keys begin, read off the one catalogue. A prefix this provider's
 * own keys also begin with (DeepSeek's "sk-" beside OpenAI's) tells nothing and is left out.
 */
const otherPrefixes = (id: TextModelProviderId) => {
  const own = prefixOf(TEXT_MODEL_PROVIDERS[id].keyLooks);
  return Object.entries(TEXT_MODEL_PROVIDERS).flatMap(([other, entry]) => {
    const prefix = prefixOf(entry.keyLooks);
    return other !== id && prefix && !own.startsWith(prefix) ? [prefix] : [];
  });
};

/** Just the field and its save button, no provider label — for a spot that already shows one. */
export function KeyInput({
  provider,
  saved,
  autoFocus,
  dense,
  mark,
  value,
  ready,
  saving,
  onValue,
  onSubmit,
}: {
  provider: typeof LIVE_PROVIDER;
  saved: boolean;
  autoFocus?: boolean;
  dense?: boolean;
  /** The provider's mark at the start of the field. */
  mark?: boolean;
  value: string;
  ready: boolean;
  saving: boolean;
  onValue: (next: string) => void;
  onSubmit: () => void;
}) {
  // A mismatch warns but never blocks: key prefixes change
  const mismatch = otherPrefixes(provider.id).some((prefix) =>
    value.trim().startsWith(prefix),
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className={cn(
        "flex items-center gap-3 rounded-2xl border bg-muted/40 px-4 transition-colors",
        dense ? "h-11 rounded-xl px-3" : "h-14",
        saved || ready ? "border-foreground bg-transparent" : "border-border",
      )}
    >
      {mark && (
        <ProviderIcon
          provider={provider.id}
          className="size-4 shrink-0 text-muted-foreground"
        />
      )}
      <Input
        autoFocus={autoFocus}
        type="password"
        aria-label="OpenAI API key"
        autoComplete="off"
        value={value}
        spellCheck={false}
        placeholder={saved ? "Replace it" : "sk-…"}
        onChange={(event) => onValue(event.target.value)}
        className={cn(
          // shadcn's input paints its own dark background (`dark:bg-input/30`)
          "min-w-0 flex-1 border-0 bg-transparent px-0 font-mono shadow-none focus-visible:ring-0 dark:bg-transparent",
          dense ? "h-7 text-[13px]" : "h-9 text-[15px]",
        )}
      />

      {value ? (
        <Button
          type="submit"
          size="sm"
          variant={mismatch ? "outline" : "default"}
          loading={saving}
          disabled={!ready}
          className={cn("shrink-0", dense ? "h-7 px-3" : "h-9 px-4")}
        >
          {mismatch ? `Not ${provider.label}?` : "Save"}
        </Button>
      ) : (
        saved && (
          <span
            className={cn(
              "grid shrink-0 animate-in place-items-center rounded-full bg-foreground text-background zoom-in-50 duration-300",
              dense ? "size-5" : "size-7",
            )}
          >
            <Check className={dense ? "size-3" : "size-4"} />
          </span>
        )
      )}
    </form>
  );
}
