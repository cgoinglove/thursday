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
import {
  canMakeKind,
  GATEWAY_TEXT,
  MEDIA_MODEL_PROVIDERS,
} from "../model.schema";
import { ProviderIcon } from "./provider-icon";

/**
 * Picks a provider, then a model id. The model field is a combobox so an id not on the
 * suggestion list can still be typed; the gateway's list is live. A provider without a key
 * asks for it in place.
 */
export function ModelPicker({
  provider,
  model,
  kind,
  onChange,
}: {
  provider: TextModelProviderId | null;
  model: string;
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
  const catalog = useServerRoute<GatewayModel[]>(
    gateway && picked?.hasKey && queryKey.modelCatalog,
  );

  const suggestModels =
    kind && picked
      ? (MEDIA_MODEL_PROVIDERS[picked.id as keyof typeof MEDIA_MODEL_PROVIDERS]
          ?.models[kind] ?? [])
      : (picked?.suggestModels ?? []);

  const suggested: ComboboxOption[] = suggestModels.map((entry) => ({
    value: entry.id,
    label: entry.label,
    badge: entry.tier,
    hint: entry.id,
  }));
  const live: ComboboxOption[] = (catalog.data ?? [])
    // The gateway lists every kind in one listing; each row arrives with its kind
    // already settled (ai/model readGatewayCatalog), so this field is the whole rule
    .filter((entry) => entry.type === (kind ?? GATEWAY_TEXT))
    .map((entry) => ({
      value: entry.id,
      label: entry.label,
      hint: entry.id,
    }));

  // For text the live gateway list wins over the suggestions — 226 rows against ten
  // written by hand. For media both are merged, hand-checked rows first: those carry a
  // label and a size, and are ordered by price, which the live listing cannot be
  const options = !gateway
    ? suggested
    : kind
      ? [
          ...suggested,
          ...live.filter(
            (entry) => !suggested.some((row) => row.value === entry.value),
          ),
        ]
      : live.length > 0
        ? live
        : suggested;

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
              // Unset is a value, not a blank: the run asks the app default (model.ts resolveDefaultModel, resolveMediaRef)
              <span className="text-muted-foreground">App default</span>
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

        <Combobox
          value={model}
          onChange={(next) =>
            picked && onChange({ provider: picked.id, model: next })
          }
          options={options}
          disabled={!picked?.hasKey}
          loading={gateway && catalog.isLoading}
          aria-label="Model"
          placeholder={
            picked
              ? gateway
                ? "Search, or type any model id"
                : "Type a model id"
              : "Pick a provider"
          }
          empty={
            // Three reasons a list is empty, three messages
            catalog.error
              ? "Could not read the catalog — type an id"
              : gateway
                ? "Nothing matches"
                : "Not on the list — it still runs"
          }
          className="flex-1"
        />
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
