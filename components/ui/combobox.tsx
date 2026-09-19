"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Free-text field with suggestions. Built on Autocomplete, not Combobox, because
 * Combobox rejects values outside its list.
 *
 * Typing is a draft, not a value: `onChange` fires when a suggestion is pressed, or
 * when the typed text is saved, never on a keystroke. Callers save on `onChange`, and
 * half a model id would otherwise be saved on the way to a whole one.
 */

export type ComboboxOption = {
  /** What lands in the field when this row is picked. */
  value: string;
  /** What a person reads. */
  label: string;
  /** Trailing mono text, usually the raw value. */
  hint?: string;
  /** Short chip before the hint. */
  badge?: string;
};

/**
 * Matches on value, label and badge. Filtering stops once the field holds an
 * exact option value, so reopening after a pick shows the full list.
 */
function match(option: ComboboxOption, query: string, exact: Set<string>) {
  const needle = query.trim().toLowerCase();
  if (!needle || exact.has(needle)) return true;
  return [option.value, option.label, option.badge]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(needle));
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  empty = "Nothing matches",
  note = "Not on the list? Type it, then save.",
  loading = false,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: {
  /** The saved value. Typing moves a draft; this only follows a save. */
  value: string;
  /** A value was chosen: a suggestion pressed, or typed text saved. Never a keystroke. */
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  /** Shown in place of the list when nothing matches what was typed. */
  empty?: string;
  /** Line above the list telling the user typing is allowed; not an item. */
  note?: string;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const exact = new Set(options.map((option) => option.value.toLowerCase()));

  const [draft, setDraft] = useState(value);
  // A value saved elsewhere — a pick, another screen — replaces what was typed here.
  const [saved, setSaved] = useState(value);
  if (saved !== value) {
    setSaved(value);
    setDraft(value);
  }
  const typed = draft.trim();
  const unsaved = typed !== "" && typed !== value;

  return (
    <Autocomplete.Root
      items={options}
      value={draft}
      onValueChange={(next, details) => {
        setDraft(next);
        // Pressing a suggestion is a decision, so it saves; typing is only a draft.
        if (details.reason === "item-press") onChange(next);
      }}
      // The field holds the id, not the label.
      itemToStringValue={(option: ComboboxOption) => option.value}
      filter={(option: ComboboxOption, query) => match(option, query, exact)}
      openOnInputClick
      disabled={disabled}
    >
      <div className={cn("flex gap-2", className)}>
        <Autocomplete.InputGroup className="relative min-w-0 flex-1">
          <Autocomplete.Input
            placeholder={placeholder}
            aria-label={ariaLabel}
            spellCheck={false}
            className={cn(inputClassName, "pr-8 font-mono text-sm")}
          />
          <Autocomplete.Trigger
            aria-label="Show suggestions"
            className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground disabled:opacity-50"
          >
            {loading ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </Autocomplete.Trigger>
        </Autocomplete.InputGroup>

        {/* A typed id is not a value until it is saved, so the button is the only way
          in. It stands in for nothing when the field matches what is stored. */}
        {unsaved && !disabled && (
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => onChange(typed)}
          >
            Save
          </Button>
        )}
      </div>

      <Autocomplete.Portal>
        <Autocomplete.Positioner
          sideOffset={4}
          className="isolate z-50 outline-none"
        >
          {/* May grow wider than the field: min anchor width, max min(28rem, viewport). */}
          <Autocomplete.Popup className="max-h-(--available-height) w-max min-w-(--anchor-width) max-w-[min(28rem,var(--available-width))] origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            {note && (
              <p className="px-1.5 pt-1 pb-1.5 text-[11px] text-muted-foreground">
                {note}
              </p>
            )}

            <Autocomplete.Empty className="px-2 py-2 font-mono text-[11px] text-muted-foreground empty:hidden">
              {loading ? "Loading models…" : empty}
            </Autocomplete.Empty>

            <Autocomplete.List className="max-h-64 overflow-y-auto outline-none">
              {(option: ComboboxOption) => (
                <Autocomplete.Item
                  key={option.value}
                  value={option}
                  className="flex cursor-default items-center gap-2 rounded-md px-1.5 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="flex-1 whitespace-nowrap">
                    {option.label}
                  </span>
                  {option.badge && (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {option.badge}
                    </span>
                  )}
                  {option.hint && option.hint !== option.label && (
                    <span className="min-w-0 shrink truncate font-mono text-[11px] text-muted-foreground">
                      {option.hint}
                    </span>
                  )}
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      option.value === value.trim()
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
