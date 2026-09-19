---
name: mail
description: "Read and answer web mail by script instead of snapshots: list a search, read a thread into a file, save a draft or an in-thread reply. Gmail today; another site is one more recipe."
---

# Mail by script

`scripts/mail.mjs` drives the browser this shell already has, so it rides whatever that browser
is signed in to. Open it and load the sign-in first (`playwright-cli open`, then `sign_in_use`
with `google.com`); the script goes to the page itself. Each command is one bash call and prints
a few lines, never a page.

```bash
M="node <skill dir>/scripts/mail.mjs gmail"
$M list [query] [--max N] [--json]   # Gmail search syntax; default in:inbox, 20, newest first
$M unread [label] [--json]           # how many are unread, and the newest 20
$M read <id> <file> [--head N]       # the whole thread as text into <file>; prints its head
$M draft --to a@x.com[,b@y.com] [--cc …] --subject "…" --body-file <file>
$M reply <id> --body-file <file> [--all]
```

A list line is `id * date | from <address> | subject (messages) — snippet`, `*` marking unread.
`read` and `reply` take that id, or any message id from the thread.

**What it costs.** `unread` and `read` are plain requests on the session's cookies and draw no
page: about a second. `list`, `draft` and `reply` drive the Gmail app; the first loads it (5-8 s),
later ones take 1-2 s. A snapshot of the inbox is about 140,000 characters; `list` of 20 is 7,000.

**What marks mail read.** `list` and `unread` never do. `reply` opens the thread, which does.
`read` on an unread thread may; when the snippet answers the question, leave it unread.

**Nothing here sends.** `draft` and `reply` stop once Gmail has saved the draft, with the compose
left open in this browser; Send is a separate click, and none of these commands make it.

**An error is the answer.** `Layout changed: …` means the recipe no longer matches Gmail, never
that there is no mail: fix it with [references/recipes.md](references/recipes.md). `Signed out`
means load the sign-in again; if it still says so, the site ended the session.
