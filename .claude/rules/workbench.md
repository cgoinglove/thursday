---
checked: 2026-09-24
paths:
  - "features/workspace/*.ts"
  - "lib/sandbox.ts"
  - "features/signins/**"
  - "features/ai/tools/{workspace,signin}.tool.ts"
  - "app/api/{workspace,signins}/**"
  - "skills/browser/**"
---

# The bots' workbench

A bot works on this computer with a shell, a real browser and the sign-ins the user chooses to lend
it, in a workspace the app lays out and clears by age.

## Start here
- `features/workspace/workspace.ts` — the workspace folders, `writeRefusal`, `insideWorkspace`, each shell's environment, fetching the browser, closing and forgetting a thread's browsers.
- `lib/sandbox.ts` — the shell: scrubbed environment, timeouts that kill the process group, long output folded to a file.
- `features/ai/tools/workspace.tool.ts` — `bash`, `write_file`, and the shell guide on a bot's first command.
- `features/signins/signins.query.ts` — the sign-in vault: keep, borrow, renew, whose browser a session drives.
- `features/ai/tools/signin.tool.ts` — `sign_in_use` and `sign_in_keep`.
- `features/signins/components/signins-setting.tsx` — Settings › Sign-ins: which bots may borrow, and signing out.
- `skills/browser/SKILL.md` — what a bot is told about the browser.

## How it fits
Every shell opens through `openWorkspace` onto `lib/sandbox`; for a bot, `features/ai/load-tools.ts`
lays `jobShellEnv` and `botShellEnv` over each command and hands the same session to the deck and
sign-in tools. The sandbox is a working directory and a scrubbed environment, not isolation: `bash`
reaches the whole disk as the user, and `writeRefusal` fences `write_file` alone.
`features/bot/bot.runner.ts` calls the closing functions here on cancel and delete and in
`sweepJobFiles`, which boot and a timer run; `features/bot/bot.run.ts` renews kept sign-ins after
every turn. A bot refused a sign-in it did not keep lands on that sign-in's `asking` list, and only
Settings › Sign-ins or `signin-ask.tsx` in its question lets it in.

## Rules
- Every command a bot's tools send the browser CLI carries that participant's `jobShellEnv`
  (`botBrowserSession`: one job, one participant) — without it the command lands in the shared
  `default` session no cancel closes, and a session keyed to the bot alone lets one job's `open`
  close another's browser.
- A second browser a job opens is named `<its session>-<suffix>`, as `inPageApart` in
  `skills/browser/scripts/session.mjs` does — cancel, delete and the sweep find a thread's browsers
  and profiles by that prefix, and never one under another name.
- Change `@playwright/cli`'s version or range in `package.json` only after the browser check below —
  each install of the published package resolves that range itself (`scripts/pack.mts`), and this
  area leans on the CLI's variable names, `list --json`, the `.playwright` marker and how it names
  its daemon folder, where a change fails quietly as windows left open and profiles piling up.

## Check
`pnpm test:bot` runs bots' shells against a stand-in `playwright-cli`, so it proves nothing about the
real browser or a sign-in. To see them, on a scratch app (AGENTS.md › Running the app; its command
skips the browser download, so the browser must already be in Playwright's cache) have a bot open a
page `--headed`: cancelling the job closes the window and keeps its profile in the CLI's daemon
folder (`forgetBrowserData` says where), and deleting the job then removes the thread's entries
there. A sign-in kept there lands in the scratch home's `.sign-ins`. `playwright-cli attach` drives
the real Chrome of whoever runs it, scratch app or not.
