import { readTidyStatus } from "@/features/memory/memory.tidy";
import { serverRoute } from "@/lib/protocol/server-route";

/** Read only; the level, model and "tidy now" go through memory.action. */
export const GET = serverRoute(() => readTidyStatus());
