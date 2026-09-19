# Scripts that ride this session

The scripts in this skill's `scripts/` folder work through the browser session already in
your shell (`PLAYWRIGHT_CLI_SESSION`), so they reach whatever it is signed in to. Each opens a
tab of its own and closes it, leaving the page you were on as it was. In a bot's shell the
folder is also `$THURSDAY_SKILLS/browser/scripts`, which is how a skill's own script finds it.

## Pictures

```bash
S=<skill dir>/scripts
# Each [data-slide] of an HTML file (or the whole viewport) as a PNG of exactly that size
node $S/render.mjs <slides.html> --size 1080x1350 --out <dir> [--name slide]
# A page's own picture (og:image), with --all its large pictures too, and the credit line
node $S/webimage.mjs <page url> --out <dir> [--all] [--min 600]
# Many pictures, urls or files, on one labelled image to look at once
node $S/sheet.mjs --out sheet.png <image url | file>... [--cols 4]
```

`render` serves the file's folder on a port the system picks, so pictures and fonts beside it
load and two jobs rendering at once never meet. It fails when a slide comes out at another
size, and names any picture that did not load. `webimage` and `sheet` fetch through the
browser, so a site that refuses `curl` still answers and a picture behind a sign-in loads.

## A script of your own

`session.mjs` is the one way in: `runCode(source)` runs one `async page => …` and returns what
it returned, parsed; `inPage(fn, args, helpers)` sends a function with its arguments; it also
has `parseArgs`, `fail` and `orFail` (a returned `{ error }` stops the script with it).

```js
const { inPage, orFail } = await import(
  `${process.env.THURSDAY_SKILLS}/browser/scripts/session.mjs`
);
const rows = orFail(
  await inPage(async (page, { url }) => {
    await page.goto(url);
    return page.evaluate(() => [...document.querySelectorAll("h2")].map((h) => h.textContent));
  }, { url: "https://example.com" }),
);
```

What crosses is source text, run in a bare VM beside the browser — not Node, not the page:

- Nothing from your module comes along. What the function needs arrives in `args` (JSON) or as
  another function in `helpers`.
- There is no `URL`, `URLSearchParams`, `fetch`, `setTimeout` or `require`. Build an address
  with string work and `encodeURIComponent`; fetch with `page.request.get(url)`, which carries
  the session's cookies and draws nothing; wait with `page.waitForTimeout` or
  `page.waitForFunction`; do DOM work inside `page.evaluate`.
- Files are written by your script from what comes back, not inside the function
  (`page.screenshot({ path })` is the exception: the browser writes it).
- Code over 64 KB goes through a file; `runCode` does that itself.
- A page that forces Trusted Types (Gmail) refuses an HTML string: parse fetched HTML with
  `DOMParser` through a policy it allows.
