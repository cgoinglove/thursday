import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR, IS_DEV } from "@/config";
import { serverRoute } from "@/lib/protocol/server-route";

/** TEMPORARY test instrumentation (lib/probe). Appends the page's probe lines to a local file. */
export const POST = serverRoute(async (request) => {
  if (!IS_DEV) return { written: 0 };
  const lines: unknown = await request.json();
  if (!Array.isArray(lines)) return { written: 0 };
  await appendFile(
    join(DATA_DIR, "probe.local.jsonl"),
    lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
  );
  return { written: lines.length };
});
