"use client";

import {
  AudioLines,
  Captions,
  Check,
  ChevronRight,
  Clapperboard,
  Cpu,
  Image as ImageIcon,
  type LucideIcon,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/notify";
import { ModelPicker } from "@/features/ai/components/model-picker";
import { ProviderIcon } from "@/features/ai/components/provider-icon";
import {
  type MediaKind,
  parseMediaModel,
  parseTextModel,
  type TextModelProviderId,
} from "@/features/ai/model.schema";
import {
  removeConfigAction,
  setConfigAction,
} from "@/features/config/config.action";
import {
  CONFIG_GROUPS,
  type ConfigChoice,
  type ConfigEntry,
  type ConfigGroup,
  type ConfigStatus,
  groupSatisfied,
  isConfigSet,
} from "@/features/config/config.const";
import {
  SettingChoiceRows,
  SettingDialogContent,
  SettingError,
  SettingGroup,
  SettingItems,
  SettingRailNote,
  SettingScreen,
  SettingSkeleton,
} from "@/features/settings/components/setting-ui";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";

/** The "keys" half of the config catalogue; reads set/unset only, never a value. */
export function ConfigSetting() {
  return <ConfigGroups section="keys" />;
}

/** One mark per studio kind, drawn as the output (transcription is captions, not a mic). */
const KIND_MARKS: Record<MediaKind, LucideIcon> = {
  image: ImageIcon,
  video: Clapperboard,
  speech: AudioLines,
  transcription: Captions,
};

export function ConfigGroups({ section }: { section: ConfigGroup["section"] }) {
  const { data, isLoading, error } = useServerRoute<ConfigStatus[]>(
    queryKey.config,
  );

  if (isLoading) return <SettingSkeleton rows={4} />;
  if (error) return <SettingError message={error.message} />;

  const isSet = (key: string) => isConfigSet(data, key);
  // Only choice entries carry a value
  const valueOf = (key: string) =>
    data?.find((entry) => entry.key === key)?.value;

  const groups = CONFIG_GROUPS.filter((group) => group.section === section);
  const entries = groups.flatMap((group) => group.entries);

  return (
    <SettingScreen
      footer={
        <SettingRailNote>
          {section === "keys" ? (
            <>
              {entries.filter((entry) => isSet(entry.key)).length} of{" "}
              {entries.length} set
              {groups.some((group) => !groupSatisfied(group, isSet))
                ? " · a call needs one voice key"
                : " · your keys stay on this machine"}
            </>
          ) : (
            <>
              {entries.length} of {entries.length} resolved ·{" "}
              {entries.filter((entry) => valueOf(entry.key)).length} pinned
            </>
          )}
        </SettingRailNote>
      }
    >
      {groups.map((group) => (
        <SettingGroup
          key={group.id}
          label={group.title}
          hint={group.hint}
          right={<RequirementBadge group={group} isSet={isSet} />}
        >
          <SettingItems>
            {group.entries.map((entry) =>
              entry.choices ? (
                <ChoiceRow
                  key={entry.key}
                  entry={entry}
                  choices={entry.choices}
                  value={valueOf(entry.key)}
                  isSet={isSet}
                />
              ) : (
                <KeyRow
                  key={entry.key}
                  entry={entry}
                  set={isSet(entry.key)}
                  // Amber only where something is actually missing: an
                  // unsatisfied required group is waiting on the user
                  needed={!groupSatisfied(group, isSet)}
                />
              ),
            )}
          </SettingItems>
        </SettingGroup>
      ))}
    </SettingScreen>
  );
}

function RequirementBadge({
  group,
  isSet,
}: {
  group: ConfigGroup;
  isSet: (key: string) => boolean;
}) {
  if (group.require === "none") return null;
  if (groupSatisfied(group, isSet)) {
    return (
      <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
        <Check className="size-3" />
        ready
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex items-center gap-1 font-mono text-[11px]",
        WAITING_INK,
      )}
    >
      <TriangleAlert className="size-3" />
      {group.note ?? "Required"}
    </span>
  );
}

