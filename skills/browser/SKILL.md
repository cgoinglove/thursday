---
name: browser
description: "Drives a real browser from the shell: open, read, click, fill, sign in, download. Use it before the first browser command of any web job: a page, a form, a checkout, a sign-in, their own Chrome."
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

**Your browser is your own on this job.** Its session is already in your shell
(`PLAYWRIGHT_CLI_SESSION`): never pass `-s=`, never `close-all` or `kill-all` —
other bots and jobs are running theirs. A follow-up uses this same session:
read `snapshot` to continue where you left off; use `open` only if it is closed.

**Headless is yours; headed is theirs.** A browser opens headless: nobody sees
it, and the app keeps it for follow-ups until the job's workspace expires.
`--headed` puts a real window on their screen, and that window outlives the job
until they close it or cancel or delete the job. Show them the thing itself: the products
they asked you to find, the order sitting at checkout for them to confirm, the map with the
pin dropped, the page they asked to watch, a sign-in for them to finish. Open it `--headed`,
leave it open, and say in your answer that it is on their screen. A window you opened
headed only to get past a wall and are done with, `close` yourself. A window is never how
you look at your own work: a page, a deck, a canvas or a picture book you made is shown to
you by its skill's `shots` and `look_at`, and reaches them under your answer — nor is `open` on their
desktop. Only a job they cancel or delete takes its windows with it.

**A payment is theirs to press.** Take a purchase, a top-up or a subscription
as far as the last screen before money moves, open it `--headed`, and answer
with what it buys, for how much, and that the pay button is on their screen.
That is the job done, not stopped — never press it yourself, whatever the
request said.

A site that will want a session before it shows you anything — a shop, a
console, a dashboard, an account page — starts `--headed --persistent` rather
than finding out headless and starting over.

**A wall is the site's answer.** A 403, an "access denied" page, a check for
automated traffic or a captcha is the site saying no to a bot, and getting round
it is not yours to do: no other browser, profile or disguise, no waiting it out.
Take what the job needs from where it is published otherwise — another source,
the site's own API, a search. When only that page will do and it is one they
would open themselves — the shop they named, their bank — open it `--headed` for
them and ask, as a sign-in below: a person may pass where a bot may not.
Otherwise say in your report which url refused you, and bring back what you have.

**A sign-in is a fork, not a wall.** Three ways through, and which one fits is
yours to read off the job:

- **A sign-in the app already keeps.** Cheapest when it works, so try it before
  the other two. It goes into the browser you have open, so the order is `open`,
  then the `sign_in_use` tool with the site, then `goto` — a state loaded with no
  browser open is refused, and one loaded before you `open` again is thrown away
  with the browser that held it. Open the window you mean to keep first, headed
  or not. `goto` last because cookies without a reload leave the signed-out page
  that was already drawn, which reads as an expired session when it is not.
- **Their own Chrome.** `attach --extension=chrome` gives you a tab of your own
  in the Chrome they use, signed in as they are; their tabs stay theirs. It is the
  way through for a site that still shows you signed out right after
  `sign_in_use` — some refuse a sign-in carried between browsers, and signing in
  again in your window will not last there either. It needs the Playwright
  extension in their Chrome: when the command says it is missing, give them the
  link it prints and ask. A click there waits on a tab that is in front:
  `--raw run-code "async page => page.bringToFront()"` first.
- **They sign in themselves.** `open <the login url> --headed --persistent` —
  the login page, not the front door — then a `question` to Thursday in one line
  saying what to sign into and that the window is open, options `Signed in` /
  `Not now`, and stop. The window stays open while the job waits; continue from a
  fresh `snapshot` when the answer comes. A captcha or a code sent to their phone
  is the same move. Not `show` — it blocks waiting for annotations nobody will
  send. Once they are in, call the `sign_in_keep` tool: the app keeps the sign-in
  for your later work, and they can sign out of it in Settings. The window was for
  the sign-in, so it closes and your browser goes on without one, signed in, on the
  same page — unless what comes next there is theirs to see, the products to choose
  or a checkout to confirm: then pass `keepWindow` and it stays.

Never guess or invent a secret, or go looking for one somewhere they did not
point you at. An email or username they gave you is not a secret — fill it and
press next. `memory_recall` the note for that site when you are missing the
address they use.

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
What only the eye can tell — a chart, a photo, whether the layout came out —
is a `screenshot` and then the `look_at` tool, when you hold it.

**Refs go stale** after anything that changed the page — snapshot again before
the next click. A page that looks empty right after loading is still rendering.
A click that seems to do nothing may have opened a tab: `tab-list`,
`tab-select N`.

**One command, not one turn per step.** Chain steps that need no look in between
with `&&`. What a click brings in is not there on the very next read: wait for
its text in the same command, `--raw run-code "async page => { await page.waitForFunction(t => document.body.innerText.includes(t), '<text>'); }"`
— `getByText(…).waitFor()` times out when the first match is hidden.

**Search and locale.** A search engine's results page is for people, and most
refuse a browser a script drives. Find urls with the `web_search` tool; without
one, search where the answer lives — the site's own search box, Wikipedia — and
say in your report that you had no web search. Pages answer in this machine's
language and currency; put the country in the url when the job is about another.

**Pictures for a document** come off the page, never from memory:
`--raw eval "JSON.stringify([...document.images].filter(i => i.naturalWidth > 200).map(i => i.currentSrc))"`.

**Local HTML.** `file:` URLs are refused, and a fixed port lets two jobs
capture each other's pages. To open or print one:
`node <skill dir>/scripts/serve.mjs <dir> > <scratch>/serve.log 2>&1 &`, read the
address from that log, `goto <address><file>.html`; `pdf --filename=out.pdf`
prints it, in a headless browser. Kill the server when done.

**Scripts in `<skill dir>/scripts`**: `sheet.mjs` puts many pictures on one
image for a single `look_at`, `webimage.mjs` saves a page's own picture with
its credit line, and `session.mjs` lets a script of yours drive this session —
`references/scripts.md`. What one `run-code` call can do — several reads at
once, a wait, a download, the clipboard — is `references/run-code.md`; a
recording of the screen for the user is `references/recording.md`.

Snapshots land in `.playwright-cli/` and are cleared after a few days. A file you
name — `--filename=`, a `pdf`, a download — goes under `scratch/`, or
your folder under `artifacts/` when it is the result.

## Install

The app fetches the browser itself when it starts — Google Chrome for Testing, set
in your shell, never the user's own Chrome — so this is only for a machine where
that never finished. `open` failing with a missing executable is the tell:

```bash
playwright-cli install-browser chromium
```

It downloads ~280 MB and prints nothing when the build is already there. If it
fails, say so and stop — do not fall back to a browser you found on the machine.

On Linux, `open` failing because the browser closed before any page, with an
empty browser log, is missing system libraries rather than a missing download.
Installing them needs administrator rights: tell the user to run
`npx playwright install-deps chromium` once, and stop.

## Commands

```bash
playwright-cli open                       # headless; add a url to navigate at once
playwright-cli open <url> --headed        # a real window on their screen
playwright-cli open <url> --persistent    # keep a profile between opens
playwright-cli open --mobile              # mobile layout — lighter pages, smaller snapshots
playwright-cli attach --cdp=chrome        # the browser they already have open, every tab
playwright-cli attach --extension=chrome  # one tab of your own in their Chrome
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
playwright-cli close
```

Targets are refs from the snapshot (`e15`). A css selector or a Playwright
locator works too: `click "#main > button.submit"`,
`click "getByRole('button', { name: 'Submit' })"`.
