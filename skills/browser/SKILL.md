---
name: browser
description: "Any browser and anything on the web — a page, a click, a form, a sign-in, a tab. Open a page and read it, fill a form, sign in, download, screenshot, print a page or an HTML file to PDF. It can put a real window on their screen to show them the thing itself — an order at checkout, a map, a page — and it is how a browser is reached even when one is already running on their Mac (`attach`) — a browser is never driven by clicking it through the machine. A page that wants a sign-in is still this skill's job: a kept session, the browser they are already in, or the window this opens in front of them."
allowed-tools: Bash(playwright-cli:*) Bash(npx:*) Bash(npm:*)
---

# The browser

You drive a real browser from your shell with `playwright-cli`: open a page,
read it as a snapshot, act on elements by ref.

## In this app

Everything the app has to say about the browser is here; the prompts do not
repeat it.

**Every browser goes through here.** A job that names a browser, a site, a URL,
a sign-in or a tab is this one's. With `--headed` the window `playwright-cli`
opens is a real one on their screen — they can watch it and type into it. Never drive Chrome by
clicking it through the machine (`osascript`, `peekaboo`, System Events): that
window cannot be snapshotted or acted on by ref. For the browser they already
have open — a tab they left, a profile they are signed into — attach instead:
`playwright-cli attach --cdp=chrome`.

**Your browser is this job's own.** Its session is already in your shell
(`PLAYWRIGHT_CLI_SESSION`): never pass `-s=`, never `close-all` or `kill-all` —
other jobs are running theirs.

**Headless is yours; headed is theirs.** A browser opens headless: nobody sees
it, and the app closes it when the job ends. `--headed` puts a real window on
their screen, and that window outlives the job — the app never closes it, they
do. So you can show them the thing itself instead of describing it: the order
sitting at checkout for them to confirm, the map with the pin dropped, the page
they asked to watch, a sign-in for them to finish. Open it `--headed`, leave it
open, and say in your answer that it is on their screen. A window you opened
headed only to get past a wall and are done with, `close` yourself. Only a job
they cancel or delete takes its windows with it.

**A payment is theirs to press.** Take a purchase, a top-up or a subscription
as far as the last screen before money moves, open it `--headed`, and answer
with what it buys, for how much, and that the pay button is on their screen.
That is the job done, not stopped — never press it yourself, whatever the
request said.

A site that will want a session before it shows you anything — a shop, a
console, a dashboard, an account page — starts `--headed --persistent` rather
than finding out headless and starting over.

**Blocked, not broken.** A 403, an "access denied" page, a wall about automated
traffic is refusing the headless browser, not the job. `close`, then
`open <url> --headed --persistent` — a real window carrying a profile gets past
most of it, and is worth trying before you conclude anything about the site.
Still refused after that, the wall is real: say so in your report, with the url
and whatever you did bring back.

**A sign-in is a fork, not a wall.** Four ways through, and which one fits is
yours to read off the job:

- **A session you already kept.** `ls <your folder>/.auth/`, then `state-load`
  that file and `goto` the site — cookies without a reload leave the signed-out
  page that was already drawn, which reads as an expired session when it is not.
  Cheapest when it works, so look before anything else.
- **The browser they are already in.** `attach --cdp=chrome` carries their own
  profile and whatever it is signed into.
- **They sign in themselves.** `open <the login url> --headed --persistent` —
  the login page, not the front door — then `ask_thursday` in one line saying
  what to sign into and that the window is open, options `Signed in` / `Not
  now`, and stop. The window stays open while the job waits; continue from a
  fresh `snapshot` when the answer comes. A captcha is the same move. Not
  `show` — it blocks waiting for annotations nobody will send.
- **You have the credentials.** Ask before you use them: `ask_thursday` in one
  line naming the account, options `Sign in with it` / `I'll do it`, and on the
  second take the fork above. An answer to your own sign-in question is the
  exception — credentials given there are already the yes, so type them.

The line is where the secret comes from, not what kind it is: never guess,
invent, or go looking for one somewhere they did not point you at. An email or
username they gave you is not a secret — fill it and press next. `memory_recall`
the note for that site when you are missing the address they use.

