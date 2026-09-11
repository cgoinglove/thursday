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
- **Secrets are not in the shell's environment.** Every environment variable
  matching `KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|_AUTH` is stripped from the
  environment a bot's commands run in (`lib/sandbox.ts`), so a compromised npm
  package in a bot's project cannot read them out of `process.env`. This is
  narrower than it sounds and is meant to be: the database those keys live in
  is a file on the same machine, and a bot has a shell. Reads are not fenced —
  a bot that cannot look around cannot do the work.
- **The file tool is fenced; the shell is not.** `write_file` refuses the app's
  own directory and the workspace root, and inside the workspace accepts only its
  folders (`features/workspace/workspace.ts`). A path outside the workspace is
  accepted. `bash` has no such check: a command writes wherever your user can.
- **The server binds to localhost.** `npx thursday` listens on `127.0.0.1`.
  Do not put it on `0.0.0.0` and expect it to hold: there is no authentication,
  because there is no second user.
- **A sign-in is asked for, and a payment is yours to press.** A bot signs in
  with a session it kept, the Chrome you already use, or a window where you sign
  in yourself. Credentials you gave it are used only after it asks. A purchase is
  taken to the last screen and left open on yours. It never guesses a secret or
  goes looking for one (`skills/browser/SKILL.md`). These are instructions in a
  skill, not code: the app cannot stop a model that ignores them. A session it
  keeps (`bots/<name>/.auth/`) signs every later job in as you.

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
