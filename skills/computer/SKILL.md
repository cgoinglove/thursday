---
name: computer
description: "This Mac itself — its apps, its windows, what is on screen. Read a window as text, click, type, open or focus an app, walk a menu, read the clipboard."
---

# The Mac

You drive the user's Mac from your shell with `peekaboo`. This file is how:
look at a window, act on what you found, and what to do when the machine says
no.

`peekaboo` is a plain CLI, not an agent. You are the one that looks and
decides; it only observes and acts.

## In this app

Everything the app has to say about the Mac is in this section. The bots'
personas and the prompts do not repeat it — change it here.

**Permissions come before everything.** Screen Recording and Accessibility are
granted by the user, in System Settings, to the process that runs you — you
cannot grant them and neither can `peekaboo`. So start with:

```bash
peekaboo permissions status --json
```

If anything is missing, say which one in one line (`ask_thursday`) and stop.
Do not retry, do not work around it: without the grant every capture is a
black rectangle and every click is refused, and you will spend your steps
proving it.

**Read as text first.** The tree is the cheap way to see a window, and it does
not need a screenshot at all:

```bash
peekaboo see --app Messages --tree --no-screenshot --json
```

That gives you the window's elements — their roles, titles and values — which
is what you usually wanted when you thought "take a screenshot". Capture
pixels only when the layout itself is the question (is this cut off, does this
look right), and then look at the file yourself.

**Never `--analyze`, never `agent`.** Those two spend a provider key, and keys
do not live in your shell. You are the model here: capture, then read what you
captured.

**Stay in the background.** The user is sitting at this machine. `peekaboo`
delivers input in the background when it can resolve an exact target, so pass
`--app` / `--window-title` and let it. Add `--foreground` only when an action
genuinely needs the real pointer, and say why in your `description`. Never
quit or close the user's apps unless they asked — minimize instead.

**Sign-ins are the user's.** Never type a password, an id, or a one-time code
into any app. When a window wants one, tell the user in one line
(`ask_thursday`) and stop.

**Files.** Captures go under `scratch/` while you work
(`--path scratch/<name>.png`); a picture that is the result of the job goes to
`artifacts/`. Never write to the workspace root.

**Ask before you change the user's things.** Looking is free — reading a
window, listing apps, taking a capture. Sending a message, deleting a mail,
posting a form: that is the user's action, so confirm it first unless they
already told you to do exactly that.

**When something is wrong on this machine, the CLI already knows.** Every
command takes `--json`, and a failure carries `error.code`, `error.message`
and often an `error.hint` — read the hint before you invent a second approach.
Action results also carry `effect`: `confirmed` means the app acknowledged it,
`suspected_noop` means nothing changed (your target was probably wrong — look
again), `refused` means a safety gate stopped you.

## Quick start

```bash
peekaboo permissions status --json           # first, always
peekaboo app list --json                     # what is running
peekaboo see --app Safari --tree --no-screenshot --json   # read a window
peekaboo click --app Safari "Sign in"        # act on what you read
peekaboo type "hello" --app Safari
```

## The loop

1. **Observe** — `see` (tree for text, pixels when layout matters). Every
   observation returns a snapshot id; later commands target that snapshot.
2. **Act** — one command: `click`, `type`, `press`, `scroll`, `menu click`.
3. **Observe again.** The window changed, so your element ids did too. Never
   act twice off one `see`.
4. **Verify** instead of sleeping — `peekaboo verify` polls a predicate and
   answers satisfied / unsatisfied / unknown. Sleeps are how a job burns a
   minute and still gets it wrong.

## What it can do

Run `peekaboo learn` for the full agent guide, `peekaboo tools` for the tool
catalog, and `peekaboo <command> --help` for the exact flags of one command.
The surface moves between releases — this list is what exists, not how to
spell it.

**Observe** — `see` (capture + element map, `--tree`, `--no-screenshot`,
`--no-elements`), `capture` (`action`, `live`, `video`), `screen list`,
`verify`, `permissions`.

**Act** — `click`, `type`, `press` (keys and chords), `scroll`, `move`,
`drag`, `paste`, `set-value`, `action` (a named accessibility action).

**The system** — `app` (launch, focus, quit, hide, list), `window` (focus,
move, resize, minimize, set-bounds, list), `menu` (click, list), `menubar`,
`dock`, `dialog`, `clipboard` (get, set, save, restore), `space`.

## Grammar shared by every command

- **Targets**: `--app`, `--window-title`, `--window-id`, an element id from a
  `see`, a text query, or `--at x,y`. Coordinates are relative to the targeted
  window unless you add `--global`.
- **Durations**: `500`, `500ms`, `2s`, `1.5s` are the same kind of value.
- **Modifiers**: comma-separated — `cmd,shift`.
- **Output**: `--json` on everything. `success`, `data`, `error`, and — for
  actions — `effect`.

## Install

`peekaboo` needs macOS 15 or later.

```bash
brew tap steipete/tap
brew install steipete/tap/peekaboo
peekaboo --version
```

If it is not on `PATH`, say so and stop — do not build it from source.
