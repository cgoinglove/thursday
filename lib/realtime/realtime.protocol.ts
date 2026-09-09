/**
 * OpenAI Realtime wire protocol, which xAI's Speech to Speech API also speaks.
 * Typed to what this app reads; unlisted event types fall through the handler.
 *
 *   https://platform.openai.com/docs/api-reference/realtime-client-events
 *   https://docs.x.ai/voice-realtime.ws.json
 */

// Session

export type RealtimeAudioFormat =
  /** PCM16, little-endian. OpenAI takes 24000 only, xAI 8000–48000. */
  | { type: "audio/pcm"; rate: number }
  | { type: "audio/pcmu" }
  | { type: "audio/pcma" };

export type RealtimeTurnDetection = {
  /** `semantic_vad` is OpenAI only. */
  type: "server_vad" | "semantic_vad";
  /** 0–1. Higher needs a louder sound to trigger. */
  threshold?: number;
  prefix_padding_ms?: number;
  silence_duration_ms?: number;
  /** After this much silence the server speaks to the user again. */
  idle_timeout_ms?: number | null;
  /** OpenAI only. Both default to true. */
  create_response?: boolean;
  interrupt_response?: boolean;
};

/** A tool the page runs. Both providers take exactly this shape. */
export type RealtimeFunctionTool = {
  type: "function";
  name: string;
  description: string;
  /** JSON Schema for the arguments. The top level is an object. */
  parameters: { type: "object"; [keyword: string]: unknown };
};

/** OpenAI session config (GA shape, audio settings under `audio`). */
export type OpenAiSessionConfig = {
  type: "realtime";
  model?: string;
  instructions?: string;
  output_modalities?: ("audio" | "text")[];
  audio?: {
    input?: {
      format?: RealtimeAudioFormat;
      /** Null turns transcription off. A file model reports only at turn end; `gpt-live-transcribe` streams deltas. */
      transcription?: {
        model: string;
        language?: string;
        prompt?: string;
      } | null;
      turn_detection?: RealtimeTurnDetection | null;
      noise_reduction?: { type: "near_field" | "far_field" } | null;
    };
    output?: { format?: RealtimeAudioFormat; voice?: string; speed?: number };
  };
  tools?: RealtimeFunctionTool[];
  tool_choice?: "auto" | "none" | "required";
  max_output_tokens?: number | "inf";
};

/** xAI session config: `voice` and `turn_detection` at the top level, plus xAI-only fields. */
export type XaiSessionConfig = {
  model?: string;
  instructions?: string;
  voice?: string;
  reasoning?: { effort: "high" | "none" };
  turn_detection?: RealtimeTurnDetection | null;
  audio?: {
    input?: {
      format?: RealtimeAudioFormat;
      /** `binary` sends raw codec bytes in binary frames instead of base64 JSON. */
      transport?: "json" | "binary";
      transcription?: {
        /** Naming the model is the switch that turns on streaming `.updated` transcripts. */
        model?: "grok-transcribe";
        /** BCP-47. */
        language_hint?: string;
        keyterms?: string[];
      };
    };
    output?: {
      format?: RealtimeAudioFormat;
      transport?: "json" | "binary";
      /** 0.7–1.5. */
      speed?: number;
    };
  };
  tools?: RealtimeFunctionTool[];
  /** Pronunciation substitutions applied before TTS. The transcript keeps the original. */
  replace?: Record<string, string>;
  /** Caches turns server-side and replays them on reconnect. */
  resumption?: { enabled: boolean };
};

export type RealtimeSessionConfig = OpenAiSessionConfig | XaiSessionConfig;

// Items

export type RealtimeMessageRole = "user" | "assistant" | "system";

export type RealtimeItemStatus = "in_progress" | "completed" | "incomplete";

/** `input_*` parts are the user's, the rest the model's. */
export type RealtimeContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_audio"; audio?: string; transcript?: string | null }
  | { type: "output_text" | "text"; text: string }
  | {
      type: "output_audio" | "audio";
      audio?: string;
      transcript?: string | null;
    };

