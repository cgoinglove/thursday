import type {
  RealtimeCredential,
  SpeachModelProviderId,
  ToolManifest,
} from "./realtime.schema";

/**
 * The seam between the app and a realtime provider. A session reports facts
 * only; what to draw or save is the caller's business.
 */

/**
 * One turn, reported repeatedly while it grows and once more with `done`.
 * Order by `seq`, not arrival: the user's transcript can land after the
 * assistant's answer started.
 */
export type RealtimeTurn = {
  /** The item id the provider assigned. Unique within one session only. */
  id: string;
  /** For `tool`, `text` is the argument JSON and `tool` the name; the result is not a turn. */
  role: "user" | "assistant" | "tool";
  tool?: string;
  text: string;
  /** Its place in the conversation. */
  seq: number;
  /** The words are final. Reported true once per turn. */
  done: boolean;
};

/** One tool the model called. The arguments are the JSON string it wrote. */
export type RealtimeToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/** Current activity as independent facts; several can be true at once. */
export type RealtimeActivity = {
  /** The model's voice is playing. */
  speaking: boolean;
  /** The user is speaking, per the server VAD. */
  hearing: boolean;
  /** Tools called in the current episode, kept until the follow-up response starts. */
  tools: string[];
};

export type RealtimeSessionHandlers = {
  /**
   * Runs one tool and returns the string sent to the model. Do not throw;
   * return failures as strings so the model can recover.
   */
  runTool(call: RealtimeToolCall): Promise<string>;
  /** A turn grew or was finalized. */
  turn(turn: RealtimeTurn): void;
  /** Whenever any of the three above changes. */
  activity(activity: RealtimeActivity): void;
  /** Something went wrong in one turn, but the session continues. */
  warn(message: string): void;
  /** Fatal. On this, the caller closes the session. */
  failed(message: string): void;
};

/** Sent in `session.update` right after the session opens; nothing is baked into the secret. */
export type RealtimeSessionSetup = {
  model: string;
  voice: string;
  instructions: string;
  tools: ToolManifest[];
};

/**
 * Audio surface a session uses. WebRTC attaches the remote stream to `element`
 * and observes it via `listen`; the socket transport plays through `speaker()`.
 */
export type RealtimeAudio = {
  element: HTMLAudioElement;
  listen(stream: MediaStream): void;
  speaker(): { context: AudioContext; analyser: AnalyserNode };
  /** The user's microphone stream, for drawing a level. Optional. */
  hear?(stream: MediaStream): void;
};

export type RealtimeSessionOptions = {
  provider: SpeachModelProviderId;
  /** The value that grants the connection. */
  credential: RealtimeCredential;
  setup: RealtimeSessionSetup;
  audio: RealtimeAudio;
  on: RealtimeSessionHandlers;
};

export type RealtimeSession = {
  /** Resolves once the session is open and configured. Rejects if it never opens. */
  connect(): Promise<void>;
  close(): void;
  mute(muted: boolean): void;
  /**
   * Injects a system message and requests a response, at the next quiet gap:
   * the provider refuses a second response while one is running.
   */
  say(text: string): void;
};

export type RealtimeSessionFactory = (
  options: RealtimeSessionOptions,
) => RealtimeSession;
