---
name: browser
description: "Any browser and anything on the web — a page, a click, a form, a sign-in, a tab. Open a page and read it, fill a form, sign in, download, screenshot, print a page or an HTML file to PDF. This opens a real window on their screen, and it is how a browser is reached even when one is already running on their Mac (`attach`) — a browser is never driven by clicking it through the machine. A page that wants a sign-in is still this skill's job: the user signs in themselves, in the window this opens."
allowed-tools: Bash(playwright-cli:*) Bash(npx:*) Bash(npm:*)
---

# The browser

You drive a real browser from your shell with `playwright-cli`: open a page,
read it as a snapshot, act on elements by ref.

## In this app

Everything the app has to say about the browser is here; the prompts do not
repeat it.

**Every browser goes through here.** A job that names a browser, a site, a URL,
a sign-in or a tab is this one's. The window `playwright-cli` opens is a real
one on their screen — they can watch it and type into it. Never drive Chrome by
clicking it through the machine (`osascript`, `peekaboo`, System Events): that
window cannot be snapshotted or acted on by ref. For the browser they already
have open — a tab they left, a profile they are signed into — attach instead:
`playwright-cli attach --cdp=chrome`.

**Your browser is this job's own.** Its session is already in your shell
(`PLAYWRIGHT_CLI_SESSION`): never pass `-s=`, never `close-all` or `kill-all` —
other jobs are running theirs. The server closes yours when the job ends.

**Headless unless they should see it.** Add `--headed` when the window is the
point — a sign-in, something they asked to watch — and say so in your
`description`. A site that will want a session before it shows you anything — a
shop, a console, a dashboard, an account page — starts `--headed --persistent`
rather than finding out headless and starting over.

**Blocked, not broken.** A 403, an "access denied" page, a wall about automated
traffic is refusing the headless browser, not the job. `close`, then
`open <url> --headed --persistent` — a real window carrying a profile gets past
most of it, and is worth trying before you conclude anything about the site.
Still refused after that, the wall is real: say so in your report, with the url
and whatever you did bring back.

**A sign-in is not a wall.** The user is at this screen and signs in
themselves, in a window you put in front of them. Never type a password, a
one-time code, or answer a passkey prompt — not with `fill`, `type` or `eval`.
An email or username they gave you is not a secret: fill it, press next, stop
at the password. When you do not have it, look before you ask — `memory_recall`
the note for that site or account carries the address they use; only when it is
nowhere does the sign-in go back to them. When a page wants the secret half:

```bash
playwright-cli close
playwright-cli open <the login url> --headed --persistent
```

Open the login page itself, not the front door. Then `ask_thursday` in one
line — what to sign into, that the window is open — with options
`Signed in` / `Not now`, and stop. The window stays open while the job waits.
When the answer comes back, continue from a fresh `snapshot`. A captcha is the
same move. Never `show` — it blocks waiting for annotations nobody will send.

**Keep a sign-in for the next job.** After one succeeds:
`state-save .auth/<site>.json`. Before a site that will want one, `ls .auth/`
and `state-load .auth/<site>.json` if its file is there. These files never go
in a report.

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

Snapshots land in `.playwright-cli/` and are cleared after an hour. A file you
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
