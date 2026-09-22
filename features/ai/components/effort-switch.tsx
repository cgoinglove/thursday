"use client";

import { useEffect, useRef } from "react";
import { queryKey } from "@/app/api/query-key";
import { Switch } from "@/components/ui/switch";
import { useIsDark } from "@/hooks/use-theme";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";
import type {
  Effort,
  GatewayModel,
  TextModelProviderId,
} from "../model.schema";
import { effortsOf } from "../model.schema";

/** The track is this long and this tall; the knob is the track's own height. */
const TRACK = 96;
const KNOB = 18;

/** How long one body of light takes to cross the fill, and how many there are. */
const BODIES = 7;

/**
 * How hard a model is set to think: the steps that model takes, on one short switch that rides
 * beside the model it belongs to rather than taking a row of its own.
 *
 * `auto` is not one of them — it sets nothing and leaves the model to decide, which is a different
 * kind of answer from `none` ("do not think") — so it is a toggle beside the switch's name rather
 * than a rung, and under it the fill shows as a ghost, since the model may end up anywhere on it.
 * The track carries a dot at every step that model takes, so two steps and six read the same.
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
  label = "effort",
}: {
  provider: TextModelProviderId | null;
  model: string;
  value: Effort | null;
  onChange: (next: Effort | null) => void;
  className?: string;
  /** What the switch calls itself; every screen shows the same word. */
  label?: string;
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

  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      <span className="font-mono text-[11px] text-muted-foreground">
        {label}
      </span>
      {/* Auto sets nothing, so it is a switch of its own rather than a rung of the ladder */}
      <Switch
        size="sm"
        checked={auto}
        disabled={!stops.length}
        aria-label="Let the model decide"
        title={chosen ? ladderNote(ladder) : "Pick a model first"}
        onCheckedChange={(on) => onChange(on ? null : (stops[0] ?? null))}
      />
      <span
        className={cn(
          "mr-0.5 text-[11px]",
          auto ? "text-foreground" : "text-muted-foreground",
        )}
      >
        Auto
      </span>

      <div className="relative shrink-0" style={{ width: TRACK, height: KNOB }}>
        <div className="absolute inset-0 rounded-full bg-muted ring-1 ring-border ring-inset" />
        {(lit || auto) && stops.length > 0 && (
          <Fill
            step={lit}
            width={auto ? TRACK : Math.round(KNOB + (TRACK - KNOB) * part)}
          />
        )}
        {/* A dot for every step this model takes: where the knob can stand, and how many there
            are. Over the fill, which is painted, so the ones already climbed still show. */}
        {stops.map((one, index) => (
          <span
            key={one}
            className={cn(
              "pointer-events-none absolute top-1/2 z-[1] -mt-px -ml-px size-0.5 rounded-full",
              !auto && index <= at ? "bg-background/80" : "bg-foreground/20",
            )}
            style={{
              left: `calc(${KNOB / 2}px + (100% - ${KNOB}px) * ${last ? index / last : 0})`,
            }}
          />
        ))}
        <span
          // The knob is the track's own height: anything smaller lets the fill show around it
          className="pointer-events-none absolute top-0 z-[2] rounded-full bg-background shadow-[0_1px_3px_rgb(0_0_0/20%)] ring-1 ring-border transition-[left] duration-300 ease-out dark:bg-foreground"
          style={{
            width: KNOB,
            height: KNOB,
            left: `calc((100% - ${KNOB}px) * ${auto ? 0 : part})`,
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

      {/* Under Auto the toggle beside the name already says so; a second word would repeat it */}
      {!auto && (
        <span
          className="w-[62px] shrink-0 text-[11px]"
          // The name wears its own step, at full strength: the fill's own colour is lifted toward
          // the paper at the bottom of the ladder and would not clear 4.5:1 as words.
          style={{ color: nameInk(step) }}
        >
          {EFFORT_LABEL[step ?? "auto"]}
        </span>
      )}
    </div>
  );
}

/**
 * The filled part of the track, painted rather than tinted: bodies of light drift inside it at
 * their own speeds under one gradient, blurred so none of them shows an edge, with a highlight
 * crossing now and then. It is the one place in the app that draws, because a colour that lives
 * cannot be had from a gradient sliding sideways (the user's pick).
 *
 * The colours come from the tokens the rest of the ladder is built from, read off the element so
 * a theme change re-reads them: the brand at the bottom, indigo in the middle, and one crown the
 * top two steps alone reach. Reduced motion gets the same picture standing still.
 */