**Keep a sign-in for the next job.** `mkdir -p <your folder>/.auth` and
`state-save` into it after one succeeds — your own folder, the one your
instructions name, because a session is yours across jobs and the workspace root
is nobody's. Say that you kept it: it signs every later job in as them, which is
theirs to want or not. These files never go in a report.

**Reading a page.** Every command writes a snapshot file and prints its path.
`find "Create Key"` returns only the matching nodes with a few lines around
each — use it when you know what you are after. `cat` the file when you need
the whole layout. `snapshot e34` is one region; `--raw eval` is one value.
Pulling the markup in (`innerHTML`, `curl`) spends a page of context on a
navigation menu; the snapshot is the same page for a fraction of it. On anything
long, `find` and `snapshot <ref>` are the cheap way through — keep raw HTML for
when the markup itself is what you need. A page that draws itself from a fetch
is cheaper at the source: `requests` numbers what it pulled, `response-body N`
prints one — the data already parsed, rather than read back out of the DOM.

**Refs go stale** after anything that changed the page — snapshot again before
the next click. A page that looks empty right after loading is still rendering.
A click that seems to do nothing may have opened a tab: `tab-list`,
`tab-select N`.

**Pictures for a document** come off the page, never from memory:
`--raw eval "JSON.stringify([...document.images].filter(i => i.naturalWidth > 200).map(i => i.currentSrc))"`.

**Local HTML.** `file:` URLs are refused. Serve the folder, then open it:
`python3 -m http.server 48800 --bind 127.0.0.1 --directory <dir> &`,
`goto http://127.0.0.1:48800/<file>.html`; `pdf --filename=out.pdf` prints
it. Kill the server when done.

Snapshots land in `.playwright-cli/` and are cleared after a few days. A file you
name — `--filename=`, a `pdf`, a download — goes under `scratch/`, or
`artifacts/` when it is the result.

## Install

The app fetches the browser itself when it starts, so this is only for a machine
where that never finished. `open` failing with a missing executable is the tell:

```bash
playwright-cli install-browser chromium
```

It downloads ~280 MB and prints nothing when the build is already there. If it
fails, say so and stop — do not fall back to a browser you found on the machine.

## Commands

```bash
playwright-cli open                       # headless; add a url to navigate at once
playwright-cli open <url> --headed        # a real window on their screen
playwright-cli open <url> --persistent    # keep a profile between opens
playwright-cli open --mobile              # mobile layout — lighter pages, smaller snapshots
playwright-cli attach --cdp=chrome        # the browser they already have open
playwright-cli goto <url>
playwright-cli go-back | go-forward | reload
playwright-cli resize 1280 800            # before a screenshot or a pdf

playwright-cli snapshot                   # the page, as refs — written to a file
playwright-cli snapshot e34               # one region
playwright-cli find "Sign in"             # matching nodes with context
playwright-cli find --regex "/sign (in|up)/i"

playwright-cli click e3                   # also: dblclick, hover, drag e2 e8, drop e8
playwright-cli fill e5 "text" --submit    # --submit presses Enter after
playwright-cli type "text"
playwright-cli press Enter                # ArrowDown, Escape, …
playwright-cli select e9 "option-value"
playwright-cli check e12 | uncheck e12
playwright-cli upload ./file.pdf
playwright-cli dialog-accept ["text"] | dialog-dismiss

playwright-cli tab-list | tab-new [url] | tab-select N | tab-close [N]

playwright-cli requests                   # what the page fetched, numbered
playwright-cli request 7                  # one of them whole: headers, body, response
playwright-cli response-body 7            # just the body

playwright-cli eval "document.title"
playwright-cli eval "el => el.textContent" e5
playwright-cli --raw eval "…"             # only the value, nothing else printed

playwright-cli screenshot [e5] [--filename=x.png]
playwright-cli pdf --filename=page.pdf
playwright-cli state-save .auth/site.json | state-load .auth/site.json
playwright-cli close
```

Targets are refs from the snapshot (`e15`). A css selector or a Playwright
locator works too: `click "#main > button.submit"`,
`click "getByRole('button', { name: 'Submit' })"`.
