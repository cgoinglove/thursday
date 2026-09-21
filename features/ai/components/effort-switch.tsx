"use client";

import { useEffect } from "react";
import { queryKey } from "@/app/api/query-key";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";
import type {
  Effort,
  GatewayModel,
  TextModelProviderId,
} from "../model.schema";
import { effortsOf } from "../model.schema";

/** The track is this tall, and the knob is the track (features/ai/components/effort-switch). */
const TRACK = 24;
const WIDTH = 132;

/**
 * How hard a model is set to think: the steps that model takes, on one short switch that rides
 * beside the model it belongs to rather than taking a row of its own.
 *
 * `auto` is not one of them — it sets nothing and leaves the model to decide, which is a different
 * kind of answer from `none` ("do not think") — so it stands outside the track as its own button
 * and the track holds the ladder alone. The ramp is laid across the whole track rather than across
 * the filled part, so a step is the same colour wherever the knob stands; under `auto` the whole
 * ramp shows as a ghost, since the model may end up anywhere on it.
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
  className,
}: {
  provider: TextModelProviderId | null;
  model: string;
  value: Effort | null;
  onChange: (next: Effort | null) => void;
  className?: string;
}) {
  // The gateway is the one provider that answers at run time; the rest carry their ladder on the shelf
  const gateway = provider === "vercel-ai-gateway";
  const { data: catalog } = useServerRoute<GatewayModel[]>(
    gateway && model ? queryKey.modelCatalog : null,
  );
  const chosen = Boolean(provider && model);
  const ladder =
    chosen && provider ? effortsOf(provider, model, catalog ?? []) : null;

  // A step this model does not take is not a step: the run would drop it and the knob has nowhere
  // to stand, so the value goes rather than sitting behind an Auto nobody can see. Only where the
  // ladder is known — unknown is "nobody has checked", which is not a reason to throw a value away.
  useEffect(() => {
    if (value && ladder && !ladder.includes(value)) onChange(null);
  }, [value, ladder, onChange]);

  const stops = ladder ?? [];
  const auto = !value || !stops.includes(value);
  const at = auto ? 0 : stops.indexOf(value as Effort);
  const last = Math.max(0, stops.length - 1);
  const part = last ? at / last : 0;
  const step = auto ? null : stops[at];
  /** `none` is the bottom of the ladder, not a quantity: it paints nothing. */
  const lit = step && step !== "none" ? step : null;

  // Where the knob's centre lands, and the ramp stretched back to the track from the slice that shows
  const along = `calc(${TRACK / 2}px + (100% - ${TRACK}px) * ${part})`;
  // The ramp runs past the box so the drift never walks an edge into view
  const ramp =
    part > 0
      ? `calc((100% - ${TRACK / 2}px) / ${part} + ${TRACK * 2 + 20}px) 100%`
      : "calc(100% + 32px) 100%";

  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      {/* Outside the track on purpose: auto sets nothing, so it is no rung of the ladder */}
      <button
        type="button"
        aria-pressed={auto}
        disabled={!stops.length}
        title={chosen ? ladderNote(ladder) : "Pick a model first"}
        onClick={() => onChange(auto ? (stops[0] ?? null) : null)}
        className={cn(
          "h-6 shrink-0 rounded-full px-2.5 text-[11px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
          // The track is already `muted`, so the button says "on" with an outline rather than a fill
          auto
            ? "bg-background font-medium text-foreground ring-1 ring-border"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Auto
      </button>

      <div
        className="relative shrink-0"
        style={{ width: WIDTH, height: TRACK }}
      >
        <div className="absolute inset-0 rounded-full bg-muted ring-1 ring-border ring-inset" />
        <div
          data-effort-fill
          className={cn(
            "absolute inset-y-0 left-0 animate-effort rounded-l-full bg-no-repeat transition-[width,opacity] duration-300 ease-out",
            auto && "rounded-r-full",
          )}
          style={{
            width: auto ? "100%" : along,
            opacity: auto ? 0.35 : lit ? 1 : 0,
            backgroundImage: `linear-gradient(90deg, var(--effort-minimal) 0%, var(--effort-${stops[last] ?? "xhigh"}) 100%)`,
            backgroundSize: auto ? "calc(100% + 32px) 100%" : ramp,
          }}
        />
        <span
          // The knob is the track's own height: anything smaller lets the fill show around it
          className="pointer-events-none absolute top-0 rounded-full bg-background shadow-[0_1px_3px_rgb(0_0_0/20%)] ring-1 ring-border transition-[left] duration-300 ease-out dark:bg-foreground"
          style={{
            width: TRACK,
            height: TRACK,
            left: `calc((100% - ${TRACK}px) * ${auto ? 0 : part})`,
          }}
        />
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={at}
          disabled={!stops.length}
          aria-label="Thinking effort"
          aria-valuetext={EFFORT_LABEL[step ?? "auto"]}
          onChange={(event) => onChange(stops[Number(event.target.value)])}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-default"
        />
      </div>

      <span
        className={cn(
          "w-[68px] shrink-0 text-[11.5px]",
          lit
            ? "bg-clip-text font-medium text-transparent"
            : "text-muted-foreground",
        )}
        style={
          lit
            ? {
                backgroundImage: `linear-gradient(100deg, var(--brand) 0%, var(--effort-${lit}) 90%)`,
              }
            : undefined
        }
      >
        {EFFORT_LABEL[step ?? "auto"]}
      </span>
    </div>
  );
}

/** Auto is not a step of the ladder: it sets nothing and the model runs on its own default. */
const EFFORT_LABEL: Record<Effort | "auto", string> = {
  auto: "Auto",
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
};

/** What the button's tooltip says: how many steps there are, or why there are none. */
function ladderNote(ladder: readonly Effort[] | null): string {
  if (ladder === null) return "This model's steps are unknown";
  if (ladder.length === 0) return "This model has no effort to set";
  return `${ladder.length} steps, plus Auto`;
}
