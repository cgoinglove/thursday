"use client";

import { Check, X } from "lucide-react";
import { type Ref, useImperativeHandle, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProviderIcon } from "@/features/ai/components/provider-icon";
import {
  detectSpeachProvider,
  SPEACH_MODEL_PROVIDER_LIST,
  type SpeachModelProviderId,
} from "@/features/ai/model.schema";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";
import { setConfigAction } from "../config.action";
import { type ConfigStatus, isConfigSet } from "../config.const";

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

/** Shorter than this is not a key: no save button, no prompt on leaving. */
export const KEY_MIN = 8;

/** One field per voice provider. Used by the intro and by the call screen while no key is set. */
export function VoiceKeys({
  ref,
  autoFocus,
  /** Compact layout for the call screen. */
  dense = false,
  onCancel,
  onSaved,
  className,
}: {
  ref?: Ref<VoiceKeysHandle>;
  autoFocus?: boolean;
  dense?: boolean;
  onCancel?: () => void;
  onSaved?: (provider: SpeachModelProviderId) => void;
  className?: string;
}) {
  const { data: config } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const [save] = useServerAction(setConfigAction, {
    onOk: () => {
      revalidate(queryKey.config);
      revalidate(queryKey.llmModel);
    },
  });

  const ready = (name: string) => (drafts[name]?.trim().length ?? 0) >= KEY_MIN;

  /** Saves one field. Failure is already toasted by the hook. */
  const commit = async (
    provider: (typeof SPEACH_MODEL_PROVIDER_LIST)[number],
  ) => {
    const name = provider.apiKeyName;
    if (!ready(name) || saving) return false;
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
    pending: () =>
      SPEACH_MODEL_PROVIDER_LIST.some((provider) => ready(provider.apiKeyName)),
    flush: async () => {
      for (const provider of SPEACH_MODEL_PROVIDER_LIST) {
        if (!ready(provider.apiKeyName)) continue;
        if (!(await commit(provider))) return false;
      }
      return true;
    },
  }));

  return (
    <div className={cn("w-full", dense ? "space-y-2" : "space-y-4", className)}>
      {dense && (
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

      {SPEACH_MODEL_PROVIDER_LIST.map((provider, index) => (
        <KeyField
          key={provider.id}
          provider={provider}
          saved={isConfigSet(config, provider.apiKeyName)}
          autoFocus={autoFocus && index === 0}
          dense={dense}
          value={drafts[provider.apiKeyName] ?? ""}
          ready={ready(provider.apiKeyName)}
          saving={saving === provider.apiKeyName}
          onValue={(next) =>
            setDrafts((all) => ({ ...all, [provider.apiKeyName]: next }))
          }
          onSubmit={() => void commit(provider)}
        />
      ))}

      <p
        className={cn(
          "px-0.5 font-mono text-muted-foreground",
          dense ? "text-[11px]" : "pt-1 text-center text-[12.5px]",
        )}
      >
        {dense
          ? "One is enough."
          : "One is enough — the other can wait. Stored on this machine, in this app's own database."}
      </p>
    </div>
  );
}

function KeyField({
  provider,
  saved,
  autoFocus,
  dense,
  value,
  ready,
  saving,
  onValue,
  onSubmit,
}: {
  provider: (typeof SPEACH_MODEL_PROVIDER_LIST)[number];
  saved: boolean;
  autoFocus?: boolean;
  dense?: boolean;
  value: string;
  ready: boolean;
  saving: boolean;
  onValue: (next: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-2">
      <span className="flex items-center gap-2 px-0.5 text-muted-foreground">
        <ProviderIcon provider={provider.id} className="size-4 shrink-0" />
        <span
          className={cn("font-mono", dense ? "text-[11px]" : "text-[12.5px]")}
        >
          {provider.label}
        </span>
      </span>

      <KeyInput
        provider={provider}
        saved={saved}
        autoFocus={autoFocus}
        dense={dense}
        value={value}
        ready={ready}
        saving={saving}
        onValue={onValue}
        onSubmit={onSubmit}
      />
    </div>
  );
}

/** Just the field and its save button, no provider label — for a spot that already shows one. */
export function KeyInput({
  provider,
  saved,
  autoFocus,
  dense,
  value,
  ready,
  saving,
  onValue,
  onSubmit,
}: {
  provider: (typeof SPEACH_MODEL_PROVIDER_LIST)[number];
  saved: boolean;
  autoFocus?: boolean;
  dense?: boolean;
  value: string;
  ready: boolean;
  saving: boolean;
  onValue: (next: string) => void;
  onSubmit: () => void;
}) {
  // A mismatch warns but never blocks: key prefixes change
  const looksLike = detectSpeachProvider(value);
  const mismatch = looksLike !== null && looksLike !== provider.id;

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
      <Input
        autoFocus={autoFocus}
        type="password"
        value={value}
        spellCheck={false}
        placeholder={saved ? "Replace it" : `${provider.keyPrefix[0]}…`}
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
