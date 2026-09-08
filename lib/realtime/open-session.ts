import type { SpeachModelProviderId } from "./realtime.schema";
import type {
  RealtimeSession,
  RealtimeSessionFactory,
  RealtimeSessionOptions,
} from "./realtime.session";

/** Loaded on demand so a page carries only the transport it uses. */
const IMPLEMENTATIONS: Record<
  SpeachModelProviderId,
  () => Promise<RealtimeSessionFactory>
> = {
  openai: async () => (await import("./openai")).createOpenAiSession,
  xai: async () => (await import("./xai")).createXaiSession,
};

/** Opens and configures a session for the provider. */
export async function openRealtimeSession(
  options: RealtimeSessionOptions,
): Promise<RealtimeSession> {
  const create = await IMPLEMENTATIONS[options.provider]();
  const session = create(options);
  try {
    await session.connect();
  } catch (cause) {
    // A half-open session still holds the mic and the socket.
    session.close();
    throw cause;
  }
  return session;
}
