import { realtimeSession, toFunctionTools } from "./realtime.driver";
import type { OpenAiSessionConfig } from "./realtime.protocol";
import { createWebRtcTransport } from "./realtime.transport";

/** OpenAI Realtime over WebRTC; events ride the data channel. */

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export const createOpenAiSession = realtimeSession({
  transport: ({ credential, audio, on }) =>
    createWebRtcTransport({
      url: CALLS_URL,
      secret: credential.value,
      label: "OpenAI",
      audio,
      on,
    }),

  sessionUpdate: (setup) => ({
    type: "session.update",
    session: {
      type: "realtime",
      model: setup.model,
      instructions: setup.instructions,
      audio: {
        input: {
          transcription: setup.transcription
            ? { model: setup.transcription }
            : null,
        },
        output: { voice: setup.voice },
      },
      tools: toFunctionTools(setup.tools),
    } satisfies OpenAiSessionConfig,
  }),
});
