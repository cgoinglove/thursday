#!/usr/bin/env node
// `pnpm dev`: `next dev` on a port nothing else holds. Next moves off a taken
// port by itself only when its own bind fails, and a server on 127.0.0.1 does
// not make Next's `::` bind fail — so it would start beside another app on the
// same port (bin/port.mjs). Run by `node`, like scripts/reset.mts.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { freePort } from "../bin/port.mjs";

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

const port = String(await freePort(asked));
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");

const child = spawn(
  process.execPath,
  [next, "dev", "--port", port, ...rest],
  // PORT beside the flag: config.ts APP_URL reads it before Next has listened
  { stdio: "inherit", env: { ...process.env, PORT: port } },
);

// Ctrl+C reaches next dev through the process group; stay until it has closed
process.on("SIGINT", () => {});
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
