import { PCM_SAMPLE_RATE } from "./realtime.audio";
import { realtimeSession, toFunctionTools } from "./realtime.driver";
import type { XaiSessionConfig } from "./realtime.protocol";
import { createSocketTransport } from "./realtime.transport";

/** xAI Speech to Speech over WebSocket (PCM16 both ways); the protocol on top is OpenAI's. */

const REALTIME_URL = "wss://api.x.ai/v1/realtime";

export const createXaiSession = realtimeSession({
  transport: ({ credential, setup, audio, on }) =>
    createSocketTransport({
      url: `${REALTIME_URL}?model=${encodeURIComponent(setup.model)}`,
      // A browser cannot set WebSocket headers, so the secret travels as a subprotocol.
      protocols: [`xai-client-secret.${credential.value}`],
      label: "Grok",
      audio,
      on,
    }),

  sessionUpdate: (setup) => ({
    type: "session.update",
    session: {
      model: setup.model,
      instructions: setup.instructions,
      voice: setup.voice,
      turn_detection: { type: "server_vad" },
      audio: {
        input: {
          format: { type: "audio/pcm", rate: PCM_SAMPLE_RATE },
          // Naming the model makes transcripts stream while the user is still speaking.
          ...(setup.transcription
            ? { transcription: { model: setup.transcription } }
            : {}),
        },
        output: { format: { type: "audio/pcm", rate: PCM_SAMPLE_RATE } },
      },
      tools: toFunctionTools(setup.tools),
    } satisfies XaiSessionConfig,
  }),
});
