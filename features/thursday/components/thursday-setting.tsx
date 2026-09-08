"use client";

import { Check, TriangleAlert } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useState,
} from "react";
import { queryKey } from "@/app/api/query-key";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Swatch } from "@/components/ui/swatch";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ProviderIcon } from "@/features/ai/components/provider-icon";
import {
  type AiProvider,
  SPEACH_MODEL_PROVIDER_LIST,
  type SpeachModelRef,
} from "@/features/ai/model.schema";
import { MARK_PALETTE_ROWS, MARK_SHAPES } from "@/features/bot/mark.const";
import {
  SettingChoiceRows,
  SettingError,
  SettingItems,
  SettingRailNote,
  SettingScreen,
  SettingSkeleton,
} from "@/features/settings/components/setting-ui";
import { CallHistoryRow } from "@/features/thursday/components/call-log";
import { FACES, Face } from "@/features/thursday/components/face";
import {
  ASCII_CHARSETS,
  type AsciiCharset,
  FACE_KINDS,
} from "@/features/thursday/face.const";
import {
  setThursdayFace,
  useThursdayFace,
} from "@/features/thursday/face.store";
import {
  CALL_BACK_LABEL,
  CALL_BACK_MODES,
  CAPTION_VIEWS,
  type CallBack,
  type CaptionView,
  type Hotkey,
  type ThursdayFace,
  WAKE_PHRASE,
  type Wake,
} from "@/features/thursday/thursday.schema";
import { useThursdayStore } from "@/features/thursday/thursday.store";
import { useDraft } from "@/hooks/use-draft";
import {
  comboOf,
  HOTKEY_CAPTURE,
  isCombo,
  useHotkeyLabel,
} from "@/hooks/use-hotkey";
import { COMMON_VALIDATE } from "@/lib/limits";
import { useServerRoute } from "@/lib/protocol/use-server-route";
import { cn } from "@/lib/utils";

/**
 * Settings for the call: face, voice provider, captions, wake word, call-back,
 * shortcut, instructions. The face is kept in the browser (face.store).
 */
