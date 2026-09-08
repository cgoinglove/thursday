import { readSkillNode } from "@/features/skills/skills.query";
import { SkillSourceSchema } from "@/features/skills/skills.schema";
import { type RouteContext, serverRoute } from "@/lib/protocol/server-route";
import { publicError } from "@/lib/public-error";

/**
 * Read only; writes go through skills.action. `?path=` selects a folder
 * (listing) or a file (text) inside the skill.
 */
export const GET = serverRoute(
  async (
    request,
    { params }: RouteContext<{ source: string; name: string }>,
  ) => {
    const { source, name } = await params;
    const parsed = SkillSourceSchema.safeParse(source);
    if (!parsed.success) publicError("Skill not found");
    const path = new URL(request.url).searchParams.get("path") ?? "";
    return readSkillNode(parsed.data, name, path);
  },
);
