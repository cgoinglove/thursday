import { readCallTranscript } from "@/features/thursday/thursday.query";
import { serverRoute } from "@/lib/protocol/server-route";

/** The Transcript switch and each provider's picked model. Read only; the writes are thursday.action. */
export const GET = serverRoute(() => readCallTranscript());
