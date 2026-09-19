import assert from "node:assert/strict";
import { test } from "node:test";
import { decodePagePath, decodePath, queryKey } from "../app/api/query-key.ts";
import { opensOnFinish, pathsIn } from "../features/workspace/file-kind.ts";

test("a finished job opens only a page among the finished work, never a data file or a bot's own", () => {
  const report =
    "Signed in and saved to bots/Mail/.auth/gmail.json. Notes in bots/Mail/memory/inbox.md, raw rows in artifacts/Mail/rows.json, slides in artifacts/Insta/slide_1.png, and the summary is artifacts/Mail/summary.md.";
  assert.equal(
    pathsIn(report).find(opensOnFinish),
    "artifacts/Mail/summary.md",
  );
  assert.equal(opensOnFinish("artifacts/Analyst/report.html"), true);
  assert.equal(opensOnFinish("artifacts/Analyst/data.csv"), false);
  assert.equal(opensOnFinish("scratch/job/draft.md"), false);
});

test("viewer URLs round-trip Unicode, spaces and reserved filename characters", () => {
  const paths = [
    "artifacts/\uBCF4\uACE0\uC11C.md",
    "artifacts/project notes/report #1?.md",
    "artifacts/100% complete.html",
    "artifacts/literal%2Fname.md",
  ];
  for (const path of paths) {
    const encoded = queryKey.fileView(path).slice("/artifact/".length);
    assert.equal(decodePagePath(encoded.split("/")), path);
    assert.equal(decodePath(path.split("/")), path);
  }
});

test("page decoding preserves percent-encoded text in the actual filename", () => {
  assert.equal(
    decodePagePath(["artifacts", "literal%252Fname.md"]),
    "artifacts/literal%2Fname.md",
  );
  assert.equal(decodePath(["artifacts", "100%.md"]), "artifacts/100%.md");
});

test("a numbered run said as its two ends is every file in it", () => {
  assert.deepEqual(
    pathsIn(
      "Slides: `artifacts/Insta/post/slide_1.png` ~ `slide_4.png` (all 1080×1350)",
    ),
    [1, 2, 3, 4].map((n) => `artifacts/Insta/post/slide_${n}.png`),
  );
  assert.deepEqual(
    pathsIn("artifacts/a/shot-08.png to artifacts/a/shot-10.png"),
    ["08", "09", "10"].map((n) => `artifacts/a/shot-${n}.png`),
  );
  // Two names that are not a run stay two names
  assert.deepEqual(pathsIn("artifacts/a/v1.png and artifacts/a/v9.png"), [
    "artifacts/a/v1.png",
    "artifacts/a/v9.png",
  ]);
});
