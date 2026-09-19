---
name: verify
description: Look at the running Thursday app to confirm a change works on screen, without touching anyone's database. Use when asked to run the app and look, check a screen, take a screenshot, or after a UI change that has to be seen, not only type-checked.
---

The user's own dev server runs on their database: opening it the wrong way writes to it (opening a thread marks it seen) and starting another server on it restarts paused bot jobs. So a look is always one of two things.

1. **Attach, read-only, to the user's server** when it is up and the change is already hot-reloaded there. Find it by its working folder, never by port: `for p in $(pgrep -f "next dev"); do lsof -a -p $p -d cwd -Fn | grep -q "n$(git rev-parse --show-toplevel)$" && lsof -nP -a -p $p -iTCP -sTCP:LISTEN; done`. Look only: do not open a thread, answer a question, press a button that sends, or change a setting.
2. **Serve a copy on its own empty data folder** for anything that needs clicking, fake states or data: `bash .claude/skills/verify/serve.sh start` (prints the URL), and `bash .claude/skills/verify/serve.sh stop` when done — always, even after a failure. It picks a free port and never stops a server it did not start. When another `next dev` already holds this folder (Next allows one), it builds and serves the build instead; that takes a minute.

Then drive it headless with `node .claude/skills/verify/look.cjs <url> <out.png> [width] [height]` for one screen, or copy `look.cjs` next to it and script the steps (fill, press, wait for an element). Read every screenshot before saying it works, and say what page errors it printed.

- Never `--headed`: a headed window runs the user's own Chrome and takes over the links they click.
- Wait for elements, not for the network to go quiet: the app keeps a server-sent event stream open.
- Fake a state (a question ringing, a failed job, a long list) with `page.route`: fetch the real response, change the JSON, `route.fulfill` it. Hold a loading state with a route that never answers.
- A real call needs the user's microphone and spends their key: stop at the screen before placing one and ask.
- When the question is "does it build and run" rather than "how does it look", `next-dev-loop` (if installed, see `AGENTS.md`) asks the running Next server for its compile and runtime errors.
