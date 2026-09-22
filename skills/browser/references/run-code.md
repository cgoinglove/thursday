# Running code in the page

`playwright-cli run-code "async page => { … }"` runs one Playwright function against the
session's current page and prints what it returns. It is how a script of yours, or one
command of yours, does what no single CLI command does: read many things at once, wait for
a condition, save a download, read the clipboard.

- One function expression, wrapped in `(...)`: no `import`, `require` or top-level statements.
- `--raw` prints only the return value (JSON), without the snapshot that follows an action.
- A long function goes in a file: `run-code --filename=<scratch>/code.js`.
- The code runs beside the browser, not in Node: no `fetch`, `setTimeout` or `URL` there.
  `page.request` fetches with the session's cookies, `page.waitForTimeout` waits, and DOM work
  goes inside `page.evaluate`.

```bash
# Several facts in one call
playwright-cli --raw run-code "async page => ({ title: await page.title(), url: page.url() })"

# Wait for text the page draws late, then act in the same command
playwright-cli --raw run-code "async page => { await page.waitForFunction(t => document.body.innerText.includes(t), 'Order placed'); }"

# Save a download where the job's files go
playwright-cli --raw run-code "async page => {
  const waiting = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download' }).click();
  const file = await waiting;
  await file.saveAs('scratch/<job>/' + file.suggestedFilename());
  return file.suggestedFilename();
}"

# Read the clipboard after a Copy button
playwright-cli --raw run-code "async page => { await page.context().grantPermissions(['clipboard-read']); return page.evaluate(() => navigator.clipboard.readText()); }"
```

A file the page hands you goes under `scratch/` while you work and under `artifacts/` when it
is a result, never beside the code. A sign-in is never done here: the kept sign-in is loaded
with the `sign_in_use` tool, and a site with none opens in a window the user signs in to.
