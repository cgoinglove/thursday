"use client";

import { Check, ChevronsUpDown, TriangleAlert } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useState,
} from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/notify";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ASCII_FACE } from "@/config";
import { EffortSwitch } from "@/features/ai/components/effort-switch";
import {
  LIVE_BACKEND_MODELS,
  LIVE_DEFAULTS,
  LIVE_PROVIDER,
  type LiveSettings,
} from "@/features/ai/live.schema";
import type { AiProvider } from "@/features/ai/model.schema";
import { DEFAULT_PERSONA, PERSONAS } from "@/features/ai/prompts/persona";
import { KEY_MIN, KeyInput } from "@/features/config/components/voice-key";
import { setConfigAction } from "@/features/config/config.action";
import {
  PICKED_ROW,
  SettingError,
  SettingGroup,
  SettingNote,
  SettingRailNote,
  SettingScreen,
  SettingSkeleton,
} from "@/features/settings/components/setting-ui";
import type { SkillSummary } from "@/features/skills/skills.schema";
import { CallHistoryRow } from "@/features/thursday/components/call-log";
import { Face } from "@/features/thursday/components/face";
import { ThursdayMark } from "@/features/thursday/components/thursday-mark";
import { VoicePicker } from "@/features/thursday/components/voice-picker";
import {
  ASCII_CHARSETS,
  type AsciiCharset,
} from "@/features/thursday/face.const";
import {
  setThursdayFace,
  useThursdayFace,
} from "@/features/thursday/face.store";
import { resetHistoryAction } from "@/features/thursday/thursday.action";
import {
  CALL_BACK_LABEL,
  CALL_BACK_MODES,
  CAPTION_VIEWS,
  type CallBack,
  CallBackSchema,
  type CaptionView,
  type Hotkey,
  type ThursdayFace,
  WAKE_PHRASE,
  type Wake,
} from "@/features/thursday/thursday.schema";
import { useThursdayStore } from "@/features/thursday/thursday.store";
import { useLiveSettings } from "@/features/thursday/use-live-settings";
import { WorkChipSetting } from "@/features/thursday/work-chip";
import { useDraft } from "@/hooks/use-draft";
import {
  comboOf,
  HOTKEY_CAPTURE,
  isCombo,
  useHotkeyLabel,
} from "@/hooks/use-hotkey";
import { COMMON_VALIDATE } from "@/lib/limits";
import { LIVE_MODEL } from "@/lib/live/live.schema";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";

/**
 * Settings for the call: face, captions, the two models, how a call starts, and
 * its history. Who she is and what she may do is the app's, kept where a call reads it
 * (use-live-settings); how this machine talks to her — captions, her face, the wake
 * phrase, the hotkey — stays in the browser (thursday.store, face.store).
 */
export function ThursdaySetting() {
  // This machine's own: no waiting, no revalidation
  const thursday = useThursdayStore();
  const patch = useThursdayStore((state) => state.patch);
  // Hers: read from the server, so a second computer draws the same answers
  const { settings, patch: change } = useLiveSettings();

  const {
    data: providers = [],
    isLoading,
    error,
  } = useServerRoute<AiProvider[]>(queryKey.llmModel);
  const face = useThursdayFace();

  if (isLoading || !settings) return <SettingSkeleton rows={4} />;
  if (error) return <SettingError message={error.message} />;

  const hasKey = providers.some(
    (entry) => entry.apiKeyName === LIVE_PROVIDER.apiKeyName && entry.hasKey,
  );

  return (
    <SettingScreen
      footer={
        <SettingRailNote>
          Both of her prompts are assembled fresh on every call — memory, the
          roster and your skills go in. Changes here apply from the next call.
        </SettingRailNote>
      }
    >
      <FacePicker value={face} onChange={setThursdayFace} />

      <Captions
        value={thursday.captionView}
        onChange={(captionView) => patch({ captionView })}
      />

      {/* Off by default; the whole feature is features/thursday/work-chip */}
      <WorkChipSetting />

      <ModelsSetting
        value={settings}
        face={face}
        hasKey={hasKey}
        onChange={change}
      />

      {/* Every way a call starts other than pressing her face, read at once */}
      <SettingGroup label="Starting a call">
        <Tiles columns={3}>
          <WakeWord
            value={thursday.wake}
            onChange={(wake) => patch({ wake })}
          />
          <Shortcut
            value={thursday.hotkey}
            onChange={(hotkey) => patch({ hotkey })}
          />
          <CallBackPicker
            value={thursday.callBack}
            onChange={(callBack) => patch({ callBack })}
          />
        </Tiles>
      </SettingGroup>

      <SettingGroup label="History">
        <Tiles columns={2}>
          <CallHistoryRow />
          <ResetHistory />
        </Tiles>
      </SettingGroup>
    </SettingScreen>
  );
}

