import { listRoutines } from "@/features/routine/routine.query";
import { serverRoute } from "@/lib/protocol/server-route";

/** Read only; writes go through routine.action. */
export const GET = serverRoute(() => listRoutines());
