"use client";

import {
  Check,
  ChevronsUpDown,
  Copy,
  Power,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
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
import { ShinyText } from "@/components/ui/shiny-text";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { COMMON_VALIDATE, KEY_MIN } from "@/config";
import { ChatGptSignIn } from "@/features/ai/components/chatgpt-sign-in";
import { EffortSwitch } from "@/features/ai/components/effort-switch";
import {
  LIVE_BACKEND_MODELS,
  LIVE_DEFAULTS,
  LIVE_LINES,
  LIVE_PLAN_VOICES,
  LIVE_PROVIDER,
  type LiveLine,
  type LiveSettings,
  liveLineOf,
  liveLineReady,
} from "@/features/ai/live.schema";
import {
  type AiProvider,
  planName,
  TEXT_MODEL_PROVIDERS,
} from "@/features/ai/model.schema";
import { DEFAULT_PERSONA, PERSONAS } from "@/features/ai/prompts/persona";
import { CallLines, KeyInput } from "@/features/config/components/voice-key";
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
import type { Running } from "@/features/settings/running";
import type { Update } from "@/features/settings/update";
import { moveTo, useUpdateStore } from "@/features/settings/update.store";
import type { SkillSummary } from "@/features/skills/skills.schema";
import { CallHistoryRow } from "@/features/thursday/components/call-log";
import { ThursdayMark } from "@/features/thursday/components/thursday-mark";
import { VoicePicker } from "@/features/thursday/components/voice-picker";
import { resetHistoryAction } from "@/features/thursday/thursday.action";
import {
  CALL_BACK_MODES,
  CAPTION_VIEWS,
  type CallBack,
  CallBackSchema,
  type CaptionView,
  type Hotkey,
  isEnglishPhrase,
  WAKE_PHRASE,
  type Wake,
} from "@/features/thursday/thursday.schema";
import { useThursdayStore } from "@/features/thursday/thursday.store";
import { useLiveSettings } from "@/features/thursday/use-live-settings";
import { useDraft } from "@/hooks/use-draft";
import {
  comboOf,
  HOTKEY_CAPTURE,
  isCombo,
  useHotkeyLabel,
} from "@/hooks/use-hotkey";
import { useLocale } from "@/hooks/use-locale";
import { LIVE_MODEL, LIVE_PLAN_MODEL } from "@/lib/live/live.schema";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { revalidate, useServerRoute } from "@/lib/protocol/use-server-route";
import { cn, WAITING_INK } from "@/lib/utils";
import { settingsDictOf, type ThursdayDict } from "@/messages";

/**
 * Settings for the call: captions, the two models, how a call starts, and its
 * history. Her face is not among them: it is drawn one way for everyone (config
 * ASCII_FACE). Who she is and what she may do is the app's, kept where a call reads it
 * (use-live-settings); how this machine talks to her — captions, the wake phrase, the
 * hotkey — stays in the browser (thursday.store).
 */
export function ThursdaySetting() {
  // This machine's own: no waiting, no revalidation
  const thursday = useThursdayStore();
  const patch = useThursdayStore((state) => state.patch);
  // Hers: read from the server, so a second computer draws the same answers
  const { settings, patch: change } = useLiveSettings();
  const t = settingsDictOf(useLocale()).thursday;

  const {
    data: providers = [],
    isLoading,
    error,
  } = useServerRoute<AiProvider[]>(queryKey.llmModel);

  if (isLoading || !settings) return <SettingSkeleton rows={4} />;
  if (error) return <SettingError message={error.message} />;

  const has = (key: string) =>
    providers.some((entry) => entry.apiKeyName === key && entry.hasKey);

  return (
    <SettingScreen footer={<SettingRailNote>{t.footer}</SettingRailNote>}>
      <Captions
        value={thursday.captionView}
        onChange={(captionView) => patch({ captionView })}
      />

      <ModelsSetting
        value={settings}
        has={has}
        plan={providers.find((entry) => entry.id === "chatgpt")?.plan ?? null}
        onChange={change}
      />

      {/* Every way a call starts other than pressing her face, read at once */}
      <SettingGroup label={t.groups.starting}>
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

      <SettingGroup label={t.groups.running}>
        <RunningRow />
      </SettingGroup>

      <SettingGroup label={t.groups.history}>
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

/** The two lines a spoken call opens on, as the switch names them, and the voice model each opens. */
function lineModels(
  t: ThursdayDict,
): Record<LiveLine, { model: string; label: string }> {
  return {
    chatgpt: { model: LIVE_PLAN_MODEL, label: t.gptLabel },
    openai: { model: LIVE_MODEL, label: t.keyLabel },
  };
}

/**
 * Both models a call runs on, in one card: the Live voice and the Responses
 * backend that holds her tools (thursday.prompt). They run on one line — the
 * GPT Subscription's own voice or the OpenAI key (live.schema liveLineOf) — so
 * the line is picked once, above both. Both lines are always on the switch, so
 * what a call runs on, and the other way it could, is read here whatever is set:
 * a line picked that is not set up asks for its sign-in or key in place, and a
 * call goes on the other one meanwhile. A call that fails to open sends the user
 * here (use-thursday).
 */
function ModelsSetting({
  value,
  has,
  plan: signedPlan,
  onChange,
}: {
  value: LiveSettings;
  has: (key: string) => boolean;
  /** The plan the sign-in is on, as the token names it; null when it does not say. */
  plan: string | null;
  onChange: (change: Partial<LiveSettings>) => void;
}) {
  const line = liveLineOf(value.runsOn, has, signedPlan);
  // Set up and able to open a call: a Free sign-in is set, but has no spoken calls
  const ready = (one: LiveLine) => liveLineReady(one, has, signedPlan);
  const signedIn = has(TEXT_MODEL_PROVIDERS.chatgpt.apiKeyName);
  // The line picked here that has no sign-in or key yet: shown picked, and asked for below
  const [setup, setSetup] = useState<LiveLine | null>(null);
  const waiting = setup && !ready(setup) ? setup : null;
  const plan = line === "chatgpt";
  const t = settingsDictOf(useLocale()).thursday;
  const models = lineModels(t);
  return (
    <SettingGroup
      label={t.groups.models}
      note={`${plan ? t.modelsNotePlan : t.modelsNoteKey}. ${t.modelsNoteSuffix}`}
    >
      <div className="@container divide-y divide-border/60 rounded-xl border border-border/60">
        {!line && (
          <KeyRow plan={signedIn ? (planName(signedPlan) ?? "") : null} />
        )}

        <ModelSection name={t.voiceSection} fact={plan ? t.onPlan : t.byMinute}>
          {line && (
            <ModelBlock label={t.runsOn}>
              <Segmented
                options={LIVE_LINES.map((one) => ({
                  value: one,
                  label: lineLabel(one, t, {
                    ready: ready(one),
                    set: has(TEXT_MODEL_PROVIDERS[one].apiKeyName),
                    plan: planName(signedPlan),
                  }),
                }))}
                value={waiting ?? line}
                onChange={(runsOn) => {
                  setSetup(ready(runsOn) ? null : runsOn);
                  onChange({ runsOn });
                }}
                aria-label={t.runsOnAria}
              />
              {waiting ? (
                <LineSetup
                  line={waiting}
                  runsOn={line}
                  plan={signedIn ? planName(signedPlan) : null}
                />
              ) : (
                <span className="block font-mono text-[11px] text-muted-foreground/70">
                  {models[line].model}
                </span>
              )}
            </ModelBlock>
          )}

          {/* Its own row: opened, the picker holds her face beside the voices. The plan's voice
              speaks in voices of its own, with no recorded lines to play */}
          <ModelBlock label={t.voiceBlock}>
            {plan ? (
              <Combobox
                value={value.planVoice}
                onChange={(voice) =>
                  onChange({
                    planVoice: voice.trim() || LIVE_DEFAULTS.planVoice,
                  })
                }
                options={LIVE_PLAN_VOICES.map((voice) => ({
                  value: voice,
                  label: voice,
                }))}
                aria-label={t.planVoiceAria}
              />
            ) : (
              <VoicePicker
                voice={value.voice}
                onChange={(voice) =>
                  onChange({ voice: voice.trim() || LIVE_DEFAULTS.voice })
                }
              />
            )}
          </ModelBlock>

          <ModelBlock label={t.styleBlock}>
            <StylePicker
              value={value.persona}
              own={value.stylePrompt}
              onPersona={(persona) => onChange({ persona })}
              onOwn={(stylePrompt) => onChange({ stylePrompt })}
            />
          </ModelBlock>
        </ModelSection>

        <ModelSection
          name={t.backendSection}
          fact={plan ? t.onPlan : t.perToken}
        >
          <ModelBlock label={t.modelBlock}>
            <BackendModelPicker
              value={value.backendModel}
              onChange={(backendModel) => onChange({ backendModel })}
            />
          </ModelBlock>

          {/* Auto omits the parameter, so a model without reasoning still runs */}
          <ModelBlock label={t.effortBlock}>
            <EffortSwitch
              provider="openai"
              model={value.backendModel}
              value={value.reasoningEffort}
              onChange={(reasoningEffort) => onChange({ reasoningEffort })}
            />
          </ModelBlock>

          <ModelBlock label={t.toolsBlock}>
            <BackendTools
              webSearch={value.webSearch}
              readSkills={value.readSkills}
              onChange={onChange}
            />
          </ModelBlock>

          <ModelBlock label={t.instructionsBlock}>
            <PromptField
              value={value.backendPrompt}
              onCommit={(backendPrompt) => onChange({ backendPrompt })}
              placeholder={t.instructionsPlaceholder}
              aria-label={t.instructionsAria}
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
 * Which character she is, and under it the user's own words when they want them. Four of
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
  onOwn: (stylePrompt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Written words are the reason the field is open; closing it would hide them
  const [writing, setWriting] = useState(false);
  const t = settingsDictOf(useLocale()).thursday;
  const personas = PERSONAS.map((one) => ({
    ...one,
    ...(t.personas[one.id] ?? {}),
  }));
  const picked =
    personas.find((one) => one.id === value) ??
    personas.find((one) => one.id === DEFAULT_PERSONA) ??
    personas[0];

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
            {t.styleHint}
          </p>
          {personas.map((one) => (
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
            <span className="w-20 shrink-0 text-sm font-medium">
              {t.yourOwn}
            </span>
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
              {t.yourOwnAbout}
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
          placeholder={t.yourOwnPlaceholder}
          aria-label={t.yourOwnAria}
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

/**
 * A line on the switch: its name, with the plan it is on, or what it still needs — a sign-in, a
 * key, or, signed in on a plan without spoken calls, that it has none.
 */
function lineLabel(
  line: LiveLine,
  t: ThursdayDict,
  {
    ready,
    set,
    plan,
  }: {
    ready: boolean;
    set: boolean;
    plan: string | null;
  },
): string {
  const { label } = lineModels(t)[line];
  if (set && !ready) return `${label}${t.lineNeedsPlan(plan ?? "")}`;
  if (!ready)
    return `${label}${line === "chatgpt" ? t.lineNeedsSignIn : t.lineNeedsKey}`;
  return line === "chatgpt" && plan ? `${label} · ${plan}` : label;
}

/**
 * A line picked on the switch that has no sign-in or key yet: it is asked for here, and a call
 * runs on the line that is set until it is in (live.schema liveLineOf).
 */
function LineSetup({
  line,
  runsOn,
  plan,
}: {
  line: LiveLine;
  runsOn: LiveLine;
  /** Signed in already, on this plan: one without spoken calls. */
  plan: string | null;
}) {
  const [draft, setDraft] = useState("");
  const [save, saving] = useServerAction(setConfigAction, {
    onOk: () => {
      revalidate(queryKey.llmModel);
      revalidate(queryKey.config);
      setDraft("");
    },
  });
  const ready = draft.trim().length >= KEY_MIN;
  const t = settingsDictOf(useLocale()).thursday;
  const models = lineModels(t);
  return (
    <div className="space-y-2.5 pt-1">
      <span className="block text-xs text-muted-foreground">
        {line === "chatgpt"
          ? plan
            ? t.planNoCalls(plan)
            : t.planSignInHint
          : t.keyHint}{" "}
        {t.runsMeanwhile(models[runsOn].label)}
      </span>
      {line === "chatgpt" ? (
        <ChatGptSignIn
          variant="brand"
          size="sm"
          label={plan ? t.signInAgain : undefined}
        />
      ) : (
        <KeyInput
          dense
          provider={LIVE_PROVIDER}
          saved={false}
          autoFocus
          value={draft}
          ready={ready}
          saving={saving}
          onValue={setDraft}
          onSubmit={() => ready && save(LIVE_PROVIDER.apiKeyName, draft)}
        />
      )}
    </div>
  );
}

/**
 * Neither line can open a call: the first run's two ways, above both models, instead of leaving
 * for Keys. `plan` is the plan a sign-in without spoken calls is on.
 */
function KeyRow({ plan }: { plan: string | null }) {
  const t = settingsDictOf(useLocale()).thursday;
  return (
    <div className="space-y-3 p-5">
      <span className="block space-y-0.5">
        <span className={cn("block text-sm font-medium", WAITING_INK)}>
          {plan === null ? t.keyRowNone : t.keyRowPlanNoCalls(plan)}
        </span>
        <span className="block text-xs text-muted-foreground">
          {t.keyRowHint}
        </span>
      </span>
      <div className="max-w-md">
        <CallLines />
      </div>
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
  const t = settingsDictOf(useLocale()).thursday;
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
        aria-label={t.backendModelAria}
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
        placeholder={t.otherModelPlaceholder}
        aria-label={t.otherModelAria}
        spellCheck={false}
        className="font-mono text-sm"
      />
    </div>
  );
}

/**
 * What the backend may reach for. Both switches are the app's (LiveSettings), because
 * tools are built where no browser is. The skills switch hands the call `load_skill` and is
 * off by default: reading a skill is a page of instructions arriving mid-sentence.
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
  const t = settingsDictOf(useLocale()).thursday;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-7 gap-y-3">
        <InlineSwitch
          label={t.webSearch}
          checked={webSearch}
          onChange={(on) => onChange({ webSearch: on })}
        />
        <InlineSwitch
          label={t.readSkills}
          checked={readSkills}
          onChange={(on) => onChange({ readSkills: on })}
        />
      </div>
      {webSearch && <SettingNote>{t.searchNote}</SettingNote>}
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
  const t = settingsDictOf(useLocale()).thursday;
  if (!data) return null;

  return (
    <SettingNote className={cn(!data.length && WAITING_INK)}>
      {data.length ? t.skillsNote(data.length) : t.noSkills}
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
  const t = settingsDictOf(useLocale()).thursday;
  const [reset, resetting] = useServerAction(resetHistoryAction, {
    okMessage: ({ calls, threads, notes }) =>
      t.resetWiped(calls, threads, notes),
    onOk: () => {
      // Prefix match, so every loaded history page goes too.
      revalidate(queryKey.memory);
      revalidate(queryKey.threads);
      revalidate(queryKey.callHistory(null));
    },
  });

  const confirmReset = async () => {
    const confirmed = await notify.confirm({
      title: t.resetConfirmTitle,
      description: t.resetConfirmBody,
      okText: t.resetConfirmOk,
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
          {t.resetTitle}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {t.resetHint}
        </span>
      </span>
      <Button
        variant="outline"
        size="sm"
        loading={resetting}
        onClick={confirmReset}
        className="shrink-0 text-destructive hover:text-destructive"
      >
        {t.resetButton}
      </Button>
    </div>
  );
}

/**
 * Where the app runs, which version, and the one command that changes it. The app never stops
 * itself (bin/background.mjs): a server that stopped itself from a click would leave this page
 * with nothing behind it. It does move itself to a newer version, in the background, at a press:
 * that command brings the new one up, or the one before back (features/settings/update.ts).
 * Anywhere else the move is a line to copy.
 */
function RunningRow() {
  const locale = useLocale();
  const t = settingsDictOf(locale).thursday;
  const { data } = useServerRoute<Running>(queryKey.running);
  // The server is down for a moment during a move: a read that fails then is not news
  const { data: update } = useServerRoute<Update>(queryKey.update, {
    onError: () => {},
  });
  const { to, failed } = useUpdateStore();
  if (!data) return <Skeleton className="h-16 w-full rounded-xl" />;

  const { where, mac, command, start, home } = data;
  const newer = update?.newer ?? null;
  const move = newer && update?.command ? update.command : null;
  const said = {
    background: {
      title: t.runningTitles.background,
      hint: t.runningHints.background,
      how: command && { label: t.runningStop, run: `${command} stop` },
    },
    terminal: {
      title: t.runningTitles.terminal,
      hint: t.runningHints.terminal,
      how:
        start && mac
          ? {
              label: t.runningKeep,
              run: start,
            }
          : null,
    },
    source: {
      title: t.runningTitles.source,
      hint: t.runningHints.source,
      how: null,
    },
    elsewhere: {
      title: t.runningTitles.elsewhere,
      hint: t.runningHints.elsewhere,
      how: null,
    },
  }[where];

  return (
    <div className="space-y-3 rounded-xl border border-border/60 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          {where === "background" ? (
            <Power className="size-4" />
          ) : (
            <SquareTerminal className="size-4" />
          )}
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block truncate text-sm font-medium">
            {said.title}
            {update?.current && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {update.current}
              </span>
            )}
          </span>
          {to ? (
            <span className="block text-xs text-muted-foreground">
              <ShinyText text={t.runningUpdateTo(to)} /> {t.runningRestarting}
            </span>
          ) : newer ? (
            <span className="block text-xs">{t.runningOut(newer)}</span>
          ) : (
            <span className="block text-xs text-muted-foreground">
              {said.hint}
              {where === "terminal" && !mac ? t.runningMacOnly : ""}
              {update?.unreached ? t.runningUnreached : ""}
            </span>
          )}
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {home}
          </span>
        </span>
        {newer && update?.byButton && !to && (
          <Button size="sm" onClick={() => void moveTo(newer)}>
            {t.runningUpdate}
          </Button>
        )}
      </div>
      {failed && !to && (
        <div className="space-y-1 pl-13 text-xs">
          <p className="text-destructive">{t.runningUpdateFail(failed.to)}</p>
          <p className="line-clamp-3 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
            {failed.why}
          </p>
        </div>
      )}
      {move && !to && (failed || !update?.byButton) && (
        <div className="flex flex-wrap items-center gap-2 pl-13 text-xs text-muted-foreground">
          <span>
            {where === "terminal" ? t.runningMovePress : t.runningMoveTo}
          </span>
          <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {move}
          </code>
          <CopyCommand text={move} />
        </div>
      )}
      {said.how && (
        <div className="flex flex-wrap items-center gap-2 pl-13 text-xs text-muted-foreground">
          <span>{said.how.label}</span>
          <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {said.how.run}
          </code>
          <CopyCommand text={said.how.run} />
        </div>
      )}
    </div>
  );
}

function CopyCommand({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const t = settingsDictOf(useLocale()).thursday;
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2_000);
        })
      }
    >
      {copied ? <Check /> : <Copy />}
      {copied ? t.copied : t.copy}
    </Button>
  );
}

/** How much of the conversation shows while speaking, picked by what it looks like. */
function Captions({
  value,
  onChange,
}: {
  value: CaptionView;
  onChange: (view: CaptionView) => void;
}) {
  const t = settingsDictOf(useLocale()).thursday;
  const labels = {
    center: t.captionCenter,
    sides: t.captionSides,
  } as const;
  return (
    <SettingGroup label={t.groups.captions}>
      <div className="@container">
        <div
          role="radiogroup"
          aria-label={t.captionsAria}
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
                      {labels[view].label}
                    </span>
                    <span className="block text-xs text-pretty text-muted-foreground">
                      {labels[view].hint}
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
  const t = settingsDictOf(useLocale()).thursday;
  return (
    <div className="min-w-0 space-y-3 p-4">
      <TileHead label={t.callBackTitle} />
      <RadioGroup
        aria-label={t.callBackAria}
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
            <span className="truncate">{t.callBackNames[mode]}</span>
          </label>
        ))}
      </RadioGroup>
      <SettingNote>{t.callBackHint[value]}</SettingNote>
      {value !== "off" && <SettingNote>{t.callBackNeedsTab}</SettingNote>}
    </div>
  );
}

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
  // too short, or not English, keeps the old phrase rather than losing it (use-draft)
  const draft = useDraft(
    value.phrase,
    (phrase) => onChange({ ...value, phrase }),
    { min: WAKE_PHRASE.min, accepts: isEnglishPhrase },
  );
  const english = isEnglishPhrase(draft.value) || !draft.value.trim();

  // the schema cannot require two words (one word parses fine and then wakes all day), so warn while typing
  const terse = draft.value.trim().split(/\s+/).length < 2;
  const t = settingsDictOf(useLocale()).thursday;

  return (
    <div className="min-w-0 space-y-3 p-4">
      <TileHead label={t.wakeTitle}>
        <Switch
          aria-label={t.wakeSwitch}
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
        aria-label={t.wakeAria}
        className="font-mono text-sm"
      />
      <SettingNote>
        {!value.enabled
          ? t.wakeOff
          : !english
            ? t.wakeNotEnglish
            : terse
              ? t.wakeTerse
              : t.wakeOn}
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
  const t = settingsDictOf(useLocale()).thursday;

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
      <TileHead label={t.shortcutTitle}>
        <Switch
          aria-label={t.shortcutSwitch}
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
        {listening ? t.shortcutRecording : (label ?? t.shortcutEmpty)}
      </button>
      <SettingNote>
        {bare
          ? t.shortcutBare
          : listening
            ? t.shortcutListening
            : value.enabled
              ? t.shortcutFocused
              : t.shortcutOff}
      </SettingNote>
    </div>
  );
}