/** What a client can put into the conversation. */
export type RealtimeClientItem =
  | {
      type: "message";
      id?: string;
      role: RealtimeMessageRole;
      content: RealtimeContentPart[];
    }
  | {
      type: "function_call_output";
      id?: string;
      call_id: string;
      output: string;
    }
  /** For seeding tool-use history. Pairs with its output. */
  | {
      type: "function_call";
      id?: string;
      call_id: string;
      name: string;
      arguments: string;
    }
  /**
   * xAI only: a line TTS speaks verbatim, without going through the model. The
   * server wraps it as its own response, so no `response.create` follows.
   */
  | {
      type: "force_message";
      role: "assistant";
      /** False drops the caller's audio until that line has played. */
      interruptible?: boolean;
      content: { type: "output_text"; text: string }[];
    };

/** An item as the server describes it. */
export type RealtimeServerItem =
  | {
      id: string;
      type: "message";
      role: RealtimeMessageRole;
      status?: RealtimeItemStatus;
      content: RealtimeContentPart[];
    }
  | {
      id: string;
      type: "function_call";
      status?: RealtimeItemStatus;
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      id: string;
      type: "function_call_output";
      call_id: string;
      output: string;
    };

// Responses

export type RealtimeResponse = {
  id: string;
  status?: "in_progress" | "completed" | "cancelled" | "incomplete" | "failed";
  status_details?: {
    type?: string;
    reason?: string;
    error?: { type?: string; code?: string; message?: string } | null;
  } | null;
  output?: RealtimeServerItem[];
  /** Whatever `response.create` attached, handed back unchanged. */
  metadata?: Record<string, string> | null;
};

/** What can be asked for with `response.create`. */
export type RealtimeResponseOptions = {
  /** Applies to this response only. After it, the session's own instructions. */
  instructions?: string;
  /** Comes back unchanged on `response.created` and `response.done`. */
  metadata?: Record<string, string>;
  /** OpenAI only: `none` answers outside the conversation. */
  conversation?: "auto" | "none";
  /** OpenAI only: its own context instead of the conversation. */
  input?: RealtimeClientItem[];
  /** OpenAI only. */
  output_modalities?: ("audio" | "text")[];
  /** xAI only; their name for `output_modalities`. */
  modalities?: ("audio" | "text")[];
};

// Client to server

export type SessionUpdateEvent = {
  type: "session.update";
  session: RealtimeSessionConfig;
};

export type RealtimeClientEvent =
  | SessionUpdateEvent
  /** base64 audio in the session's input format. Nothing comes back for it. */
  | { type: "input_audio_buffer.append"; audio: string }
  /** Manual turns only. Under server VAD the server commits. */
  | { type: "input_audio_buffer.commit" }
  | { type: "input_audio_buffer.clear" }
  | {
      type: "conversation.item.create";
      previous_item_id?: string;
      item: RealtimeClientItem;
    }
  | { type: "conversation.item.delete"; item_id: string }
  /** After a barge-in, truncates the assistant item to what was heard. */
  | {
      type: "conversation.item.truncate";
      item_id: string;
      content_index: number;
      audio_end_ms: number;
    }
  | { type: "response.create"; response?: RealtimeResponseOptions }
  /** Under server VAD the server does this itself when the user speaks. */
  | { type: "response.cancel"; response_id?: string }
  /** OpenAI over WebRTC only: stops what the server is still sending. */
  | { type: "output_audio_buffer.clear" };

// Server to client

export type RealtimeErrorDetail = {
  type?: string;
  code?: string | null;
  message: string;
  param?: string | null;
  /** The client event that caused it, when there was one. */
  event_id?: string | null;
};