function KeyRow({
  entry,
  set,
  needed,
}: {
  entry: ConfigEntry;
  set: boolean;
  /** Its group must have a key and has none, so this row is waiting on the user. */
  needed: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => openConfigDialog(entry, set)}
      className="group flex w-full items-center gap-3 p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      {entry.provider && (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/60">
          <ProviderIcon provider={entry.provider} className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block truncate text-sm font-medium">
          {entry.label}
        </span>
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {entry.key}
        </span>
      </span>

      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 font-mono text-xs",
          set
            ? "text-muted-foreground"
            : needed
              ? WAITING_INK
              : "text-muted-foreground/60",
        )}
      >
        {set && <Check className="size-3" />}
        {!set && needed && <TriangleAlert className="size-3" />}
        {set ? "Set" : needed ? "Needed" : "Not set"}
      </span>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
    </button>
  );
}

/**
 * A choice, not a secret. Unset is normal, so the row says what runs
 * automatically. The value sits under the label rather than across the row:
 * at this width the two ends of a row are not read in one glance.
 */
function ChoiceRow({
  entry,
  choices,
  value,
  isSet,
}: {
  entry: ConfigEntry;
  choices: ConfigChoice[];
  value?: string;
  isSet: (key: string) => boolean;
}) {
  const picked = choices.find((choice) => choice.value === value);
  const usable = choices.filter((choice) => isSet(choice.needs));
  // A value typed outside the list (gateway) has no label
  const typed = value && !picked ? value : null;
  const Mark = entry.kind ? KIND_MARKS[entry.kind] : Cpu;

  return (
    <button
      type="button"
      onClick={() =>
        entry.kind || entry.text
          ? openModelDialog(entry)
          : openChoiceDialog(entry, choices)
      }
      className="group flex w-full items-center gap-3 p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/60">
        <Mark className="size-4 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate text-sm font-medium">
          {entry.label}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          {!picked && !typed && (
            <span className="shrink-0 rounded-[5px] border border-border/60 px-1 font-mono text-[10px] text-muted-foreground">
              auto
            </span>
          )}
          <span className="truncate font-mono text-xs text-muted-foreground">
            {picked?.label ??
              typed ??
              usable[0]?.label ??
              "No key for any of these yet"}
          </span>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
    </button>
  );
}

function openModelDialog(entry: ConfigEntry) {
  return notify.component({
    className: "sm:max-w-lg",
    renderer: ({ close }) => <ModelDialog entry={entry} onDone={close} />,
  });
}

/** Picks one model entry — a studio kind, or the bots' default — with the picker bots use. "Automatic" clears it. */
function ModelDialog({
  entry,
  onDone,
}: {
  entry: ConfigEntry;
  onDone: () => void;
}) {
  const { data } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const stored = data?.find((status) => status.key === entry.key)?.value;
  // Local state: a provider picked without a model yet is not stored, but must still render
  const [pick, setPick] = useState<{
    provider: TextModelProviderId | null;
    model: string;
  }>(() => {
    const ref = entry.text ? parseTextModel(stored) : parseMediaModel(stored);
    return { provider: ref?.provider ?? null, model: ref?.model ?? "" };
  });

  const done = () => {
    revalidate(queryKey.config);
    onDone();
  };
  const [save] = useServerAction(setConfigAction, {
    okMessage: `${entry.label} saved`,
    onOk: done,
  });
  const [clear, clearing] = useServerAction(removeConfigAction, {
    okMessage: `${entry.label} back to automatic`,
    onOk: done,
  });

  return (
    <SettingDialogContent
      title={entry.label}
      description={entry.hint}
      footer={
        <>
          {stored && (
            <Button
              variant="ghost"
              loading={clearing}
              onClick={() => clear(entry.key)}
            >
              Automatic
            </Button>
          )}
          <Button variant="ghost" onClick={onDone}>
            Close
          </Button>
        </>
      }
    >
      <ModelPicker
        kind={entry.kind}
        provider={pick.provider}
        model={pick.model}
        onChange={(next) => {
          setPick(next);
          // Provider alone is not a model; save once the name is filled
          if (next.model.trim()) {
            save(entry.key, `${next.provider}/${next.model.trim()}`);
          }
        }}
      />
    </SettingDialogContent>
  );
}

