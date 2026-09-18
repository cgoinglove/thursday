import z from "zod";
import { statFiles } from "@/features/workspace/workspace.query";
import { serverRoute } from "@/lib/protocol/server-route";

const PathsSchema = z.array(z.string().min(1));

/** `?paths=` is a JSON array of workspace-relative paths; answers the ones with a file, and their size. */
export const GET = serverRoute(async (request) => {
  const raw = new URL(request.url).searchParams.get("paths") ?? "[]";
  let paths: unknown;
  try {
    paths = JSON.parse(raw);
  } catch {
    paths = null;
  }
  return statFiles(PathsSchema.parse(paths));
});
