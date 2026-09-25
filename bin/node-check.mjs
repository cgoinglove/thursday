// The first import of thursday.mjs, so it runs before the rest of bin/ is evaluated: that
// reads what an older Node does not have (`import.meta.dirname`) while loading, and on
// Ubuntu's and Debian's own Node 18 it died with a stack trace instead of saying why.
// Plain JavaScript an old Node runs; the version it asks for is package.json's `engines`.

import { readFileSync } from "node:fs";

const { engines } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const wanted = /(\d+)\.(\d+)/.exec(engines?.node ?? "");
if (wanted) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const [needMajor, needMinor] = [Number(wanted[1]), Number(wanted[2])];
  if (major < needMajor || (major === needMajor && minor < needMinor)) {
    console.error(
      `\n  Thursday needs Node ${needMajor}.${needMinor} or newer, and this is ${process.versions.node}.\n  Install a newer one from https://nodejs.org, or with your version manager, and run it again.\n`,
    );
    process.exit(1);
  }
}
