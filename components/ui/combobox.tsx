"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import { inputClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Free-text field with suggestions: the input value is the value. Built on
 * Autocomplete, not Combobox, because Combobox rejects values outside its list.
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
  note = "Not on the list? Type it — whatever is in the field is the value.",
  loading = false,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
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

  return (
    <Autocomplete.Root
      items={options}
      value={value}
      onValueChange={onChange}
      // The field holds the id, not the label.
      itemToStringValue={(option: ComboboxOption) => option.value}
      filter={(option: ComboboxOption, query) => match(option, query, exact)}
      openOnInputClick
      disabled={disabled}
    >
      <Autocomplete.InputGroup className={cn("relative", className)}>
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
