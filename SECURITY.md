# Security

## What this app is

Thursday runs on your machine and gives a language model a shell, a browser and
your API keys. That is the product, not an accident: a bot that can install a
package, sign into a site and write a file is a bot that can do those things
wrong. Treat it the way you would treat a new assistant with your laptop
password — useful, and worth watching at first.

What the app does to keep that narrow:

- **Your keys stay on your machine.** They live in the local SQLite database (or
  the environment), are read only where a model is built, and are passed to a
  provider explicitly. Nothing is sent anywhere else.
- **Secrets do not reach the shell.** Every environment variable matching
  `KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|_AUTH` is stripped from the environment
  a bot's commands run in (`lib/sandbox.ts`), so a compromised npm package in a
  bot's project cannot read them out of `process.env`.
- **Writes are fenced.** A bot writes inside its workspace (`.ai-workspace`) and
  is refused the app's own directory (`features/workspace/workspace.ts`).
- **The server binds to localhost.** `npx thursday` listens on `127.0.0.1`.
  Do not put it on `0.0.0.0` and expect it to hold: there is no authentication,
  because there is no second user.
- **Passwords, one-time codes and passkeys are yours.** Bots are told to open
  the sign-in page and stop; you type the secret half in the window they opened.

What it does not do: sandbox the shell, sign what a bot downloads, or review the
skills you install. A skill is code you chose to trust.

## Reporting a vulnerability

Report privately through GitHub's [Security
Advisories](https://github.com/cgoinglove/thursday/security/advisories/new) — not a
public issue. Include what you did, what happened, and what you expected.

Expect a first reply within a week. If a fix is warranted, it ships in a patch
release and the advisory is published with credit unless you would rather not
be named.

## Supported versions

The latest published version. This is a 0.x app that moves quickly; there are no
backports.
