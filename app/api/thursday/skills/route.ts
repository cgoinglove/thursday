import { readCallSkillsOn } from "@/features/thursday/thursday.query";
import { serverRoute } from "@/lib/protocol/server-route";

/** Whether the call is handed `load_skill`. Read only; the switch is thursday.action. */
export const GET = serverRoute(() => readCallSkillsOn());