function openChoiceDialog(entry: ConfigEntry, choices: ConfigChoice[]) {
  return notify.component({
    className: "sm:max-w-md",
    renderer: ({ close }) => (
      <ChoiceDialog entry={entry} choices={choices} onDone={close} />
    ),
  });
}

/**
 * Choices without a key stay listed, disabled with the reason. Set/unset is
 * read live here: a key added while this dialog is open must unlock its row.
 */
function ChoiceDialog({
  entry,
  choices,
  onDone,
}: {
  entry: ConfigEntry;
  choices: ConfigChoice[];
  onDone: () => void;
}) {
  const { data } = useServerRoute<ConfigStatus[]>(queryKey.config);
  const value = data?.find((status) => status.key === entry.key)?.value;
  const done = () => {
    revalidate(queryKey.config);
    onDone();
  };
  const [save, saving] = useServerAction(setConfigAction, {
    okMessage: `${entry.label} saved`,
    onOk: done,
  });
  const [clear, clearing] = useServerAction(removeConfigAction, {
    okMessage: `${entry.label} back to automatic`,
    onOk: done,
  });

  return (
    <SettingDialogContent
      title={entry.label}
      description={entry.hint}
      footer={
        <>
          {value && (
            <Button
              variant="ghost"
              loading={clearing}
              onClick={() => clear(entry.key)}
            >
              Automatic
            </Button>
          )}
          <Button variant="ghost" onClick={onDone}>
            Close
          </Button>
        </>
      }
    >
      <SettingChoiceRows
        options={choices.map((choice) => ({
          value: choice.value,
          label: choice.label,
          disabled: !isConfigSet(data, choice.needs) && `needs ${choice.needs}`,
        }))}
        value={value}
        onChange={(picked) => save(entry.key, picked)}
        disabled={saving}
      />
    </SettingDialogContent>
  );
}

function openConfigDialog(entry: ConfigEntry, set: boolean) {
  return notify.component({
    className: "sm:max-w-md",
    renderer: ({ close }) => (
      <ConfigDialog entry={entry} set={set} onDone={close} />
    ),
  });
}

/** Set, replace or remove one key. The current value is never shown. */
function ConfigDialog({
  entry,
  set,
  onDone,
}: {
  entry: ConfigEntry;
  set: boolean;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");

  // The model picker reads hasKey too
  const refresh = () => {
    revalidate(queryKey.config);
    revalidate(queryKey.llmModel);
  };

  const [save, saving] = useServerAction(setConfigAction, {
    okMessage: `${entry.label} key saved`,
    onOk: () => {
      refresh();
      onDone();
    },
  });
  const [remove, removing] = useServerAction(removeConfigAction, {
    okMessage: `${entry.label} key removed`,
    onOk: () => {
      refresh();
      onDone();
    },
  });

  return (
    <SettingDialogContent
      title={entry.label}
      description={
        <>
          <span className="font-mono">{entry.key}</span>
          {entry.hint && <> · {entry.hint}</>}
        </>
      }
      footer={
        <>
          {set && (
            <Button
              variant="ghost"
              loading={removing}
              onClick={() => remove(entry.key)}
            >
              Remove
            </Button>
          )}
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={value.trim().length < 8}
            onClick={() => save(entry.key, value)}
          >
            {set ? "Replace" : "Save"}
          </Button>
        </>
      }
    >
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && value.trim().length >= 8)
            save(entry.key, value);
        }}
        placeholder={set ? "New value — replaces the current key" : entry.key}
        spellCheck={false}
        type="password"
        autoFocus
      />
    </SettingDialogContent>
  );
}
