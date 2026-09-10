import z from "zod";
import {
  type SpeachModelProviderId,
  speachModelRefSchema,
} from "@/features/ai/model.schema";
import { botIconSchema, type TaskStatus } from "@/features/bot/bot.schema";
import { ASCII_CHARSETS, FACE_KINDS } from "@/features/thursday/face.const";
import type { DateLike } from "@/lib/date-like";
import { COMMON_VALIDATE } from "@/lib/limits";
import type { RealtimeCredential } from "@/lib/realtime/realtime.schema";
import type { RealtimeSessionSetup } from "@/lib/realtime/realtime.session";

// Shared by server and browser: nothing here may touch the DB.

/** The payload openCallAction parses. Browser-only settings live in thursday.store. */
export const ThursdaySettingsSchema = z.object({
  systemPrompt: z.string().max(COMMON_VALIDATE.prompt.max).nullish(),
  /** null until picked; the server then falls back to a provider with a key. */
  model: speachModelRefSchema.nullish(),
  /** `navigator.language` (e.g. "ko-KR"). Only the first call's opening line uses it. */
  locale: z.string().max(35).nullish(),
});

export type ThursdaySettings = z.infer<typeof ThursdaySettingsSchema>;

/**
 * What the browser receives to open a call. `credential` is used to connect;
 * `session` is sent as `session.update` after connecting (nothing is baked
 * into the secret).
 */
export type CallHandshake = {
  /** The row every saved turn hangs off. Exists before the connection. */
  callId: string;
  provider: SpeachModelProviderId;
  credential: RealtimeCredential;
  /** Sent as `session.update` once open; anything absent is the provider default. */
  session: RealtimeSessionSetup;
  /**
   * A system item to inject as soon as the line opens so the model speaks
   * first. Instructions alone do not make a realtime model open the conversation.
   */
  opening: string | null;
};

/**
 * How Thursday is drawn. `kind` selects one of two unrelated renderers; the
 * fields after it apply to the ascii one only. Browser-only (face.store).
 */
export const ThursdayFaceSchema = botIconSchema.extend({
  kind: z.enum(FACE_KINDS).default("ascii"),
  charset: z.enum(ASCII_CHARSETS).default("ascii"),
  /** Glyph size in px. */
  fontSize: z.number().min(4).max(16).default(8),
  density: z.number().min(0.6).max(2).default(1.4),
});

export type ThursdayFace = z.infer<typeof ThursdayFaceSchema>;

export const FACE_DEFAULT: ThursdayFace = ThursdayFaceSchema.parse({});

/**
 * Config keys (features/config config.query) the call's server-side settings
 * live under. Everything else about the call is the browser's (thursday.store);
 * these two places build the tool set, so they cannot be.
 */
export const THURSDAY_KEYS = {
  /** "on" hands the call `load_skill`; anything else, unset included, is off. */
  skills: "THURSDAY_SKILLS",
} as const;

/**
 * Off unless switched on. A skill is a page of instructions, and reading one
 * mid-sentence spends the session's context on it (ai/load-tools).
 */
export const isSkillsOn = (value: string | undefined) => value?.trim() === "on";

export const WAKE_PHRASE = { min: 3, max: 32 };

export const WakeSchema = z.object({
  enabled: z.boolean(),
  /** Matched loosely by use-wake-word, so two words beat one common word. */
  phrase: z.string().trim().min(WAKE_PHRASE.min).max(WAKE_PHRASE.max),
});

export type Wake = z.infer<typeof WakeSchema>;

export const WAKE_DEFAULT: Wake = { enabled: true, phrase: "hey thursday" };

/**
 * Keyboard entry, independent of `wake.enabled`. `combo` uses the use-hotkey
 * notation (modifiers + KeyboardEvent.code); only its length is checked here.
 */
export const HotkeySchema = z.object({
  enabled: z.boolean(),
  combo: z.string().trim().min(1).max(64),
});

export type Hotkey = z.infer<typeof HotkeySchema>;

/** A combination no browser or OS claims. */
export const HOTKEY_DEFAULT: Hotkey = {
  enabled: true,
  combo: "alt+shift+KeyT",
};

/**
 * Whether the app opens a call by itself when a job ends while no call is live.
 * A browser may block audio on a page that has not played sound yet; the
 * desktop notification covers that case.
 */
export const CALL_BACK_MODES = ["off", "waiting", "any"] as const;
export const CallBackSchema = z.enum(CALL_BACK_MODES);
export type CallBack = z.infer<typeof CallBackSchema>;

/** Off until chosen: a first call is one the user placed, not one that rang them. */
export const CALL_BACK_DEFAULT: CallBack = "off";

export const CALL_BACK_LABEL: Record<CallBack, string> = {
  off: "Never",
  waiting: "When a job needs me",
  any: "Whenever a job ends",
};

/**
 * Where the call screen draws the conversation: `center` puts the last
 * assistant line under the face like a caption; `sides` puts recent turns
 * beside it (user left, assistant right).
 */
export const CAPTION_VIEWS = ["center", "sides"] as const;
export const CaptionViewSchema = z.enum(CAPTION_VIEWS);
export type CaptionView = z.infer<typeof CaptionViewSchema>;

/** One turn on screen. The last item's text grows while it is being spoken. */
export type CallMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

/** A turn as the browser saves it. */
export const CallTurnSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "tool"]),
  /** Tool name for `tool` turns; `text` is then the argument JSON. */
  tool: z.string().nullish(),
  text: z.string(),
  /** Position in the conversation (call_message.seq). */
  seq: z.number().int().min(0),
});

export type CallTurn = z.infer<typeof CallTurnSchema>;

export type CallStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  /** A tool is running. */
  | "working"
  /** Handing work to a background bot. */
  | "delegating";
// No "ending" status: session.close() is synchronous, so it would be
// overwritten by idle in the same batch and never render.

/** The statuses a live call moves between. */
export type LiveStatus = Extract<
  CallStatus,
  "listening" | "speaking" | "working" | "delegating"
>;

/** One past call with all its turns, in `seq` order (Settings › Calls). */
export type CallRecord = {
  id: string;
  provider: string;
  model: string;
  startedAt: DateLike;
  /** null when the hang-up was never recorded. */
  endedAt: DateLike | null;
  turns: (CallTurn & { at: DateLike })[];
  /** Jobs this call opened, as they stand now; the log draws each under the line that opened it. */
  jobs: {
    id: string;
    label: string;
    status: TaskStatus;
    outcome: string | null;
  }[];
};
