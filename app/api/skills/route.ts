import { findAllSkills } from "@/features/skills/skills.query";
import { serverRoute } from "@/lib/protocol/server-route";

/** Read only; writes go through skills.action. */
export const GET = serverRoute(() => findAllSkills());
