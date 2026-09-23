import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// The workspace is found from the data folder as the modules load: keep it off anyone's own
const home = await mkdtemp(join(tmpdir(), "thursday-page-edits-"));
process.env.THURSDAY_HOME = home;
after(() => rm(home, { recursive: true, force: true }));

const { editedSince, getBetween, putBetween } = await import(
  "../skills/shell/put.mjs"
);
const { wear } = await import("../skills/shell/wear.mjs");
const { WORKSPACE } = await import("../features/workspace/workspace.ts");
const { savePage } = await import("../features/workspace/workspace.query.ts");

/** A page as a script's `new` writes it: the shell's head, and a body between the marks. */
const page = (body: string): string =>
  wear(
    `<!doctype html><html><head>{{shell.meta}}</head><body><main id="paper">\n<!-- put: start -->\n${body}\n<!-- put: end -->\n</main></body></html>`,
  );
const revisionOf = (html: string) =>
  /<meta name="revision" content="([^"]*)">/.exec(html)?.[1];
const withoutMark = (html: string) =>
  html.replace(/<!-- put: start[^>]*-->/, "");

test("a put over a body edited since is refused until the page is got again", () => {
  let html = putBetween(page("<p>Template</p>"), "<p>First</p>");
  assert.equal(editedSince(html), false);
  // The bot's own next put, over what it put itself
  html = putBetween(html, "<p>Second</p>");
  assert.equal(editedSince(html), false);

  // The reader edits it where the app shows it
  const edited = html.replace("Second", "Second, edited in the app");
  assert.equal(editedSince(edited), true);

  const got = getBetween(edited);
  assert.ok(got);
  assert.equal(got.content, "<p>Second, edited in the app</p>");
  assert.equal(editedSince(got.html), false);
  // Getting moves the mark and nothing else
  assert.equal(withoutMark(got.html), withoutMark(edited));
});

test("every put names a new revision, and a page from before revisions is given one", () => {
  const made = page("<p>One</p>");
  const put = putBetween(made, "<p>Two</p>");
  assert.ok(revisionOf(made));
  assert.ok(revisionOf(put));
  assert.notEqual(revisionOf(put), revisionOf(made));

  const older = made.replace(/<meta name="revision"[^>]*>\n?/, "");
  assert.equal(revisionOf(older), undefined);
  assert.ok(revisionOf(putBetween(older, "<p>Two</p>")));
});

test("a save from a page opened before the file's last write is refused, and one after it names a new revision", async () => {
  const rel = "artifacts/Tester/report.html";
  const file = join(WORKSPACE, rel);
  await mkdir(join(WORKSPACE, "artifacts", "Tester"), { recursive: true });
  const opened = page("<p>One</p>");
  await writeFile(file, opened);

  // A bot puts new work in while the page is open; the open page's tick must not undo it
  const put = putBetween(opened, "<p>Two</p>");
  await writeFile(file, put);
  assert.deepEqual(
    await savePage(
      rel,
      opened.replace("One", "One, ticked"),
      revisionOf(opened) ?? "",
    ),
    { changed: true },
  );
  assert.equal(await readFile(file, "utf8"), put);

  // Opened again it keeps its edits, under a revision the next save names
  const saved = await savePage(
    rel,
    put.replace("Two", "Two, ticked"),
    revisionOf(put) ?? "",
  );
  assert.ok(!saved.changed);
  const now = await readFile(file, "utf8");
  assert.match(now, /Two, ticked/);
  assert.equal(revisionOf(now), saved.revision);
  assert.notEqual(saved.revision, revisionOf(put));
  // A second window still on the revision before that save is refused
  assert.deepEqual(
    await savePage(
      rel,
      put.replace("Two", "Two, other window"),
      revisionOf(put) ?? "",
    ),
    { changed: true },
  );
});

test("a page from before revisions keeps its edits as it did", async () => {
  const rel = "artifacts/Tester/older.html";
  const file = join(WORKSPACE, rel);
  await mkdir(join(WORKSPACE, "artifacts", "Tester"), { recursive: true });
  const older = page("<p>One</p>").replace(
    /<meta name="revision"[^>]*>\n?/,
    "",
  );
  await writeFile(file, older);
  const edited = older.replace("One", "One, edited");
  assert.deepEqual(await savePage(rel, edited, ""), {
    changed: false,
    revision: "",
  });
  assert.equal(await readFile(file, "utf8"), edited);
});
