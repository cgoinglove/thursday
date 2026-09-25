import assert from "node:assert/strict";
import { test } from "node:test";
import { decodePagePath, decodePath, queryKey } from "../app/api/query-key.ts";
import {
  leadFirst,
  opensOnFinish,
  pathsIn,
} from "../features/workspace/file-kind.ts";

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

test("a finished job's page leads its files, and the rest keep their order", () => {
  assert.deepEqual(
    leadFirst([
      "artifacts/Mail/rows.json",
      "artifacts/Mail/chart.png",
      "artifacts/Mail/summary.md",
      "artifacts/Mail/notes.md",
    ]),
    [
      "artifacts/Mail/summary.md",
      "artifacts/Mail/rows.json",
      "artifacts/Mail/chart.png",
      "artifacts/Mail/notes.md",
    ],
  );
  const pageFirst = ["artifacts/Mail/summary.md", "artifacts/Mail/rows.json"];
  assert.deepEqual(leadFirst(pageFirst), pageFirst);
  const noPage = ["artifacts/Mail/rows.json", "bots/Mail/memory/inbox.md"];
  assert.deepEqual(leadFirst(noPage), noPage);
  assert.deepEqual(leadFirst([]), []);
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

test("two names are two files, whatever stands between them", () => {
  assert.deepEqual(
    pathsIn(
      "Slides: `artifacts/Insta/post/slide_1.png` ~ `slide_4.png` (all 1080×1350)",
    ),
    ["artifacts/Insta/post/slide_1.png", "artifacts/Insta/post/slide_4.png"],
  );
  // A rename and a list of picks name two files, not the drafts numbered between them
  assert.deepEqual(pathsIn("Renamed artifacts/a/shot-2.png to shot-9.png"), [
    "artifacts/a/shot-2.png",
    "artifacts/a/shot-9.png",
  ]);
  assert.deepEqual(
    pathsIn("Picked the two best:\n- artifacts/a/v1.png\n- artifacts/a/v5.png"),
    ["artifacts/a/v1.png", "artifacts/a/v5.png"],
  );
});
