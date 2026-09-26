import { readRunning } from "@/features/settings/running";
import { serverRoute } from "@/lib/protocol/server-route";

/** Running: where this server runs and the command that changes it. Read only. */
export const GET = serverRoute(async () => readRunning());
