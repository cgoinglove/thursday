"use client";

import { useEffect, useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Segmented } from "@/components/ui/segmented";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import type {
  Effort,
  GatewayModel,
  TextModelProviderId,
} from "../model.schema";
import { effortsOf } from "../model.schema";

/**
 * How hard a model is set to think: the steps that model takes, as one button group beside the
 * model it belongs to. A step is a value to pick, like every other `Segmented` here, so the one
 * set is the brand's.
 *
 * `auto` is not one of the steps — it sets nothing and leaves the model to decide, which is a
 * different kind of answer from `none` ("do not think") — so it leads the group rather than
 * sitting in the ladder's order.
 *
 * A model whose ladder nobody knows offers `auto` alone: a step a provider hands straight to its
 * API fails the whole call, so it is never offered on a guess (ai/model runEffort drops it too).
 * A model picked while a step is set takes the step with it where its own ladder holds it, and
 * gives it up where it does not — one place, so every screen that sets one behaves the same.
 */
export function EffortSwitch({
  provider,
  model,
  value,
  onChange,
}: {
  provider: TextModelProviderId | null;
  model: string;
  value: Effort | null;
  onChange: (next: Effort | null) => void;
}) {
  // The gateway is the one provider that answers at run time; the rest carry their ladder on the shelf
  const gateway = provider === "vercel-ai-gateway";
  const { data: catalog } = useServerRoute<GatewayModel[]>(
    gateway && model ? queryKey.modelCatalog : null,
  );
  const chosen = Boolean(provider && model);
  const ladder =
    chosen && provider ? effortsOf(provider, model, catalog ?? []) : null;

  // A step this model does not take is not a step: the run would drop it and no button stands for
  // it, so the value goes rather than sitting behind an Auto nobody can see. Only where the
  // ladder is known — unknown is "nobody has checked", which is not a reason to throw a value away.
  useEffect(() => {
    if (value && ladder && !ladder.includes(value)) onChange(null);
  }, [value, ladder, onChange]);

  // What the last press asked for, until the screen's own value catches up. A screen that keeps
  // this on the server (Settings > Models) hands back the stored value, so between the press and
  // the write landing the group would draw the step before it — one button, then the other.
  // A write that fails leaves the press showing until the value moves; the failure toasts.
  const [pressed, setPressed] = useState<{ step: Effort | null } | null>(null);
  useEffect(() => {
    setPressed((last) => (last && last.step === value ? null : last));
  }, [value]);
  const shown = pressed ? pressed.step : value;

  const stops = ladder ?? [];
  const auto = !shown || !stops.includes(shown);

  return (
    // The group is as wide as its steps rather than stretched to the column, since a model whose
    // ladder nobody knows offers `auto` alone and a lone stretched button reads as a bar. The note
    // sits on the group rather than on `auto`, for the same reason: it is the whole row's.
    <div
      className="min-w-0"
      title={chosen ? ladderNote(ladder) : "Pick a model first"}
    >
      <Segmented
        aria-label="Thinking effort"
        className="max-w-full flex-wrap"
        options={[
          { value: "auto", label: "auto", title: "The model's own default" },
          ...stops.map((step) => ({
            value: step,
            label: step,
            title: `Thinking effort ${step}`,
          })),
        ]}
        value={auto ? "auto" : (shown as Effort)}
        onChange={(next) => {
          const step = next === "auto" ? null : next;
          setPressed({ step });
          onChange(step);
        }}
      />
    </div>
  );
}

/** What the group's tooltip says: how many steps there are, or why there are none. */
function ladderNote(ladder: readonly Effort[] | null): string {
  if (ladder === null) return "This model's steps are unknown";
  if (ladder.length === 0) return "This model has no effort to set";
  return `${ladder.length} steps, plus Auto`;
}
