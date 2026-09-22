import { readLiveSettings } from "@/features/thursday/thursday.query";
import { serverRoute } from "@/lib/protocol/server-route";

/** Settings › Thursday as they are kept. Read only; saving is thursday.action. */
export const GET = serverRoute(() => readLiveSettings());