/** Tiles side by side in one bordered card, stacked when the column is narrow. */
function Tiles({ columns, children }: { columns: 2 | 3; children: ReactNode }) {
  return (
    <div className="@container">
      <div
        className={cn(
          "grid divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60",
          columns === 3
            ? "@3xl:grid-cols-3 @3xl:divide-x @3xl:divide-y-0"
            : "@xl:grid-cols-2 @xl:divide-x @xl:divide-y-0",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** A tile's first line: what it is, and its switch when it has one. */
function TileHead({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-5 items-center gap-3">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Both models a call runs on, in one card: the Live voice and the Responses
 * backend that holds her tools (thursday.prompt). They share the OpenAI key, so
 * a missing key is asked for once, above both.
 */
function ModelsSetting({
  value,
  face,
  hasKey,
  onChange,
}: {
  value: LiveSettings;
  /** The picker plays a sample through her own face. */
  face: ThursdayFace;
  hasKey: boolean;
  onChange: (change: Partial<LiveSettings>) => void;
}) {
  return (
    <SettingGroup
      label="Models"
      note="Both run on your OpenAI key. Instructions are saved when you leave the field."
    >
      <div className="@container divide-y divide-border/60 rounded-xl border border-border/60">
        {!hasKey && <KeyRow />}

        <ModelSection name="Voice" fact="billed by the minute">
          <div className="grid gap-4 @xl:grid-cols-2">
            <ModelBlock label="model">
              {/* Locked: LIVE_MODEL is the only Live model a call opens on */}
              <Combobox
                value={LIVE_MODEL}
                onChange={() => undefined}
                options={[{ value: LIVE_MODEL, label: "GPT-Live 1" }]}
                aria-label="Voice model"
                disabled
              />
            </ModelBlock>
          </div>

          {/* Its own row: opened, the picker holds her face beside the voices. */}
          <ModelBlock label="voice">
            <VoicePicker
              voice={value.voice}
              face={face}
              onChange={(voice) =>
                onChange({ voice: voice.trim() || LIVE_DEFAULTS.voice })
              }
            />
          </ModelBlock>

          <ModelBlock label="style">
            <StylePicker
              value={value.persona}
              own={value.stylePrompt}
              onPersona={(persona) => onChange({ persona })}
              onOwn={(stylePrompt) => onChange({ stylePrompt })}
            />
          </ModelBlock>
        </ModelSection>

        <ModelSection name="Backend" fact="billed per token">
          <ModelBlock label="model">
            <BackendModelPicker
              value={value.backendModel}
              onChange={(backendModel) => onChange({ backendModel })}
            />
          </ModelBlock>

          {/* Auto omits the parameter, so a model without reasoning still runs */}
          <ModelBlock label="effort">
            <EffortSwitch
              provider="openai"
              model={value.backendModel}
              value={value.reasoningEffort}
              onChange={(reasoningEffort) => onChange({ reasoningEffort })}
            />
          </ModelBlock>

          <ModelBlock label="tools">
            <BackendTools
              webSearch={value.webSearch}
              readSkills={value.readSkills}
              onChange={onChange}
            />
          </ModelBlock>

          <ModelBlock label="instructions">
            <PromptField
              value={value.backendPrompt}
              onCommit={(backendPrompt) => onChange({ backendPrompt })}
              placeholder="How work should be handed over, what to check first."
              aria-label="Backend instructions"
            />
          </ModelBlock>
        </ModelSection>
      </div>
    </SettingGroup>
  );
}

/** One model's half of the card: its name and how it bills, then what to choose. */
function ModelSection({
  name,
  fact,
  children,
}: {
  name: string;
  fact: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-4 p-5 @2xl:grid-cols-[8.5rem_minmax(0,1fr)] @2xl:gap-6">
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{name}</span>
        <span className="block font-mono text-[11px] text-muted-foreground">
          {fact}
        </span>
      </span>
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}

/**
 * Which character she is, and under it the user's own words when they want them. Ten of
 * them do not fit a card, so the row shows the one picked and the rest open over it; the
 * free field is behind a button because a style is what most people want and an empty box
 * asking for a personality is what nobody fills.
 */
function StylePicker({
  value,
  own,
  onPersona,
  onOwn,
}: {
  value: string;
  own: string;
  onPersona: (persona: string) => void;
  onOwn: (voicePrompt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Written words are the reason the field is open; closing it would hide them
  const [writing, setWriting] = useState(false);
  const picked =
    PERSONAS.find((one) => one.id === value) ??
    PERSONAS.find((one) => one.id === DEFAULT_PERSONA) ??
    PERSONAS[0];

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
            >
              <span className="min-w-0 flex-1">
                <span className="text-sm font-medium">{picked.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {picked.about}
                </span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </button>
          }
        />
        <PopoverContent align="start" className="w-104 p-1.5">
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            How she talks to you. It never changes what she can do.
          </p>
          {PERSONAS.map((one) => (
            <button
              key={one.id}
              type="button"
              onClick={() => {
                onPersona(one.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left",
                one.id === picked.id ? PICKED_ROW : "hover:bg-muted/60",
              )}
            >
              <span className="w-20 shrink-0 text-sm font-medium">
                {one.label}
              </span>
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {one.about}
              </span>
              {one.id === picked.id && (
                <Check className="size-3.5 shrink-0 text-brand" />
              )}
            </button>
          ))}
          {/* Last in the same list, not a button beside it: writing your own is one of
              the ways to answer "who is she to you", and it sits on top of whichever
              character is picked rather than replacing it. */}
          <button
            type="button"
            onClick={() => {
              setWriting(true);
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left",
              own.trim() ? PICKED_ROW : "hover:bg-muted/60",
            )}
          >
            <span className="w-20 shrink-0 text-sm font-medium">Your own</span>
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
              Say it in your words, over the one above.
            </span>
            {own.trim() ? (
              <Check className="size-3.5 shrink-0 text-brand" />
            ) : null}
          </button>
        </PopoverContent>
      </Popover>

      {writing || own.trim() ? (
        <PromptField
          value={own}
          onCommit={onOwn}
          placeholder="Quieter. Don't explain things I didn't ask about."
          aria-label="In your own words"
        />
      ) : null}
    </div>
  );
}

function ModelBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <span className="block font-mono text-[11px] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/** No key yet: paste one here, above both models, instead of leaving for Keys. */
function KeyRow() {
  const [draft, setDraft] = useState("");
  const [save, saving] = useServerAction(setConfigAction, {
    onOk: () => {
      revalidate(queryKey.llmModel);
      revalidate(queryKey.config);
      setDraft("");
    },
  });
  const ready = draft.trim().length >= KEY_MIN;

  return (
    <div className="space-y-3 p-5">
      <span className="block space-y-0.5">
        <span className={cn("block text-sm font-medium", WAITING_INK)}>
          No OpenAI key
        </span>
        <span className="block text-xs text-muted-foreground">
          Her voice and the backend both run on it
        </span>
      </span>
      <KeyInput
        dense
        provider={LIVE_PROVIDER}
        saved={false}
        value={draft}
        ready={ready}
        saving={saving}
        onValue={setDraft}
        onSubmit={() => ready && save(LIVE_PROVIDER.apiKeyName, draft)}
      />
    </div>
  );
}

/**
 * The recent models as cards, and a field for any other id; the provider says
 * at call time whether it runs. A typed id is saved on Enter or when the field
 * is left, never per keystroke, and clearing it goes back to the default.
 */
function BackendModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (model: string) => void;
}) {
  const listed = LIVE_BACKEND_MODELS.some((model) => model.id === value);
  const other = useDraft(
    listed ? "" : value,
    (next) => onChange(next || LIVE_DEFAULTS.backendModel),
    { min: 0 },
  );

  return (
    // Its own width, not the card's: beside the section's name the column is narrower
    <div className="@container space-y-2">
      <div
        role="radiogroup"
        aria-label="Backend model"
        className="grid grid-cols-2 gap-2 @2xl:grid-cols-4"
      >
        {LIVE_BACKEND_MODELS.map((model) => {
          const picked = model.id === value;
          return (
            <button
              key={model.id}
              type="button"
              role="radio"
              aria-checked={picked}
              onClick={() => onChange(model.id)}
              className={cn(
                "min-w-0 space-y-0.5 rounded-lg border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                picked
                  ? "border-brand bg-brand/4"
                  : "border-border/60 hover:bg-muted/50",
              )}
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {model.label}
                </span>
                {picked && <Check className="size-3.5 shrink-0 text-brand" />}
              </span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                {model.id} · {model.tier}
              </span>
            </button>
          );
        })}
      </div>

      <Input
        value={other.value}
        onChange={(event) => other.set(event.target.value)}
        onBlur={other.commit}
        onKeyDown={other.onKeyDown}
        placeholder="Other model id"
        aria-label="Other backend model id"
        spellCheck={false}
        className="font-mono text-sm"
      />
    </div>
  );
}

/**
 * What the backend may reach for. Web search is this browser's setting; the
 * skills switch hands the call `load_skill` and is the server's, because tools
 * are built where no browser is. Off by default: reading a skill is a page of
 * instructions arriving mid-sentence.
 */
function BackendTools({
  webSearch,
  readSkills,
  onChange,
}: {
  webSearch: boolean;
  readSkills: boolean;
  onChange: (change: Partial<LiveSettings>) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-7 gap-y-3">
        <InlineSwitch
          label="Search the web"
          checked={webSearch}
          onChange={(on) => onChange({ webSearch: on })}
        />
        <InlineSwitch
          label="Read skills herself"
          checked={readSkills}
          onChange={(on) => onChange({ readSkills: on })}
        />
      </div>
      {webSearch && (
        <SettingNote>
          Each search adds to the backend's OpenAI usage.
        </SettingNote>
      )}
      {readSkills && <InstalledSkills />}
    </div>
  );
}

function InlineSwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 text-sm">
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      {label}
    </label>
  );
}

/** Only mounted while the switch is on: what she would have to read from. */
function InstalledSkills() {
  const { data } = useServerRoute<SkillSummary[]>(queryKey.skills);
  if (!data) return null;

  return (
    <SettingNote className={cn(!data.length && WAITING_INK)}>
      {data.length
        ? `The same ${data.length} a bot reads. Each one she opens spends a page of the call on it.`
        : "Nothing installed yet — there is nothing for her to read."}
    </SettingNote>
  );
}

/** Added instructions: a draft while typing, saved when the field is left. */
function PromptField({
  value,
  onCommit,
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder: string;
  "aria-label": string;
}) {
  const draft = useDraft(value, onCommit, { min: 0 });

  return (
    <Textarea
      value={draft.value}
      maxLength={COMMON_VALIDATE.prompt.max}
      onChange={(event) => draft.set(event.target.value)}
      onBlur={draft.commit}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  );
}

/**
 * Wipes what the app has kept of its own use, in one go: calls, jobs and
 * memory. The same set `pnpm reset` calls History, so the terminal and this
 * button agree. Keys, bots and connectors stay.
 *
 * Last in the section, not in the rail: the rail is on screen the whole time a
 * section is open, and the one thing here that cannot be undone should be
 * reached by scrolling to it.
 */
function ResetHistory() {
  const [reset, resetting] = useServerAction(resetHistoryAction, {
    okMessage: ({ calls, threads, notes }) =>
      `Wiped ${calls} calls, ${threads} jobs, ${notes} notes`,
    onOk: () => {
      // Prefix match, so every loaded history page goes too.
      revalidate(queryKey.memory);
      revalidate(queryKey.threads);
      revalidate(queryKey.callHistory(null));
    },
  });

  const confirmReset = async () => {
    const confirmed = await notify.confirm({
      title: "Reset history?",
      description:
        "Every call, every job and everything she remembers is deleted for good. Keys, bots and connectors stay.",
      okText: "Reset",
      destructive: true,
    });
    if (confirmed) reset();
  };

  return (
    <div className="flex min-w-0 items-center gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <TriangleAlert className="size-4" />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block truncate text-sm font-medium">
          Reset history
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          Calls, jobs and memory. Keys and bots stay.
        </span>
      </span>
      <Button
        variant="outline"
        size="sm"
        loading={resetting}
        onClick={confirmReset}
        className="shrink-0 text-destructive hover:text-destructive"
      >
        Reset
      </Button>
    </div>
  );
}

/**
 * Face picker with a live preview on top. Color applies to both faces; the
 * rest belongs to one face and shows only while that face is on.
 */
function FacePicker({
  value,
  onChange,
}: {
  value: ThursdayFace;
  onChange: (face: ThursdayFace) => void;
}) {
  const patch = (change: Partial<ThursdayFace>) =>
    onChange({ ...value, ...change });

  return (
    <SettingGroup label="Face">
      {/* No panel or border: the face is drawn in theme ink, and a panel behind it reads as a picture on a card */}
      <div className="space-y-5 py-2">
        {/* Same layout as the call screen: face above, one line below */}
        <div className="flex flex-col items-center gap-4 pt-2">
          <Face look={value} className="w-44" />
        </div>

        <Row label="Glyphs">
          <Segmented
            aria-label="Glyphs"
            options={ASCII_CHARSETS.map((charset) => ({
              value: charset,
              label: CHARSET_LABEL[charset],
            }))}
            value={value.charset}
            onChange={(charset) => patch({ charset })}
          />
        </Row>

        <Row label="Size">
          <Slider
            min={ASCII_FACE.fontSize.min}
            max={ASCII_FACE.fontSize.max}
            step={1}
            value={value.fontSize}
            format={(n) => `${n}px`}
            onChange={(fontSize) => patch({ fontSize })}
          />
        </Row>

        <Row label="Density">
          <Slider
            min={ASCII_FACE.density.min}
            max={ASCII_FACE.density.max}
            step={0.1}
            value={value.density}
            format={(n) => `${n.toFixed(1)}x`}
            onChange={(density) => patch({ density })}
          />
        </Row>
      </div>
    </SettingGroup>
  );
}

/** "emojiOnly" is the orb's name; the screen shows a friendlier one. */
const CHARSET_LABEL: Record<AsciiCharset, string> = {
  ascii: "Characters",
  emoji: "Sprinkled",
  emojiOnly: "All emoji",
};

/** One knob per row, with a label slot. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function Slider({
  value,
  onChange,
  format,
  ...range
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <input
        type="range"
        {...range}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-w-0 flex-1 accent-brand"
      />
      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
        {format(value)}
      </span>
    </span>
  );
}

const CAPTION_LABEL: Record<CaptionView, { label: string; hint: string }> = {
  center: {
    label: "Her last line",
    hint: "One caption under the mark — only what she said.",
  },
  sides: {
    label: "Both sides",
    hint: "Hers on the left, yours on the right. Click a line to read it again.",
  },
};

/** How much of the conversation shows while speaking, picked by what it looks like. */
function Captions({
  value,
  onChange,
}: {
  value: CaptionView;
  onChange: (view: CaptionView) => void;
}) {
  return (
    <SettingGroup label="Captions">
      <div className="@container">
        <div
          role="radiogroup"
          aria-label="Captions"
          className="grid gap-3 @xl:grid-cols-2"
        >
          {CAPTION_VIEWS.map((view) => {
            const picked = view === value;
            return (
              <button
                key={view}
                type="button"
                role="radio"
                aria-checked={picked}
                onClick={() => onChange(view)}
                className={cn(
                  "min-w-0 space-y-3 rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                  picked
                    ? "border-brand bg-brand/4"
                    : "border-border/60 hover:bg-muted/50",
                )}
              >
                <CaptionSketch view={view} />
                <span className="flex items-center gap-3 px-1 pb-0.5">
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block truncate text-sm font-medium">
                      {CAPTION_LABEL[view].label}
                    </span>
                    <span className="block text-xs text-pretty text-muted-foreground">
                      {CAPTION_LABEL[view].hint}
                    </span>
                  </span>
                  {picked && <Check className="size-4 shrink-0 text-brand" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </SettingGroup>
  );
}

/** The call screen in miniature: her mark, and where the words sit. */
function CaptionSketch({ view }: { view: CaptionView }) {
  const line = "block h-1 max-w-full rounded-full bg-foreground/20";

  return (
    <span className="flex h-24 items-center justify-center rounded-lg bg-muted">
      {view === "center" ? (
        <span className="flex flex-col items-center gap-2.5">
          <ThursdayMark size={32} />
          <span className={cn(line, "w-28")} />
        </span>
      ) : (
        <span className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-6">
          <span className="space-y-1.5">
            <span className={cn(line, "w-24")} />
            <span className={cn(line, "w-16")} />
          </span>
          <ThursdayMark size={32} />
          <span>
            <span className={cn(line, "ml-auto w-20")} />
          </span>
        </span>
      )}
    </span>
  );
}

/** Whether a call may be opened without the user. Modes are in thursday.schema CALL_BACK_MODES. */
function CallBackPicker({
  value,
  onChange,
}: {
  value: CallBack;
  onChange: (mode: CallBack) => void;
}) {
  return (
    <div className="min-w-0 space-y-3 p-4">
      <TileHead label="She calls you" />
      <RadioGroup
        aria-label="She calls you"
        value={value}
        onValueChange={(mode) => onChange(CallBackSchema.parse(mode))}
        className="gap-2.5"
      >
        {CALL_BACK_MODES.map((mode) => (
          <label
            key={mode}
            className="flex min-w-0 items-center gap-2.5 text-sm"
          >
            <RadioGroupItem value={mode} />
            <span className="truncate">{CALL_BACK_LABEL[mode]}</span>
          </label>
        ))}
      </RadioGroup>
      <SettingNote>{CALL_BACK_HINT[value]}</SettingNote>
      {value !== "off" && (
        <SettingNote>
          Needs this tab open. It rings until you answer, decline or let it go.
        </SettingNote>
      )}
    </div>
  );
}

/** Hints for the three modes; names come from the schema. */
const CALL_BACK_HINT: Record<CallBack, string> = {
  off: "Nothing opens a call but you.",
  waiting: "A job that stopped to ask gets her to ring you.",
  any: "Anything a bot finishes, she rings you to tell you.",
};

/**
 * Wake word switch and phrase. Enabled means the browser recognizer holds the
 * mic between calls. Saved on blur, not per keystroke.
 */
function WakeWord({
  value,
  onChange,
}: {
  value: Wake;
  onChange: (wake: Wake) => void;
}) {
  // too short keeps the old phrase rather than losing it (use-draft)
  const draft = useDraft(
    value.phrase,
    (phrase) => onChange({ ...value, phrase }),
    { min: WAKE_PHRASE.min },
  );

  // the schema cannot require two words (one word parses fine and then wakes all day), so warn while typing
  const terse = draft.value.trim().split(/\s+/).length < 2;

  return (
    <div className="min-w-0 space-y-3 p-4">
      <TileHead label="Wake phrase">
        <Switch
          aria-label="Answer to her name"
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
        />
      </TileHead>
      <Input
        value={draft.value}
        maxLength={WAKE_PHRASE.max}
        spellCheck={false}
        disabled={!value.enabled}
        onChange={(event) => draft.set(event.target.value)}
        onBlur={draft.commit}
        onKeyDown={draft.onKeyDown}
        aria-label="Wake phrase"
        className="font-mono text-sm"
      />
      <SettingNote>
        {!value.enabled
          ? "Between calls, the browser listens for it and picks up."
          : terse
            ? "One word will wake her by accident — say hello first."
            : "Heard loosely, in English. Near misses count."}
      </SettingNote>
    </div>
  );
}

/**
 * Keyboard shortcut for opening and ending a call, for browsers with no
 * recognizer or rooms where speaking is not an option. Recorded by pressing,
 * stored as key positions (use-hotkey).
 */
function Shortcut({
  value,
  onChange,
}: {
  value: Hotkey;
  onChange: (hotkey: Hotkey) => void;
}) {
  const [listening, setListening] = useState(false);
  /** Pressed without a modifier; explains why nothing happened. */
  const [bare, setBare] = useState(false);
  const label = useHotkeyLabel(isCombo(value.combo) ? value.combo : null);

  const record = (event: ReactKeyboardEvent) => {
    // Tab is the only way out of this control; leave it alone
    if (event.key === "Tab") return;
    event.preventDefault();
    // while recording nothing reaches the dialog: Esc must cancel the combo, not close settings
    event.stopPropagation();
    if (event.key === "Escape") return setListening(false);

    const combo = comboOf(event.nativeEvent);
    if (!combo) return setBare(true);
    setBare(false);
    setListening(false);
    onChange({ ...value, combo });
  };

  return (
    <div className="min-w-0 space-y-3 p-4">
      <TileHead label="Shortcut">
        <Switch
          aria-label="Answer to a key"
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
        />
      </TileHead>
      <button
        type="button"
        {...HOTKEY_CAPTURE}
        disabled={!value.enabled}
        onClick={() => {
          setBare(false);
          setListening(true);
        }}
        onBlur={() => setListening(false)}
        onKeyDown={listening ? record : undefined}
        className={cn(
          "flex h-8 w-full items-center justify-center rounded-lg border px-3 font-mono text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
          listening
            ? "border-foreground/40 text-muted-foreground"
            : "border-border/60 hover:bg-muted/50",
        )}
      >
        {listening ? "Press the keys…" : (label ?? "Set a shortcut")}
      </button>
      <SettingNote>
        {bare
          ? "Hold Ctrl, Alt or Cmd — a plain key is typing."
          : listening
            ? "Esc to keep the one you have."
            : value.enabled
              ? "Only while this tab has focus. Not while you are typing."
              : "Starts a call, and ends the one that is running."}
      </SettingNote>
    </div>
  );
}
