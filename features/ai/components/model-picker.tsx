"use client";

import { Check, ChevronsUpDown, CircleDashed, KeyRound } from "lucide-react";
import { useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { setConfigAction } from "@/features/config/config.action";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";
import type {
  AiProvider,
  GatewayModel,
  MediaKind,
  TextModelProviderId,
} from "../model.schema";
import {
  canMakeKind,
  MEDIA_MODEL_PROVIDERS,
  TEXT_MODEL_PROVIDERS,
} from "../model.schema";
import { ChatGptSignIn } from "./chatgpt-sign-in";
import { ModelBrowser } from "./model-browser";
import { ProviderIcon } from "./provider-icon";

/**
 * A provider and its model behind one button, so the field is one width whatever is picked.
 * It opens on two columns: the providers, and what the one in hand offers — its suggested
 * models, a field for an id that is not on the list, or the way to its key when it has none.
 * Looking at another provider changes nothing; a pick is a model. The gateway's column is
 * the shelf (`ModelBrowser`), because its list is hundreds of priced rows.
 */
export function ModelPicker({
  provider,
  model,
  kind,
  unset,
  onChange,
  onUnset,
  compact = false,
}: {
  provider: TextModelProviderId | null;
  model: string;
  /** What no provider reads as, when the caller has no default to fall back to. */
  unset?: string;
  /** What the model makes. Absent means a text model (bots, calls); set, only providers and suggestions for that kind remain. */
  kind?: MediaKind;
  onChange: (next: { provider: TextModelProviderId; model: string }) => void;
  /**
   * Given, the list opens with the unset choice (`unset`, else App default) and this takes the
   * pick back to it; without it a pick, once made, can only be changed for another.
   */
  onUnset?: () => void;
  /** A small pill for a line of fine print (the write line) rather than a form's field. */
  compact?: boolean;
}) {
  const { data: all = [], mutate } = useServerRoute<AiProvider[]>(
    queryKey.llmModel,
  );
  // Only providers that can make this kind (canMakeKind); otherwise the screen offers a value that cannot be saved (config.const acceptsChoice)
  const providers = kind
    ? all.filter((entry) => canMakeKind(entry.id, kind))
    : all;
  const picked = providers.find((entry) => entry.id === provider);

  const [open, setOpen] = useState(false);
  /** The provider being looked at while open; nothing is saved until a model is picked. */
  const [looking, setLooking] = useState<TextModelProviderId | null>(null);
  const [typed, setTyped] = useState("");
  const shown =
    providers.find((entry) => entry.id === (looking ?? provider)) ??
    providers[0];

  const gateway = shown?.id === "vercel-ai-gateway";
  // The listing answers without a key (ai/model readGatewayCatalog), so the shelf is
  // browsable while the key row asks
  const catalog = useServerRoute<GatewayModel[]>(
    open && gateway && queryKey.modelCatalog,
  );

  const modelsOf = (entry?: AiProvider) =>
    kind && entry
      ? (MEDIA_MODEL_PROVIDERS[entry.id as keyof typeof MEDIA_MODEL_PROVIDERS]
          ?.models[kind] ?? [])
      : (entry?.suggestModels ?? []);
  const current = modelsOf(picked).find((entry) => entry.id === model);

  const pick = (next: string) => {
    if (!shown || !next.trim()) return;
    onChange({ provider: shown.id, model: next.trim() });
    setTyped("");
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setLooking(null);
      }}
    >
      <PopoverTrigger
        render={
          compact ? (
            <button
              type="button"
              className="inline-flex h-5 max-w-64 items-center gap-1.5 rounded-full px-2 text-foreground/80 ring-1 ring-border outline-none ring-inset transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          ) : (
            <Button
              variant="outline"
              className="w-full min-w-0 justify-start gap-2 font-normal"
            />
          )
        }
      >
        {picked ? (
          <>
            <ProviderIcon
              provider={picked.id}
              className={cn("shrink-0", compact ? "size-3" : "size-4")}
            />
            {!compact && (
              // Only the room the model leaves: the icon still names the provider
              <span className="min-w-0 max-w-fit grow basis-0 truncate text-muted-foreground">
                {picked.label}
                <span className="ml-2 text-muted-foreground/40">·</span>
              </span>
            )}
            <span className={cn("truncate", !compact && "font-medium")}>
              {current?.label ?? (model || "Pick a model")}
            </span>
          </>
        ) : (
          // Unset is a value, not a blank: a text model falls back to the app
          // default (model.ts resolveDefaultModel), a media kind is simply not offered
          <span className="truncate text-muted-foreground">
            {unset ?? (kind ? "Not picked" : "App default")}
          </span>
        )}
        <ChevronsUpDown
          className={cn(
            "ml-auto shrink-0 text-muted-foreground",
            compact ? "size-2.5" : "size-3.5",
          )}
        />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="flex w-[min(34rem,calc(100vw-2rem))] flex-row gap-0 overflow-hidden rounded-2xl p-0"
      >
        <div className="flex max-h-80 w-48 shrink-0 flex-col gap-px overflow-y-auto border-r border-border/60 bg-muted/40 p-1.5">
          {onUnset && (
            <button
              type="button"
              onClick={() => {
                onUnset();
                setOpen(false);
              }}
              className={cn(
                "mb-1 flex h-8.5 shrink-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                picked ? "hover:bg-muted/60" : "bg-muted font-medium",
              )}
            >
              <CircleDashed className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {unset ?? (kind ? "Not picked" : "App default")}
              </span>
              {!picked && <Check className="size-3.5 shrink-0" />}
            </button>
          )}
          {providers.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setLooking(entry.id)}
              className={cn(
                "flex h-8.5 shrink-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                entry.id === shown?.id
                  ? "bg-muted font-medium"
                  : "hover:bg-muted/60",
                !entry.hasKey && "text-muted-foreground",
              )}
            >
              <ProviderIcon provider={entry.id} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {!entry.hasKey && <KeyRound className="size-3 shrink-0" />}
            </button>
          ))}
        </div>

        <div className="flex max-h-80 min-w-0 flex-1 flex-col gap-px overflow-y-auto p-1.5">
          {!shown ? null : !shown.hasKey ? (
            <div className="space-y-2 p-2">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {shown.label} has no key yet.
              </p>
              <AskForKey provider={shown} onSaved={() => mutate()} />
            </div>
          ) : gateway && !catalog.error ? (
            <div className="space-y-2 p-2">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Every model the gateway carries, with what each costs.
              </p>
              <ModelBrowser
                models={catalog.data ?? []}
                kind={kind}
                value={shown.id === provider ? model : ""}
                loading={catalog.isLoading}
                onPick={pick}
              />
            </div>
          ) : (
            <>
              {modelsOf(shown).map((entry) => {
                const on = shown.id === provider && entry.id === model;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => pick(entry.id)}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                      on ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium">
                        <span className="truncate">{entry.label}</span>
                        <Tier tier={entry.tier} />
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                        {entry.id}
                      </span>
                    </span>
                    {on && <Check className="size-3.5 shrink-0" />}
                  </button>
                );
              })}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  pick(typed);
                }}
                className="mt-1 px-1 pb-1"
              >
                <Input
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  spellCheck={false}
                  aria-label="Model id"
                  placeholder={
                    catalog.error
                      ? "Could not read the catalog — type an id"
                      : "or type a model id"
                  }
                  className="h-8 font-mono text-xs"
                />
              </form>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Tier({ tier }: { tier: string }) {
  return (
    <span className="shrink-0 rounded-full px-1.5 font-mono text-[9.5px] leading-4 font-normal text-muted-foreground ring-1 ring-border ring-inset">
      {tier}
    </span>
  );
}

/** Without a key there is no model; the only useful thing to do here is fix that. */
function AskForKey({
  provider,
  onSaved,
}: {
  provider: AiProvider;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [save, saving] = useServerAction(setConfigAction, {
    okMessage: `${provider.label} key saved`,
    onOk: () => {
      revalidate(queryKey.llmModel);
      revalidate(queryKey.config);
      onSaved();
    },
  });

  // Signed in to, not typed; the sign-in's `config` signal re-reads hasKey and this goes away
  if (provider.signIn) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="px-1 font-mono text-[11px] text-muted-foreground">
          Runs on your plan once you sign in
        </p>
        <ChatGptSignIn variant="outline" />
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={
          TEXT_MODEL_PROVIDERS[provider.id].keyLooks ?? "Paste the key"
        }
        spellCheck={false}
        type="password"
      />
      <Button
        variant="outline"
        loading={saving}
        disabled={value.trim().length < 8}
        onClick={() => save(provider.apiKeyName, value)}
      >
        Save key
      </Button>
    </div>
  );
}
