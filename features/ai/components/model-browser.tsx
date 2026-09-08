"use client";

import { Check, LoaderCircle, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { VercelIcon } from "@/components/ui/custom-icon";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input, inputClassName } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import {
  GATEWAY_TEXT,
  GATEWAY_TOOL_USE,
  type GatewayModel,
  type GatewayPrice,
  type MediaKind,
} from "../model.schema";
import { GatewayOwnerIcon } from "./gateway-mark";

/**
 * The gateway's shelf, for one slot. It is opened for a kind and never leaves it: what a
 * slot cannot run is not a filter a person should have to apply, so kind is an argument
 * rather than a control. A text slot additionally means tool-use — a bot that cannot call
 * a tool cannot do a job — which is why the dialog counts fewer than the shelf holds.
 *
 * It is the model field itself, not a button beside one: the gateway lists hundreds of
 * rows with prices, and a field next to it could only be a worse copy of the search
 * inside. An id the catalog does not list is typed here too, from the empty search.
 */
export function ModelBrowser({
  models,
  kind,
  value,
  loading,
  onPick,
}: {
  /** The catalog the picker already read; one fetch serves both. */
  models: GatewayModel[];
  /** What the slot makes. Absent is a text model. */
  kind?: MediaKind;
  value: string;
  loading: boolean;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortId>("cheap");
  const [picked, setPicked] = useState(value);

  const shelf = models.filter((model) => model.type === (kind ?? GATEWAY_TEXT));
  const runnable = kind
    ? shelf
    : shelf.filter((model) => model.tags.includes(GATEWAY_TOOL_USE));

  const needle = query.trim().toLowerCase();
  const rows = (
    needle
      ? runnable.filter((model) =>
          `${model.id} ${model.label}`.toLowerCase().includes(needle),
        )
      : runnable
  )
    .slice()
    .sort(SORTS[sort].compare);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Reopening starts from what the field holds, not from last time's browsing
        if (next) setPicked(value);
        else setQuery("");
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label="Model"
            // The shell the combobox uses in every other slot, so a row keeps one field
            className={cn(
              inputClassName,
              "relative flex items-center pr-8 text-left font-mono text-sm",
            )}
          />
        }
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            !value && "font-sans text-muted-foreground",
          )}
        >
          {value || "Pick a model"}
        </span>
        <span className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground">
          {loading && runnable.length === 0 ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Search className="size-3.5" />
          )}
        </span>
      </DialogTrigger>

      <DialogContent className="h-[min(40rem,calc(100vh-3rem))] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          <div className="shrink-0 space-y-1 px-6 pt-5 pb-4">
            <DialogTitle className="flex items-center gap-2.5 text-xl font-semibold">
              <VercelIcon className="size-3.5" />
              {kind ? KIND_TITLE[kind] : "Text"} models
            </DialogTitle>
            <p className="font-mono text-xs text-muted-foreground">
              {needle
                ? `${rows.length} matching “${query.trim()}”`
                : kind
                  ? `${runnable.length} on the gateway`
                  : `${runnable.length} of ${shelf.length} on the gateway can call tools`}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t border-border/60 px-6 py-3">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                aria-label="Search models"
                placeholder="name, id or provider"
                spellCheck={false}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-8 pl-8 font-mono text-xs"
              />
            </div>
            <Segmented
              aria-label="Sort"
              options={SORT_LIST}
              value={sort}
              onChange={setSort}
            />
          </div>

          <div className="flex shrink-0 items-center gap-4 px-6 pb-1.5 font-mono text-[10px] tracking-wide text-muted-foreground/60">
            <span className="min-w-0 flex-1">model</span>
            {/* What the two numbers mean. A model billed some other way prints its own
                unit in place of them, so the header never has to hedge. */}
            <span className="w-28 text-right">per 1M in / out</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/60">
            {rows.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                picked={model.id === picked}
                onPick={() => setPicked(model.id)}
              />
            ))}
            {rows.length === 0 && (
              <div className="flex flex-col items-start gap-2.5 p-10">
                <p className="font-mono text-xs text-muted-foreground">
                  {needle
                    ? `Nothing matches “${query.trim()}”.`
                    : "Nothing on the shelf — search for an id."}
                </p>
                {needle && (
                  <div className="flex gap-2">
                    {/* The catalog is a listing, not the whole gateway: an id it does
                        not carry still runs, so it is taken as typed */}
                    <Button size="sm" onClick={() => setPicked(query.trim())}>
                      Use “{query.trim()}” as the id
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setQuery("")}
                    >
                      Clear search
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex h-14 shrink-0 items-center gap-3 border-t border-border/60 px-6">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {picked || "Nothing picked — the field keeps what it has"}
            </span>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!picked}
              onClick={() => {
                onPick(picked);
                setOpen(false);
              }}
            >
              Use this model
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const KIND_TITLE: Record<MediaKind, string> = {
  image: "Image",
  video: "Video",
  speech: "Speech",
  transcription: "Transcription",
};

type SortId = "cheap" | "dear" | "name";

/** A model the gateway prices in some other unit sorts last either way, never as a zero. */
const byPrice = (model: GatewayModel) => model.price.in;
const SORTS: Record<
  SortId,
  {
    label: string;
    title: string;
    compare: (a: GatewayModel, b: GatewayModel) => number;
  }
> = {
  cheap: {
    label: "$↑",
    title: "Cheapest first",
    compare: (a, b) =>
      (byPrice(a) ?? Number.POSITIVE_INFINITY) -
      (byPrice(b) ?? Number.POSITIVE_INFINITY),
  },
  dear: {
    label: "$↓",
    title: "Dearest first",
    compare: (a, b) => (byPrice(b) ?? -1) - (byPrice(a) ?? -1),
  },
  name: {
    label: "a–z",
    title: "By name",
    compare: (a, b) => a.label.localeCompare(b.label),
  },
};
const SORT_LIST = (Object.keys(SORTS) as SortId[]).map((value) => ({
  value,
  label: SORTS[value].label,
  title: SORTS[value].title,
}));

/** Dollars as a person reads them: two places above a dollar, enough below it to stay a number. */
const money = (value: number) =>
  value >= 1 ? value.toFixed(2) : String(Number(value.toFixed(4)));

/** What the price column says. A note is the whole line when no token price stands behind it. */
function priceLine(price: GatewayPrice) {
  if (price.free) return "free";
  if (price.in === null && price.out === null) return price.note ?? "—";
  return `${price.in === null ? "—" : money(price.in)} / ${price.out === null ? "—" : money(price.out)}`;
}

function ModelRow({
  model,
  picked,
  onPick,
}: {
  model: GatewayModel;
  picked: boolean;
  onPick: () => void;
}) {
  const { price } = model;
  const priced = price.in !== null || price.out !== null;
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-4 border-b border-border/60 px-6 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
        picked ? "bg-muted/40" : "hover:bg-muted/50",
      )}
    >
      <span className="grid size-[18px] shrink-0 place-items-center">
        <GatewayOwnerIcon owner={model.owner} className="size-[15px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate text-[13px]", picked && "font-medium")}>
            {model.label}
          </span>
          {picked && <Check className="size-3.5 shrink-0" />}
          {model.retiring && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              retiring
            </span>
          )}
        </span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">
          {model.id}
        </span>
      </span>
      <span className="flex w-28 shrink-0 flex-col items-end">
        <span
          className={cn(
            "font-mono text-xs",
            priced || price.free ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {priceLine(price)}
        </span>
        {priced && price.note && (
          <span className="font-mono text-[9px] text-muted-foreground/70">
            {price.note}
          </span>
        )}
      </span>
    </button>
  );
}
