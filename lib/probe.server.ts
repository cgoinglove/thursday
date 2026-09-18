import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR, IS_DEV } from "@/config";

/**
 * TEMPORARY test instrumentation, the server's half of lib/probe: the same file,
 * written directly. Remove with it.
 */
export const createServerProbe =
  (scope: string) =>
  (event: string, data?: unknown): void => {
    if (!IS_DEV) return;
    const line = JSON.stringify({ at: Date.now(), scope, event, data });
    void appendFile(join(DATA_DIR, "probe.local.jsonl"), `${line}\n`).catch(
      () => {},
    );
  };
