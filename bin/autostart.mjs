// `thursday autostart` — the server comes up with the computer, so the app's own
// window opens with nothing running in a terminal behind it. Plain JavaScript and
// no app imports, like the rest of bin: it runs from the published package.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { homePort, portTaken } from "./port.mjs";

/** launchd's name for the job. The file it reads is named after it. */
const LABEL = "thursday-agent";

/** Named as private files are here, so a checkout never commits its own log. */
const LOG_FILE = "server.local.log";

/** How long the port gets to come free after the job holding it is stopped. */
const FREE_MS = 10_000;

const AGENTS = join(homedir(), "Library", "LaunchAgents");
const PLIST = join(AGENTS, `${LABEL}.plist`);

/** This login session. A user agent, so it goes with the person, not the machine. */
const domain = () => `gui/${process.getuid()}`;

const launchctl = (...args) =>
  spawnSync("launchctl", args, { encoding: "utf8" });

/** A path holding `&` or `<` would end the document early. */
const xml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const job = ({
  cli,
  home,
  port,
  log,
}) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <!-- The home and the port are written in rather than left to be found: launchd starts a
       job in no folder of its own, and a server that quietly moved to another port would
       leave the installed window looking at an address nothing answers on. -->
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(cli)}</string>
    <string>--home</string>
    <string>${xml(home)}</string>
    <string>--port</string>
    <string>${port}</string>
    <string>--no-open</string>
  </array>
  <!-- launchd hands a job a PATH with none of what a person installs, and every shell a bot
       runs inherits the server's (features/workspace). This is the PATH of the terminal that
       turned autostart on. -->
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(process.env.PATH ?? "")}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <!-- Started again whenever it stops, so a crash in the night is up by morning. A server
       that cannot open its database exits the same way; the wait keeps that to twice a
       minute, and the log says why each time. -->
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Whether the port is free, giving a server that was just stopped time to let go of it. */
async function waitFree(port) {
  for (let waited = 0; waited < FREE_MS; waited += 250) {
    if (!(await portTaken(port))) return true;
    await sleep(250);
  }
  return !(await portTaken(port));
}

/**
 * Turns starting with the computer on or off. macOS only: the same job on Linux is a
 * systemd unit and on Windows a Startup shortcut, and neither is written here until
 * someone can run it.
 */
export async function autostart({ root, home, off }) {
  if (process.platform !== "darwin") {
    console.error(
      `\n  Starting with the computer is macOS only for now.\n  Elsewhere, have your desktop run: ${join(root, "bin", "thursday.mjs")} --home ${home}\n`,
    );
    process.exit(1);
  }

  if (off) {
    const had = existsSync(PLIST);
    launchctl("bootout", `${domain()}/${LABEL}`);
    rmSync(PLIST, { force: true });
    console.log(
      had
        ? `\n  Thursday no longer starts with your Mac.\n`
        : `\n  Thursday was not set to start with your Mac.\n`,
    );
    return;
  }

  // npm empties this cache, and the job would break the day it does.
  if (root.includes(`${sep}_npx${sep}`)) {
    console.error(
      `\n  This copy is in npm's npx cache, which npm empties.\n  Install it to stay first:\n\n    npm i -g thursday-agent\n`,
    );
    process.exit(1);
  }

  // Not loaded is not a failure: this is also how an earlier job lets go before a new
  // one. Only a job that was really stopped is worth waiting on; anything else holding
  // the port is someone else's and is not about to move.
  const stopped = launchctl("bootout", `${domain()}/${LABEL}`).status === 0;

  const port = homePort(home);
  if (!(stopped ? await waitFree(port) : !(await portTaken(port)))) {
    console.error(
      `\n  Something already serves on port ${port}.\n  Stop it and run this again: two servers must never share one database.\n`,
    );
    process.exit(1);
  }

  const log = join(home, LOG_FILE);
  mkdirSync(home, { recursive: true });
  mkdirSync(AGENTS, { recursive: true });
  writeFileSync(
    PLIST,
    job({ cli: join(root, "bin", "thursday.mjs"), home, port, log }),
  );

  const started = launchctl("bootstrap", domain(), PLIST);
  if (started.status !== 0) {
    rmSync(PLIST, { force: true });
    console.error(
      `\n  launchd refused the job:\n  ${started.stderr?.trim() || `exit ${started.status}`}\n`,
    );
    process.exit(1);
  }

  console.log(
    `\n  Thursday starts with your Mac.\n  http://localhost:${port}\n  data: ${home}\n  log:  ${log}\n\n  Install it as its own window from the call screen and no terminal is needed again.\n  To stop: thursday autostart --off\n`,
  );
}
