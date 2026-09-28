import { checkpoint, reclaim } from "@/database/db";
import { sealMcpSecrets } from "@/features/connectors/mcp.query";
import {
  readConfig,
  removeConfig,
  sealConfigSecrets,
  writeConfig,
} from "./config.query";

/**
 * Set while a file that held keys in the clear waits to be rewritten: from the pass that sealed
 * them until the rewrite and the fold of its log have both finished. A start that finds it
 * rewrites the file again, so a rewrite that failed — a full disk — is not forgotten by the next
 * pass, which has nothing left to seal.
 */
const SCRUB_PENDING_KEY = "SECRETS_SCRUB_PENDING";

/**
 * Boot's pass over the secrets, after the migrations: seals what an older build wrote in the
 * clear (config.query, mcp.query) and names what the data folder's key cannot open.
 *
 * An UPDATE leaves the value it replaced in the page it freed: SQLite's secure_delete is off,
 * and a pragma would reach one connection of the pool alone (database/db.ts). So once anything
 * was sealed the file is rewritten (`reclaim`, a VACUUM) and the write-ahead log that carried the
 * rewrite folded back and emptied (`checkpoint`): from then on a copy of local.db holds no key in
 * the clear. `scrub` says whether that ran and finished.
 */
export async function sealStoredSecrets(): Promise<{
  sealed: number;
  unreadable: string[];
  scrub: "none" | "done" | "pending";
}> {
  const config = await sealConfigSecrets();
  const mcp = await sealMcpSecrets();
  const sealed = config.sealed + mcp.sealed;
  const unreadable = [
    ...config.unreadable,
    ...mcp.unreadable.map((name) => `connector "${name}"`),
  ];
  if (!sealed && !(await readConfig(SCRUB_PENDING_KEY)))
    return { sealed, unreadable, scrub: "none" };

  await writeConfig(SCRUB_PENDING_KEY, "on");
  // Thrown on, the mark stays for the next start to try again
  await reclaim();
  if (!(await checkpoint())) return { sealed, unreadable, scrub: "pending" };
  await removeConfig(SCRUB_PENDING_KEY);
  return { sealed, unreadable, scrub: "done" };
}
