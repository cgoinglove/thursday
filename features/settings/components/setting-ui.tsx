"use client";

import { Check, Plus, Search } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn, WAITING_INK } from "@/lib/utils";

/** Shared layout for settings screens: a list, dialogs for everything else. */

/**
 * One rhythm, so a label belongs to what is under it rather than floating
 * between two cards. A group is 32px from the next one, its label 12px above
 * its body, and a note 8px below it. What reads as cramped is the ratio, not
 * the numbers: a group 20px from its neighbour and 8px from its own label is
 * one undifferentiated stack.
 */
const GROUP_GAP = "space-y-8";

/** The padding a section opens with; the skeleton and the error keep it, so nothing jumps. */
const SECTION_PAD = "px-8 pt-8 pb-6";

/**
 * The column the section title, a list body and the rail's words share, the
 * same on every section so nothing moves when the section changes. What fills
 * the whole width instead is anything that is a surface rather than a list: a
 * reader's panes, and every rail's rule.
 */
export function SettingColumn({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[55rem]", className)}>
      {children}
    </div>
  );
}

export function SettingScreen({
  footer,
  children,
}: {
  /** The rail pinned to the section's bottom edge; see `SettingRail`. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        {/* scroll-py keeps room for a focus ring at the edge and clears the gradient */}
        <div className="h-full w-full scroll-py-6 overflow-y-auto">
          <div className={SECTION_PAD}>
            <SettingColumn>
              {/* -m-1/p-1: the focus ring extends 3px outside, and the column's
                  edges must still land on the header's */}
              <div className={cn("-m-1 p-1", GROUP_GAP)}>{children}</div>
            </SettingColumn>
          </div>
        </div>
        {/* Soft top edge, light only: on a black background it reads as a dark band */}
        <div className="pointer-events-none absolute top-0 left-0 h-6 w-full bg-linear-to-b from-background to-transparent dark:hidden" />
      </div>
      {footer && <SettingRail>{footer}</SettingRail>}
    </div>
  );
}

/**
 * Two panes filling the section: an index on the left, what it opens on the
 * right. Both reach the bottom edge, so nothing clips into the rail.
 */
export function SettingPanes({
  left,
  right,
  footer,
}: {
  left: ReactNode;
  right: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* mt-8 matches the padding a scrolling section opens with (SECTION_PAD),
          so the surface does not start hard against the title */}
      <div className="mt-8 flex min-h-0 flex-1 border-t border-border/60">
        <div className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border/60 bg-muted/20">
          {left}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{right}</div>
      </div>
      {footer && <SettingRail>{footer}</SettingRail>}
    </div>
  );
}

/**
 * The bottom edge of every section: what the whole set is, and the actions that
 * act on all of it. It also gives a short section a bottom, so the empty half of
 * a tall dialog reads as margin rather than a truncated page.
 */
export function SettingRail({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-t border-border/60 px-8">
      <SettingColumn className="flex h-14 items-center gap-3 text-xs text-muted-foreground">
        {children}
      </SettingColumn>
    </div>
  );
}

/** Fills the rail's left half; whatever follows sits at the right edge. */
export function SettingRailNote({ children }: { children: ReactNode }) {
  return <span className="min-w-0 flex-1 truncate">{children}</span>;
}

/** The filter every growing list carries. Cmd+K focuses the one on screen (settings.tsx). */
export function SettingFilter({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn("relative w-72 max-w-full", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        data-setting-filter=""
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 pl-8"
      />
    </div>
  );
}

/**
 * What a nav row reports about its section. Amber counts what waits on you, red
 * marks what failed — the app's two colours, and the nav carries no others.
 * A count of 0 draws nothing, so a section at rest stays quiet.
 */
export function NavBadge({
  tone,
  count,
}: {
  tone: "amber" | "red";
  /** Omitted draws a dot: the section has something wrong, not a number of things. */
  count?: number;
}) {
  if (count === 0) return null;
  if (count === undefined)
    return (
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          tone === "red" ? "bg-destructive" : "bg-amber-600 dark:bg-amber-400",
        )}
      />
    );
  return (
    <span
      className={cn(
        "shrink-0 font-mono text-[11px]",
        tone === "red" ? "text-destructive" : WAITING_INK,
      )}
    >
      {count}
    </span>
  );
}

/**
 * The header line of a section that has more than one group, so its filter
 * cannot belong to any of them. A group's own header is `SettingGroup`.
 */
export function SettingToolbar({
  children,
  count,
}: {
  children: ReactNode;
  /** The right-hand tally, in the list's own vocabulary. */
  count?: ReactNode;
}) {
  return <SettingHeader filter={children} right={count} />;
}

/** What sits above a body: what the set is, a filter for it, and its state. */
function SettingHeader({
  label,
  hint,
  filter,
  right,
}: {
  label?: string;
  hint?: string;
  filter?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      {label && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {label}
        </span>
      )}
      {hint && (
        <span className="truncate font-mono text-xs text-muted-foreground/60">
          {hint}
        </span>
      )}
      {filter}
      {right && (
        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
          {right}
        </span>
      )}
    </div>
  );
}

export function SettingDialogContent({
  title,
  description,
  children,
  footer,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** The dialog's actions; omitted when there are none. */
  footer?: ReactNode;
}) {
  return (
    // min-w-0: DialogContent is a grid, and a grid item's auto min width is
    // its content's min-content, so a wide table would push past max-w
    <div className="flex min-w-0 max-h-[75vh] flex-col gap-6 p-1">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-1 px-6">
          <p className="truncate text-xl font-semibold">{title}</p>
          {description && (
            <div className="text-xs text-muted-foreground">{description}</div>
          )}
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 scroll-py-3 overflow-y-auto">
        <div className="space-y-4 p-1 px-6">{children}</div>
      </div>

      {footer && (
        <div className="flex shrink-0 justify-end gap-2 px-6">{footer}</div>
      )}
    </div>
  );
}