export function ThursdaySetting() {
  // local store: no waiting, no revalidation
  const thursday = useThursdayStore();
  const patch = useThursdayStore((state) => state.patch);

  const {
    data: providers = [],
    isLoading,
    error,
  } = useServerRoute<AiProvider[]>(queryKey.llmModel);
  const face = useThursdayFace();

  if (isLoading) return <SettingSkeleton rows={4} />;
  if (error) return <SettingError message={error.message} />;

  const picked = thursday.model?.provider ?? null;
  const hasKey = (name: string) =>
    providers.some((entry) => entry.apiKeyName === name && entry.hasKey);

  return (
    // Her controls are a face and a handful of switches; 880 leaves them stranded
    <SettingScreen
      width="narrow"
      footer={
        <SettingRailNote>
          Her prompt is assembled fresh on every call — memory, the roster and
          your skills go in.
        </SettingRailNote>
      }
    >
      <FacePicker value={face} onChange={setThursdayFace} />

      {/* Read, not changed, so it sits at the top */}
      <CallHistoryRow />

      <section className="space-y-2">
        <span className="font-mono text-xs text-muted-foreground">Voice</span>
        <SettingItems>
          {SPEACH_MODEL_PROVIDER_LIST.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              // only the picked provider gets a value; model and voice are that provider's names
              value={picked === provider.id ? thursday.model : null}
              hasKey={hasKey(provider.apiKeyName)}
              onPick={(next) =>
                patch({ model: { provider: provider.id, ...next } })
              }
            />
          ))}
        </SettingItems>
        {!picked && (
          <p className="px-1 font-mono text-[11px] text-muted-foreground">
            Nothing picked — calls run on whichever key is set.
          </p>
        )}
      </section>

      <Captions
        value={thursday.captionView}
        onChange={(captionView) => patch({ captionView })}
      />

      <WakeWord value={thursday.wake} onChange={(wake) => patch({ wake })} />

      <CallBackPicker
        value={thursday.callBack}
        onChange={(callBack) => patch({ callBack })}
      />

      <Shortcut
        value={thursday.hotkey}
        onChange={(hotkey) => patch({ hotkey })}
      />

      <Instructions
        value={thursday.systemPrompt ?? ""}
        onSave={(systemPrompt) => patch({ systemPrompt })}
      />
    </SettingScreen>
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
    <section className="space-y-2">
      <span className="font-mono text-xs text-muted-foreground">Face</span>

      {/* No panel or border: the face is drawn in theme ink, and a panel behind it reads as a picture on a card */}
      <div className="space-y-5 py-2">
        {/* Same layout as the call screen: face above, one line below */}
        <div className="flex flex-col items-center gap-4 pt-2">
          <Face look={value} size={176} className="w-44" />

          <Segmented
            aria-label="Face"
            options={FACE_KINDS.map((kind) => ({
              value: kind,
              label: FACES[kind].label,
            }))}
            value={value.kind}
            onChange={(kind) => patch({ kind })}
          />

          <p className="max-w-sm text-center text-xs text-muted-foreground">
            {FACES[value.kind].hint}
          </p>
        </div>

        {/* Only the mark takes a color; the orb follows the theme (OrbFace ignores it).
            Rows break where the palette breaks (MARK_PALETTE_ROWS); the theme dot stands apart. */}
        {value.kind === "mark" && (
          // both rows center as one block and left-align inside it
          <div className="flex justify-center px-2">
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Swatch
                  color={null}
                  picked={!value.color}
                  onPick={() => patch({ color: undefined })}
                />
                <span className="w-2" />
                {MARK_PALETTE_ROWS[0].map((color) => (
                  <Swatch
                    key={color}
                    color={color}
                    picked={value.color === color}
                    onPick={() => patch({ color })}
                  />
                ))}
              </div>
              {/* indent by the theme dot and its gap so the dark row lines up under the first light color */}
              <div className="flex flex-wrap items-center gap-2 pl-9">
                {MARK_PALETTE_ROWS[1].map((color) => (
                  <Swatch
                    key={color}
                    color={color}
                    picked={value.color === color}
                    onPick={() => patch({ color })}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {value.kind === "mark" && (
          <Row label="Shape">
            <Segmented
              aria-label="Shape"
              options={MARK_SHAPES.map((shape) => ({
                value: shape,
                label: <span className="capitalize">{shape}</span>,
              }))}
              value={value.shape ?? "blob"}
              onChange={(shape) => patch({ shape })}
            />
          </Row>
        )}

        {value.kind === "mark" && (
          <Row label="Style">
            <Segmented
              aria-label="Style"
              options={[
                { value: "solid", label: "Solid" },
                { value: "outline", label: "Outline" },
              ]}
              value={value.outline ? "outline" : "solid"}
              onChange={(style) =>
                patch({ outline: style === "outline" ? true : undefined })
              }
            />
          </Row>
        )}

        {value.kind === "ascii" && (
          <>
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
                min={4}
                max={16}
                step={1}
                value={value.fontSize}
                format={(n) => `${n}px`}
                onChange={(fontSize) => patch({ fontSize })}
              />
            </Row>

            <Row label="Density">
              <Slider
                min={0.6}
                max={2}
                step={0.1}
                value={value.density}
                format={(n) => `${n.toFixed(1)}x`}
                onChange={(density) => patch({ density })}
              />
            </Row>
          </>
        )}
      </div>
    </section>
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
        className="min-w-0 flex-1 accent-foreground"
      />
      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
        {format(value)}
      </span>
    </span>
  );
}

/**
 * One provider row: model and voice unfold only once picked. The model is a
 * combobox because the list is open; new ids can be typed.
 */
function ProviderRow({
  provider,
  value,
  hasKey,
  onPick,
}: {
  provider: (typeof SPEACH_MODEL_PROVIDER_LIST)[number];
  /** null unless this provider is the picked one. */
  value: SpeachModelRef | null | undefined;
  hasKey: boolean;
  onPick: (next: Omit<SpeachModelRef, "provider">) => void;
}) {
  const picked = Boolean(value);
  const voice = value?.voice ?? provider.defaultVoice;
  const model = value?.model ?? "";

  return (
    <div className={cn("p-4", picked && "bg-muted/40")}>
      <button
        type="button"
        disabled={picked}
        onClick={() => onPick({ voice: null, model: null })}
        className="flex w-full items-center gap-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default"
      >
        <ProviderIcon provider={provider.id} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="block truncate text-sm font-medium">
            {provider.label}
          </span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {model || provider.models[0].id}
          </span>
        </span>

        {!hasKey ? (
          <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
            <TriangleAlert className="size-3" />
            No key
          </span>
        ) : (
          picked && <Check className="size-4 shrink-0" />
        )}
      </button>

      {/* Model and voices only matter once this is the one answering */}
      {picked && (
        <div className="space-y-3 pt-3">
          <Combobox
            value={model}
            onChange={(next) =>
              onPick({ voice: value?.voice ?? null, model: next || null })
            }
            options={provider.models.map((entry) => ({
              value: entry.id,
              label: entry.label,
              hint: entry.id,
            }))}
            aria-label={`${provider.label} realtime model`}
            placeholder={provider.models[0].id}
            empty="Not on the list — it still runs"
          />

          <div className="flex flex-wrap gap-1.5">
            {provider.voices.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() =>
                  onPick({ voice: name, model: value?.model ?? null })
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  name === voice
                    ? "border-foreground/40 text-foreground"
                    : "border-border/60 text-muted-foreground hover:text-foreground",
                )}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const CAPTION_LABEL: Record<CaptionView, { label: string; hint: string }> = {
  center: {
    label: "Her last line",
    hint: "One caption under the mark — only what she said.",
  },
  sides: {
    label: "Last three turns",
    hint: "Yours on the left, hers on the right, beside the mark.",
  },
};

/** Whether a call may be opened without the user. Modes are in thursday.schema CALL_BACK_MODES. */
function CallBackPicker({
  value,
  onChange,
}: {
  value: CallBack;
  onChange: (mode: CallBack) => void;
}) {
  return (
    <section className="space-y-2">
      <span className="font-mono text-xs text-muted-foreground">Calls you</span>
      <SettingChoiceRows
        options={CALL_BACK_MODES.map((mode) => ({
          value: mode,
          label: CALL_BACK_LABEL[mode],
          hint: CALL_BACK_HINT[mode],
        }))}
        value={value}
        onChange={onChange}
      />
      {value !== "off" && (
        <p className="px-1 font-mono text-[11px] text-muted-foreground">
          Needs this tab open. A tab that has been silent since it loaded may
          not be allowed to make a sound — the desktop notification covers that.
        </p>
      )}
    </section>
  );
}

/** Hints for the three modes; names come from the schema. */
const CALL_BACK_HINT: Record<CallBack, string> = {
  off: "Nothing opens a call but you.",
  waiting: "A job that stopped to ask gets her to ring you.",
  any: "Anything a bot finishes, she opens a line to tell you.",
};

/** How much of the conversation shows while speaking. */
function Captions({
  value,
  onChange,
}: {
  value: CaptionView;
  onChange: (view: CaptionView) => void;
}) {
  return (
    <section className="space-y-2">
      <span className="font-mono text-xs text-muted-foreground">Captions</span>
      <SettingChoiceRows
        options={CAPTION_VIEWS.map((view) => ({
          value: view,
          label: CAPTION_LABEL[view].label,
          hint: CAPTION_LABEL[view].hint,
        }))}
        value={value}
        onChange={onChange}
      />
    </section>
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
  // too short keeps the old phrase rather than losing it (use-draft)
  const draft = useDraft(
    value.phrase,
    (phrase) => onChange({ ...value, phrase }),
    { min: WAKE_PHRASE.min },
  );

  // the schema cannot require two words (one word parses fine and then wakes all day), so warn while typing
  const terse = draft.value.trim().split(/\s+/).length < 2;

  return (
    <section className="space-y-2">
      <span className="font-mono text-xs text-muted-foreground">Wake</span>

      <div className="space-y-3 rounded-xl bg-muted/30 p-4">
        <label className="flex items-center gap-3">
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="block text-sm font-medium">
              Answer to her name
            </span>
            <span className="block text-xs text-muted-foreground">
              Between calls, the browser listens for the phrase below and picks
              up when it hears it.
            </span>
          </span>
          <Switch
            checked={value.enabled}
            onCheckedChange={(enabled) => onChange({ ...value, enabled })}
          />
        </label>

        {value.enabled && (
          <div className="space-y-1.5">
            <Input
              value={draft.value}
              maxLength={WAKE_PHRASE.max}
              spellCheck={false}
              onChange={(event) => draft.set(event.target.value)}
              onBlur={draft.commit}
              onKeyDown={draft.onKeyDown}
              aria-label="Wake phrase"
              className="font-mono text-sm"
            />
            <p className="px-1 font-mono text-[11px] text-muted-foreground">
              {terse
                ? "One word will wake her by accident — say hello first."
                : "Heard loosely, in English. Near misses count."}
            </p>
          </div>
        )}
      </div>
    </section>
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
    <section className="space-y-2">
      <span className="font-mono text-xs text-muted-foreground">Shortcut</span>

      <div className="space-y-3 rounded-xl bg-muted/30 p-4">
        <label className="flex items-center gap-3">
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="block text-sm font-medium">Answer to a key</span>
            <span className="block text-xs text-muted-foreground">
              With this tab in front, the key below starts a call — and ends the
              one that is running.
            </span>
          </span>
          <Switch
            checked={value.enabled}
            onCheckedChange={(enabled) => onChange({ ...value, enabled })}
          />
        </label>

        {value.enabled && (
          <div className="space-y-1.5">
            <button
              type="button"
              {...HOTKEY_CAPTURE}
              onClick={() => {
                setBare(false);
                setListening(true);
              }}
              onBlur={() => setListening(false)}
              onKeyDown={listening ? record : undefined}
              className={cn(
                "w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                listening
                  ? "border-foreground/40 text-muted-foreground"
                  : "border-border/60 hover:bg-muted/50",
              )}
            >
              {listening ? "Press the keys…" : (label ?? "Set a shortcut")}
            </button>
            <p className="px-1 font-mono text-[11px] text-muted-foreground">
              {bare
                ? "Hold Ctrl, Alt or Cmd — a plain key is typing."
                : listening
                  ? "Esc to keep the one you have."
                  : "Only while this tab has focus. Not while you are typing."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** Appended to the persona, not replacing it; the voice-assistant rules stay in the server prompt. */
function Instructions({
  value,
  onSave,
}: {
  value: string;
  onSave: (systemPrompt: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          Instructions
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {draft.length}/{COMMON_VALIDATE.prompt.max}
        </span>
      </div>
      <Textarea
        value={draft}
        maxLength={COMMON_VALIDATE.prompt.max}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Anything else she should know before the first word — how to address you, what to skip."
        className="min-h-28"
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={draft === value}
          onClick={() => onSave(draft)}
        >
          Save
        </Button>
      </div>
    </section>
  );
}
