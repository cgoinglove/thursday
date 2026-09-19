# Recipes

A recipe is one file in `recipes/`, named after the site the first argument of `mail.mjs` names
(`gmail` → `recipes/gmail.mjs`). It holds everything that breaks when the site changes:

- `base` and `urls` — the address shapes: the app, a search, a thread, compose, and any plain
  endpoint that answers without drawing the app (Gmail's unread feed and print view).
- `sel` — every selector and every word matched on screen.
- `seen` — the day the recipe last worked.
- `steps` — `list`, `unread`, `read`, `draft`, `reply`, each `async (page, args, r)`.

This copy is in your own folder, so what you change here is what every later job runs.

## When a command says `Layout changed`

1. Read the error: it names the selector or the step that failed.
2. Look once. Open the page it was on and read the part in question — `playwright-cli find` with
   words you expect there, or `snapshot <ref>` for one region. `--raw eval` confirms a candidate:
   `playwright-cli --raw eval "document.querySelectorAll('<selector>').length"`.
3. Change that one entry in `sel` (or `urls`), set `seen` to today, and run the command again.
4. Still failing after one fix: say what broke in your report, and do the rest of the job by
   snapshot. Never run a broken recipe twice.

Class names in Gmail (`tr.zA`, `.bog`) are generated but have held for years; the empty-search
panel (`.HBrgMb`) and the sort menu's words are the likeliest to move. The sort words follow the
account's display language.

## How a step runs

`mail.mjs` turns the recipe into one `playwright-cli --raw run-code` call: every step is
serialized to text and run inside the browser session, and what the step returns comes back as
JSON. So a step:

- uses only its arguments, `r` and `r.steps.<other>` — nothing from the file around it, no imports;
- has no `URLSearchParams`, `fetch` or `require` at the top level: build addresses with
  `encodeURIComponent`, fetch with `page.context().request.get(url)` (it carries the session's
  cookies and draws nothing), and do DOM work inside `page.evaluate`;
- parses fetched HTML inside the page with `DOMParser` — on Gmail through a Trusted Types policy,
  since the page refuses raw strings;
- throws an `Error` whose message says what to fix, rather than returning an empty list.

## Adding a site

Copy `gmail.mjs` to `recipes/<site>.mjs` and fill the same five steps, returning the same shapes:

- `list`: `{ rows: [{ id, unread, date, from, email, subject, count, snippet }], total }`
- `unread`: the same, for unread mail only; a site with no cheap way returns `list` of its unread
  search.
- `read`: `{ subject, messages: [{ from, date, to, body, links }] }`
- `draft`, `reply`: a sentence saying where the draft was saved.

Find the cheap read first: load the site once, run `playwright-cli requests`, and look for a
feed, a print or "show original" view, or a JSON call carrying the list — `response-body N`
shows it. A request on the session's cookies beats reading the drawn app. Try every step by
hand on mail that is already read, and write down in `sel` comments what each selector is.
