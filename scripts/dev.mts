#!/usr/bin/env node
// `pnpm dev`: `next dev` on a port nothing else holds. Next moves off a taken
// port by itself only when its own bind fails, and a server on 127.0.0.1 does
// not make Next's `::` bind fail — so it would start beside another app on the
// same port (bin/port.mjs). Run by `node`, like scripts/reset.mts.

import { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  askToSetDatabaseAside,
  MIGRATION_FAILED_EXIT,
} from "../bin/database.mjs";
import { freePort } from "../bin/port.mjs";
// config.ts has no dependencies; the database is the one the server opens.
import { DB_FILE_NAME } from "../config.ts";

const args = process.argv.slice(2);
/** Taken out of the arguments, so Next is only ever handed a port already checked. */
let asked = process.env.PORT;
const rest: string[] = [];
for (let at = 0; at < args.length; at++) {
  const arg = args[at];
  if (arg === "--port" || arg === "-p") asked = args[++at];
  else if (arg.startsWith("--port=")) asked = arg.slice("--port=".length);
  else rest.push(arg);
}

// The data folder of a checkout is the checkout (config DATA_DIR)
const port = String(
  await freePort(asked, process.env.THURSDAY_HOME?.trim() || process.cwd()),
);
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
// This machine only, as `thursday` does, whatever HOSTNAME the shell exports;
// `-H` still opens it on purpose
const hostname = rest.some(
  (arg) => arg === "-H" || arg.startsWith("--hostname"),
)
  ? []
  : ["--hostname", "127.0.0.1"];

let child: ChildProcess;
/** Started again once a database the server could not migrate is removed. */
function start() {
  child = spawn(
    process.execPath,
    [next, "dev", "--port", port, ...hostname, ...rest],
    // PORT beside the flag: config.ts APP_URL reads it before Next has listened
    { stdio: "inherit", env: { ...process.env, PORT: port } },
  );
  child.on("exit", async (code) => {
    const dbPath = DB_FILE_NAME.replace(/^file:/, "");
    if (code === MIGRATION_FAILED_EXIT && (await askToSetDatabaseAside(dbPath)))
      return start();
    process.exit(code ?? 0);
  });
}
start();

// Ctrl+C reaches next dev through the process group; stay until it has closed
process.on("SIGINT", () => {});
process.on("SIGTERM", () => child.kill("SIGTERM"));