export function SettingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className={SECTION_PAD}>
      <SettingColumn className="space-y-3">
        {Array.from({ length: rows }, (_, row) => (
          <Skeleton key={row} className="h-16 w-full rounded-xl" />
        ))}
      </SettingColumn>
    </div>
  );
}

export function SettingError({ message }: { message: string }) {
  return (
    <div className={SECTION_PAD}>
      <SettingColumn>
        <p className="font-mono text-xs text-destructive">{message}</p>
      </SettingColumn>
    </div>
  );
}

/** The bordered list every section uses; rows draw themselves. */
export function SettingItems({
  addRow,
  children,
}: {
  /** An "add" row pinned at the top, shaped like the rows below. */
  addRow?: { label: string; onClick: () => void };
  children?: ReactNode;
}) {
  return (
    <div className="divide-y divide-border/60 rounded-xl border border-border/60">
      {addRow && (
        <SettingAddRow label={addRow.label} onClick={addRow.onClick} />
      )}
      {children}
    </div>
  );
}

/**
 * A named set: a header line, a body, and a note about it. The label is plain
 * text above the body — a tinted band inside the card reads as a row, and a
 * rule under it repeats the card's own border. Margins rather than `space-y`,
 * so the label binds to the body no matter how many nodes the body is.
 */
export function SettingGroup({
  label,
  hint,
  filter,
  right,
  note,
  children,
}: {
  label?: string;
  /** A fainter note beside the label. */
  hint?: string;
  /** A `SettingFilter` on the header line, for a set that grows. */
  filter?: ReactNode;
  /** The set's state, at the far end of the label line. */
  right?: ReactNode;
  /** The line under the body that qualifies it; a falsy value draws nothing. */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      {(label || hint || filter || right) && (
        <div className="mb-3">
          <SettingHeader
            label={label}
            hint={hint}
            filter={filter}
            right={right}
          />
        </div>
      )}
      {children}
      {note && <SettingNote className="mt-2">{note}</SettingNote>}
    </section>
  );
}

/**
 * The line under a body that qualifies it: what a switch does next, why nothing
 * happened, what will be typed wrong. One definition, so it cannot drift.
 */
export function SettingNote({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "px-1 font-mono text-[11px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * A setting that runs by itself: one switch, and what it reveals while it is
 * on. Tinted rather than bordered — what it holds is state, not a set to pick
 * from. Its description is a sentence that wraps, so it gets its own leading;
 * a row's second line, which is one line of state, stays tight.
 */
export function SettingToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
  children,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  /** Holds the switch while its state is still arriving. */
  disabled?: boolean;
  onChange: (on: boolean) => void;
  /** Drawn under the switch while it is on. */
  children?: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-xl bg-muted/30 p-4">
      <label className="flex items-center gap-4">
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block text-sm font-medium">{label}</span>
          <span className="block text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        </span>
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      </label>
      {checked && children}
    </div>
  );
}

/** Pick one row. Disabled options stay listed with the reason in the hint slot. */
export function SettingChoiceRows<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly {
    value: T;
    label: ReactNode;
    hint?: ReactNode;
    /** A string is the reason this option cannot be picked, shown in place of the hint. */
    disabled?: string | false;
  }[];
  value: T | undefined;
  onChange: (value: T) => void;
  /** Pauses the whole list (while saving) without dimming it. */
  disabled?: boolean;
}) {
  return (
    <SettingItems>
      {options.map((option) => {
        const picked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled || Boolean(option.disabled)}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex w-full items-center gap-3 p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
              picked ? "bg-muted/40" : "hover:bg-muted/50",
              option.disabled && "opacity-50",
            )}
          >
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className="block truncate text-sm font-medium">
                {option.label}
              </span>
              {(option.disabled || option.hint) && (
                <span className="block truncate text-xs text-muted-foreground">
                  {option.disabled || option.hint}
                </span>
              )}
            </span>
            {picked && <Check className="size-4 shrink-0" />}
          </button>
        );
      })}
    </SettingItems>
  );
}

/**
 * The sentinel that requests the next page (use-server-pages), drawn as ghost
 * rows so arriving rows land in place. It must have height: an empty
 * sentinel re-triggers the observer immediately and pages pour in at once.
 */
export function SettingMore({
  hasMore,
  loading,
  sentinelRef,
  ghost,
  count = 2,
  className,
}: {
  hasMore: boolean;
  loading: boolean;
  sentinelRef: (node: HTMLElement | null) => void;
  /** A Skeleton with the same anatomy as one row of this list. */
  ghost: ReactNode;
  count?: number;
  /** What the list gives its rows, such as the divider. */
  className?: string;
}) {
  if (!hasMore) return null;
  return (
    <div
      ref={sentinelRef}
      aria-busy={loading}
      aria-label="Loading more"
      className={className}
    >
      {Array.from({ length: count }, (_, at) => (
        <Fragment key={`ghost-${at}`}>{ghost}</Fragment>
      ))}
    </div>
  );
}

function SettingAddRow({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground flex w-full items-center gap-3 p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg">
        <Plus className="size-4" />
      </span>
      <span className="text-sm">{label}</span>
    </button>
  );
}