function Fill({ step, width }: { step: Effort | null; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Re-reads the tokens: they are written per theme, and the canvas holds pixels, not variables
  const dark = useIsDark();

  useEffect(() => {
    const node = canvas.current;
    const context = node?.getContext("2d");
    if (!node || !context) return;

    const ratio = Math.min(2, window.devicePixelRatio || 1);
    node.width = Math.round(width * ratio);
    node.height = Math.round(KNOB * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const stops = fillStops(node, step);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (seconds: number) => {
      context.clearRect(0, 0, width, KNOB);
      const base = context.createLinearGradient(0, 0, width, 0);
      // The stops are `r,g,b` triples, which is what the bodies of light need as `rgba(…)`
      stops.forEach((colour, index) =>
        base.addColorStop(index / (stops.length - 1), `rgb(${colour})`),
      );
      context.fillStyle = base;
      context.fillRect(0, 0, width, KNOB);

      context.save();
      context.globalCompositeOperation = "lighter";
      // Blurred first: a body of light has no edge, and an unblurred one shows its circle
      context.filter = `blur(${Math.max(3, KNOB * 0.42)}px)`;
      for (let index = 0; index < BODIES; index += 1) {
        const speed = 0.1 + index * 0.045;
        const phase = index * 1.7;
        const x = width * (0.5 + 0.78 * Math.sin(seconds * speed + phase));
        const y =
          KNOB * (0.5 + 0.7 * Math.sin(seconds * speed * 1.7 + phase * 1.4));
        const radius =
          KNOB * (0.85 + 0.8 * (0.5 + 0.5 * Math.sin(seconds * 0.23 + index)));
        const last = index === BODIES - 1;
        const tone = last ? "255,255,255" : stops[index % stops.length];
        const body = context.createRadialGradient(x, y, 0, x, y, radius);
        body.addColorStop(0, rgba(tone, last ? 0.26 : 0.5));
        body.addColorStop(0.6, rgba(tone, last ? 0.08 : 0.16));
        body.addColorStop(1, rgba(tone, 0));
        context.fillStyle = body;
        context.fillRect(-KNOB, -KNOB, width + KNOB * 2, KNOB * 3);
      }
      context.filter = "none";
      context.restore();

      const sweep = ((seconds * 0.28) % 1.6) * (width + 120) - 60;
      const shine = context.createLinearGradient(sweep - 46, 0, sweep + 46, 0);
      shine.addColorStop(0, "rgba(255,255,255,0)");
      shine.addColorStop(0.5, "rgba(255,255,255,0.16)");
      shine.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = shine;
      context.fillRect(0, 0, width, KNOB);

      // The light sits on the top of the track, as it would on a real one
      const lid = context.createLinearGradient(0, 0, 0, KNOB);
      lid.addColorStop(0, "rgba(255,255,255,0.22)");
      lid.addColorStop(0.5, "rgba(255,255,255,0)");
      context.fillStyle = lid;
      context.fillRect(0, 0, width, KNOB * 0.6);
    };

    if (still) {
      draw(0);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const tick = () => {
      frame = requestAnimationFrame(tick);
      draw((performance.now() - started) / 1000);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [step, width, dark]);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-0 left-0 rounded-full transition-[width] duration-300 ease-out",
        !step && "opacity-30",
      )}
      style={{ width, height: KNOB }}
    />
  );
}

const rgba = (tone: string, alpha: number) => `rgba(${tone},${alpha})`;

/**
 * What one step's fill is made of, as `r,g,b` triples: the bottom of the ladder stands back from
 * the paper so there is room to climb, the middle turns into indigo, and the top two steps alone
 * reach the crown — so full power looks like full power. Every colour is resolved off the element
 * rather than typed here, so the tokens stay the one place the ladder is written.
 */
function fillStops(node: HTMLElement, step: Effort | null): string[] {
  const read = (token: string) => resolve(node, token);
  const brand = read("--brand");
  const indigo = read("--effort-end");
  const crown = read("--effort-crown");
  const paper = read("--background");
  const lift = (part: number) => mix(brand, paper, part);
  const deep = (part: number) => mix(brand, indigo, part);
  switch (step) {
    case "minimal":
      return [lift(0.42), lift(0.26), brand];
    case "low":
      return [lift(0.28), lift(0.12), brand];
    case "high":
      return [brand, deep(0.55), indigo, mix(indigo, crown, 0.65)];
    case "xhigh":
      return [brand, indigo, mix(indigo, crown, 0.5), crown];
    default:
      // `medium`, and the ghost the ladder shows under Auto
      return [lift(0.12), brand, deep(0.38)];
  }
}

/** A custom property as `r,g,b`: computed styles hand custom properties back unresolved, so the
 *  value is put on a colour the browser does resolve. */
function resolve(node: HTMLElement, token: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  probe.style.display = "none";
  node.appendChild(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  const parts = colour.match(/\d+(\.\d+)?/g);
  return parts
    ? parts
        .slice(0, 3)
        .map((channel) => Math.round(Number(channel)))
        .join(",")
    : "0,0,0";
}

const mix = (from: string, to: string, part: number): string =>
  from
    .split(",")
    .map((channel, index) =>
      Math.round(
        Number(channel) * (1 - part) + Number(to.split(",")[index]) * part,
      ),
    )
    .join(",");

/**
 * What colour a step's name is: the step's own, except at the bottom of the ladder, where the
 * fill stands back from the paper and the word would go with it.
 */
function nameInk(step: Effort | null): string {
  if (!step || step === "none") return "var(--muted-foreground)";
  if (step === "minimal" || step === "low") return "var(--brand)";
  return `var(--effort-${step})`;
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

/** What the toggle's tooltip says: how many steps there are, or why there are none. */
function ladderNote(ladder: readonly Effort[] | null): string {
  if (ladder === null) return "This model's steps are unknown";
  if (ladder.length === 0) return "This model has no effort to set";
  return `${ladder.length} steps, plus Auto`;
}