export type RealtimeServerEvent =
  | { type: "session.created"; session: Record<string, unknown> }
  /** The acknowledgement of a `session.update`. */
  | { type: "session.updated"; session: Record<string, unknown> }
  | { type: "conversation.created" }
  /** Most leave the session open. The message says what was refused. */
  | { type: "error"; error: RealtimeErrorDetail }

  // User side
  | {
      type: "input_audio_buffer.speech_started";
      item_id: string;
      audio_start_ms?: number;
    }
  | {
      type: "input_audio_buffer.speech_stopped";
      item_id: string;
      audio_end_ms?: number;
    }
  /** The turn closed and an item exists. Its words come later. */
  | {
      type: "input_audio_buffer.committed";
      item_id: string;
      previous_item_id?: string | null;
    }
  | { type: "input_audio_buffer.cleared" }
  /** `idle_timeout_ms` fired. The server made its own check-in turn. */
  | { type: "input_audio_buffer.timeout_triggered"; item_id?: string }
  /** `created` is the pre-GA name OpenAI still sends alongside `added`. */
  | {
      type:
        | "conversation.item.added"
        | "conversation.item.created"
        | "conversation.item.done";
      item: RealtimeServerItem;
      previous_item_id?: string | null;
    }
  | { type: "conversation.item.deleted"; item_id: string }
  | {
      type: "conversation.item.truncated";
      item_id: string;
      content_index: number;
      audio_end_ms: number;
    }
  /** OpenAI: pieces of what the user said, as they are recognized. */
  | {
      type: "conversation.item.input_audio_transcription.delta";
      item_id: string;
      delta?: string;
    }
  /** xAI: the full transcript so far; replaces, does not append. */
  | {
      type: "conversation.item.input_audio_transcription.updated";
      item_id: string;
      transcript: string;
    }
  | {
      type: "conversation.item.input_audio_transcription.completed";
      item_id: string;
      transcript: string;
      /**
       * xAI sends this event repeatedly while the turn is still being
       * transcribed, each time with more of it and `in_progress` here; only the
       * last carries `completed`. OpenAI sends it once and omits the field.
       */
      status?: "in_progress" | "completed" | string;
    }
  /** OpenAI only. */
  | {
      type: "conversation.item.input_audio_transcription.failed";
      item_id: string;
      error: RealtimeErrorDetail;
    }

  // Model side
  | { type: "response.created"; response: RealtimeResponse }
  /** Whatever the status, always the last event of a response. */
  | { type: "response.done"; response: RealtimeResponse }
  | {
      type: "response.output_item.added" | "response.output_item.done";
      response_id: string;
      output_index: number;
      item: RealtimeServerItem;
    }
  | {
      type: "response.output_audio.delta";
      response_id: string;
      item_id: string;
      output_index: number;
      content_index: number;
      /** base64, in the session's output format. */
      delta: string;
    }
  | {
      type: "response.output_audio.done";
      response_id: string;
      item_id: string;
      output_index: number;
      content_index: number;
    }
  | {
      type: "response.output_audio_transcript.delta";
      response_id: string;
      item_id: string;
      delta: string;
    }
  | {
      type: "response.output_audio_transcript.done";
      response_id: string;
      item_id: string;
      transcript: string;
    }
  | {
      type: "response.output_text.delta";
      response_id: string;
      item_id: string;
      delta: string;
    }
  | {
      type: "response.function_call_arguments.delta";
      response_id: string;
      item_id: string;
      call_id: string;
      delta: string;
    }
  /** Complete call. Answered with a `function_call_output` item and a `response.create`. */
  | {
      type: "response.function_call_arguments.done";
      response_id: string;
      item_id: string;
      call_id: string;
      name: string;
      arguments: string;
    }
  /** OpenAI over WebRTC only: the server plays the audio and reports its state. */
  | {
      type:
        | "output_audio_buffer.started"
        | "output_audio_buffer.stopped"
        | "output_audio_buffer.cleared";
      response_id: string;
    }
  | { type: "rate_limits.updated"; rate_limits: unknown[] };
