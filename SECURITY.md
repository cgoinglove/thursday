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
  matching `KEY|TOKEN|SECRET|PASS|_PWD|CREDENTIAL|_AUTH|_DSN|DATABASE_URL` is stripped from the
  environment a bot's commands run in (`lib/sandbox.ts`), so a compromised npm
  package in a bot's project cannot read them out of `process.env`. This is
  narrower than it sounds and is meant to be: the database those keys live in
  is a file on the same machine, and a bot has a shell. Reads are not fenced —
  a bot that cannot look around cannot do the work.
- **The file tool is fenced; the shell is not.** `write_file` refuses the app's
  own directory and the workspace root, and inside the workspace accepts only its
  folders (`features/workspace/workspace.ts`). A path outside the workspace is
  accepted. `bash` has no such check: a command writes wherever your user can.
- **The server binds to localhost.** `npx thursday-agent` listens on `127.0.0.1`.
  Do not put it on `0.0.0.0` and expect it to hold: there is no authentication,
  because there is no second user.
- **A sign-in is asked for, and a payment is yours to press.** A bot signs in
  with a sign-in the app keeps, the Chrome you already use, or a window where you
  sign in yourself. A purchase is taken to the last screen and left open on
  yours. It never guesses a secret or goes looking for one
  (`skills/browser/SKILL.md`). These are instructions in a skill, not code: the
  app cannot stop a model that ignores them.
- **A kept sign-in is lent, not handed around.** The app keeps a site's session,
  never a password: one file a site in `.sign-ins/` under the data folder,
  outside the bots' workspace. The `sign_in_use` tool lends it only to the bots
  on its list — the one that kept it, and those you let in under Settings ›
  Sign-ins or when one asks. Only those bots can replace it (`sign_in_keep`
  refuses any other and puts it on the asking list), and what a browser holds
  after a bot's turn refreshes only a sign-in the app lent that browser, for a
  bot still on the list. Signing out removes the file
  (`features/signins/signins.query.ts`). These checks are on the tools, not the
  file: a bot's shell runs as you and can read it. A kept session signs every
  later job of those bots in as you. It is the browser's whole session, not
  one site's cookies: a sign-in made through another site — "Sign in with
  Google" — carries that site's session as well, so a bot lent it can reach
  both.
- **Your own Chrome is lent whole.** A bot can attach to the Chrome you use —
  a tab of its own through the Playwright extension, or the browser you left
  open (`playwright-cli attach`, `skills/browser/SKILL.md`) — and it then acts
  in every site that Chrome is signed into, not only the one the job named.
  Nothing in the app or the skill asks you before it attaches; without the
  extension installed, the tab of its own is not there to take.
- **From a phone, one person, let in at the computer.** Settings › Phone
  connects the app out to Telegram, Discord or Slack; nothing on the computer
  is opened to the internet. Each service lets in one person, and only once
  someone at the computer presses Allow on the code that person's phone was
  sent (`features/reach/reach.ts`). What that cannot cover: whoever holds that
  chat account can start work on this computer, shell and all — a stolen
  account is that too. Messages and the files sent with them pass through the
  chat service, and its bot tokens are kept in the local database with your
  keys.
- **Work goes on with nobody watching.** A job keeps running after its tab
  closes, a routine starts at its time with nothing open, and `thursday
  autostart` (macOS) starts the server at login. Such a job has the same shell,
  browser and sign-ins as one you watch; what it asks waits for an answer, and
  what it finishes is told by the computer's notification and, with a phone
  connected, there.

What it does not do: sandbox the shell, sign what a bot downloads, or review the
skills and servers you add. A skill is code you chose to trust, and so is a
connected MCP server: a skill's scripts run in a bot's shell, and a server gets
whatever a bot sends its tools. Nor does it tell the accounts on this computer
apart: it listens on `127.0.0.1` without a login, so anyone else signed in to
the same machine can reach it.

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
