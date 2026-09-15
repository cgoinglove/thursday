import assert from "node:assert/strict";
import { test } from "node:test";
import { decodePagePath, decodePath, queryKey } from "../app/api/query-key.ts";

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
