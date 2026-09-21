import z from "zod";
import { ASCII_FACE } from "@/config";
import { TEXT_MODEL_PROVIDERS } from "@/features/ai/model.schema";
import type { ThreadStatus } from "@/features/bot/bot.schema";
import { ASCII_CHARSETS } from "@/features/thursday/face.const";
import type { DateLike } from "@/lib/date-like";
import { LiveFragmentSchema } from "@/lib/live/live.schema";

// Shared by server and browser: nothing here may touch the DB.

/**
 * A word on the face: one `emote` put there, or the screen's own while she rings. `at` tells a
 * second showing of the same word from the first; `hold` is how long it stays lit, in seconds,
 * when that is not the face's own (ascii-orb WORD_HOLD).
 */
export type FaceWord = { text: string; at: number; hold?: number };

/** The browser receives the SDP answer, the row to save turns to, and the opening. */
export type CallHandshake = {
  /** The row every saved turn hangs off. Exists before the connection. */
  callId: string;
  sdp: string;
  /** Trusted instructions sent after session.started, so she speaks first. */
  opening: string;
  /**
   * The jobs open as the call started (ai/prompts/call-standing), queued for the backend
   * alone once the line is up. Null when nothing has been handed over yet.
   */
  standing: string | null;
};

/**
 * What a call in writing can run on, in the order it is looked for: the GPT subscription
 * when one is signed in, else the OpenAI key — both name the backend model the same way.
 * A rule about what is set, asked once before the call: never a second try after a refusal.
 */
export const TEXT_CALL_PROVIDERS = [
  { id: "chatgpt", ...TEXT_MODEL_PROVIDERS.chatgpt },
  { id: "openai", ...TEXT_MODEL_PROVIDERS.openai },
] as const;
export type TextCallProvider = (typeof TEXT_CALL_PROVIDERS)[number]["id"];

/** The same answer on the server (the keys themselves) and on the screen (their status). */
export const textCallRunsOn = (
  isSet: (key: string) => boolean,
): TextCallProvider | null =>
  TEXT_CALL_PROVIDERS.find((provider) => isSet(provider.apiKeyName))?.id ??
  null;

/** What the page holds for a call in writing: the row its turns hang off, and what stood open. */
export type TextCallHandshake = {
  callId: string;
  /** The jobs open as the call started (ai/prompts/call-standing); sent back with every turn. */
  standing: string | null;
};

/** How Thursday's orb is drawn. Browser-only (face.store). */
export const ThursdayFaceSchema = z.object({
  charset: z.enum(ASCII_CHARSETS).default(ASCII_FACE.charset),
  /** Glyph size in px. */
  fontSize: z
    .number()
    .min(ASCII_FACE.fontSize.min)
    .max(ASCII_FACE.fontSize.max)
    .default(ASCII_FACE.fontSize.default),
  density: z
    .number()
    .min(ASCII_FACE.density.min)
    .max(ASCII_FACE.density.max)
    .default(ASCII_FACE.density.default),
});

export type ThursdayFace = z.infer<typeof ThursdayFaceSchema>;

export const FACE_DEFAULT: ThursdayFace = ThursdayFaceSchema.parse({});

/**
 * Config keys (features/config config.query) the call's server-side settings
 * live under. Everything else about the call is the browser's (thursday.store);
 * these are read where the prompts and the tool set are built, so they cannot be.
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

export const WAKE_DEFAULT: Wake = { enabled: false, phrase: "hey thursday" };

/**
 * Keyboard entry, independent of `wake.enabled`. `combo` uses the use-hotkey
 * notation (modifiers + KeyboardEvent.code); only its length is checked here.
 */
export const HotkeySchema = z.object({
  enabled: z.boolean(),
  combo: z.string().trim().min(1).max(64),
});

export type Hotkey = z.infer<typeof HotkeySchema>;

/**
 * Off to begin with, like the wake phrase: a key held over every page is asked for, not
 * assumed. The combo is one no browser or OS claims.
 */
export const HOTKEY_DEFAULT: Hotkey = {
  enabled: false,
  combo: "alt+shift+KeyT",
};

/**
 * Whether the call screen rings when a job ends while no call is live. Ringing
 * never opens the line; answering does. The desktop notification covers a tab
 * nobody is looking at.
 */
export const CALL_BACK_MODES = ["off", "waiting", "any"] as const;
export const CallBackSchema = z.enum(CALL_BACK_MODES);
export type CallBack = z.infer<typeof CallBackSchema>;

/**
 * Everything a bot finishes rings, because nobody watches a screen for work they handed
 * over. The quieter modes are one setting away, and "off" is what stops the ring entirely.
 */
export const CALL_BACK_DEFAULT: CallBack = "waiting";

export const CALL_BACK_LABEL: Record<CallBack, string> = {
  off: "Never",
  waiting: "When a job needs me",
  any: "Whenever a job ends",
};

/**
 * Where the call screen draws the conversation: `center` puts the last
 * assistant line under the face like a caption; `sides` puts the turns
 * beside it (assistant left, user right), one a side at the face's middle.
 */
export const CAPTION_VIEWS = ["center", "sides"] as const;
export const CaptionViewSchema = z.enum(CAPTION_VIEWS);
export type CaptionView = z.infer<typeof CaptionViewSchema>;

/** One turn on screen. The last item's text grows while it is being spoken. */
export type CallMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /**
   * Starts a turn of its own rather than joining the words before it: what came in
   * between was not drawn (a bot's update put to her, `use-text-call` RELAY_TURN).
   */
  fresh?: true;
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
  /** Null on legacy rows and tool calls. Display groups can be revised. */
  fragments: z.array(LiveFragmentSchema).nullish(),
});

export type CallTurn = z.infer<typeof CallTurnSchema>;

/** One reasoning summary part of the backend (call_thought). */
export const CallThoughtSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  seq: z.number().int().min(0),
});

export type CallThought = z.infer<typeof CallThoughtSchema>;

export type CallStatus =
  | "idle"
  | "connecting"
  | "ending"
  | "listening"
  | "speaking"
  /** A tool is running. */
  | "working"
  /** Handing work to a background bot. */
  | "delegating";

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
  /** The Responses model that held the tools; null on rows written before Live. */
  backendModel: string | null;
  startedAt: DateLike;
  /** null when the hang-up was never recorded. */
  endedAt: DateLike | null;
  /** What the provider said on close, and the active seconds it billed. Null when unconfirmed. */
  endedReason: string | null;
  seconds: number | null;
  turns: (CallTurn & { at: DateLike })[];
  /** Jobs this call opened, as they stand now; the log draws each under the line that opened it. */
  jobs: {
    id: string;
    label: string;
    status: ThreadStatus;
    outcome: string | null;
  }[];
};
