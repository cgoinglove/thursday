"use client";

import { Check, ChevronDown, KeyRound } from "lucide-react";
import { useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { setConfigAction } from "@/features/config/config.action";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import type {
  AiProvider,
  GatewayModel,
  MediaKind,
  TextModelProviderId,
} from "../model.schema";
import { canMakeKind, MEDIA_MODEL_PROVIDERS } from "../model.schema";
import { ChatGptSignIn } from "./chatgpt-sign-in";
import { ModelBrowser } from "./model-browser";
import { ProviderIcon } from "./provider-icon";

/**
 * Picks a provider, then a model id. The model field is a combobox so an id not on the
 * suggestion list can still be typed. The gateway is the exception: its field is the
 * shelf (`ModelBrowser`), because its list is hundreds of priced rows and typing is
 * done inside that dialog. A provider without a key asks for it in place.
 */
export function ModelPicker({
  provider,
  model,
  kind,
  unset,
  onChange,
}: {
  provider: TextModelProviderId | null;
  model: string;
  /** What no provider reads as, when the caller has no default to fall back to. */
  unset?: string;
  /** What the model makes. Absent means a text model (bots, calls); set, only providers and suggestions for that kind remain. */
  kind?: MediaKind;
  onChange: (next: { provider: TextModelProviderId; model: string }) => void;
}) {
  const { data: all = [], mutate } = useServerRoute<AiProvider[]>(
    queryKey.llmModel,
  );
  // Only providers that can make this kind (canMakeKind); otherwise the screen offers a value that cannot be saved (config.const acceptsChoice)
  const providers = kind
    ? all.filter((entry) => canMakeKind(entry.id, kind))
    : all;
  const picked = providers.find((entry) => entry.id === provider);

  const gateway = provider === "vercel-ai-gateway";
  // The listing answers without a key (ai/model readGatewayCatalog), so it is read as
  // soon as the gateway is the provider — the shelf is browsable while the key row asks.
  const catalog = useServerRoute<GatewayModel[]>(
    gateway && queryKey.modelCatalog,
  );

  const suggestModels =
    kind && picked
      ? (MEDIA_MODEL_PROVIDERS[picked.id as keyof typeof MEDIA_MODEL_PROVIDERS]
          ?.models[kind] ?? [])
      : (picked?.suggestModels ?? []);

  // Hand-written rows, for the field that takes typing. The gateway's live list is not
  // merged in here: it is the shelf's, which reads the same catalog and prices it.
  const options: ComboboxOption[] = suggestModels.map((entry) => ({
    value: entry.id,
    label: entry.label,
    badge: entry.tier,
    hint: entry.id,
  }));

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" className="shrink-0" />}
          >
            {picked ? (
              <>
                <ProviderIcon provider={picked.id} className="size-4" />
                {picked.label}
              </>
            ) : (
              // Unset is a value, not a blank: a text model falls back to the app
              // default (model.ts resolveDefaultModel), a media kind is simply not offered
              <span className="text-muted-foreground">
                {unset ?? (kind ? "Not picked" : "App default")}
              </span>
            )}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {providers.map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                onClick={() => onChange({ provider: entry.id, model: "" })}
              >
                <ProviderIcon provider={entry.id} className="size-4" />
                {entry.label}
                {entry.hasKey ? (
                  entry.id === provider && (
                    <Check className="ml-auto size-3.5" />
                  )
                ) : (
                  <KeyRound className="ml-auto size-3 text-muted-foreground" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* The shelf lists without a key, so it stands while the key row below is
            still asking. A catalog that could not be read has no shelf to be, and the
            combobox takes the slot back so an id can still be typed. */}
        {gateway && picked && !catalog.error ? (
          <ModelBrowser
            models={catalog.data ?? []}
            kind={kind}
            value={model}
            loading={catalog.isLoading}
            onPick={(next) => onChange({ provider: picked.id, model: next })}
          />
        ) : (
          <Combobox
            value={model}
            onChange={(next) =>
              picked && onChange({ provider: picked.id, model: next })
            }
            options={options}
            disabled={!picked?.hasKey}
            aria-label="Model"
            placeholder={picked ? "Type a model id" : "Pick a provider"}
            empty={
              catalog.error
                ? "Could not read the catalog — type an id"
                : "Not on the list — it still runs"
            }
            className="flex-1"
          />
        )}
      </div>

      {picked && !picked.hasKey && (
        <AskForKey provider={picked} onSaved={() => mutate()} />
      )}

      {gateway && catalog.error && (
        <p className="px-1 font-mono text-[11px] text-destructive">
          {catalog.error.message}
        </p>
      )}
    </div>
  );
}

/** Without a key there is no model; the only useful thing to do here is fix that. */
export function AskForKey({
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
        placeholder={provider.apiKeyName}
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
