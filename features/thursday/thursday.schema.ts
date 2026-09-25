import type { UIMessage } from "ai";
import z from "zod";
import { TEXT_MODEL_PROVIDERS } from "@/features/ai/model.schema";
import type { ThreadStatus } from "@/features/bot/bot.schema";
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
  /**
   * The two settings the tool manifest was built from, sent back so a tool running later
   * is looked up in the same set (tool-call, api/thursday/tool-call). What the call opened
   * with, never what is set now: a switch flipped mid-call would leave the model holding a
   * manifest for tools the route no longer builds.
   */
  opened: { webSearch: boolean; readSkills: boolean };
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

/**
 * What reaches a call in writing besides the words of the turn it rides on: words the user
 * wrote while she was answering (`said`), or a fact the page leaves her for a bot's update.
 * It goes as a `data-note` part: in the user's message it went out with, or in her answer
 * where a step read it (thursday.text).
 */
export const TextCallNoteSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  said: z.boolean(),
});
export type TextCallNote = z.infer<typeof TextCallNoteSchema>;
/** The data part a note rides in: `data-note`. */
export const TEXT_CALL_NOTE = "note";

/** The note a part carries, or null for any other part. */
export const noteOf = (
  part: UIMessage["parts"][number],
): TextCallNote | null =>
  part.type === `data-${TEXT_CALL_NOTE}`
    ? (part as { data: TextCallNote }).data
    : null;

/** The notes messages carry, in order. */
export const notesIn = (messages: UIMessage[]): TextCallNote[] =>
  messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      const note = noteOf(part);
      return note ? [note] : [];
    }),
  );

/**
 * Config keys (features/config config.query) the call's settings live under. Who she
 * is and what she may do is the app's, not one browser's: a phone writing in has no
 * browser to carry it (features/reach), and a second machine would meet a stranger.
 * What is left in the browser is how that machine talks to her (thursday.store).
 * `THURSDAY_SKILLS` was the one field that had to be here before the rest followed;
 * it is read back once, as `readSkills`, for an install that set it (thursday.query).
 */
export const THURSDAY_KEYS = {
  /** What of `LiveSettings` differs from its defaults, as JSON (ai/live.schema). */
  settings: "THURSDAY_SETTINGS",
  /** What `readSkills` was, before the settings moved here. Read once, never written. */
  wasSkills: "THURSDAY_SKILLS",
} as const;

export const WAKE_PHRASE = { min: 3, max: 32 };

/**
 * A wake phrase is English words: the recognizer listens in English (use-wake-word
 * WAKE_LANG), so a phrase in another script is never heard. Checked where it is typed,
 * not in `WakeSchema`, so a phrase saved before still loads.
 */
export const isEnglishPhrase = (phrase: string) =>
  /^[a-z0-9\s'.,!?-]+$/i.test(phrase.trim()) && /[a-z]/i.test(phrase);

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
 * A bot's question rings, because nobody watches a screen for work they handed over and a
 * question holds its thread up. Every ending ringing is one setting away, and "off" is what
 * stops the ring entirely.
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
   * between was not drawn (a bot's update left to her as a fact, `use-text-call`).
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
