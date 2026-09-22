import assert from "node:assert/strict";
import test from "node:test";
import {
  ENGLISH_MODE_ALIASES,
  englishModeInstruction,
  isEnglishModeRequest,
} from "../features/ai/english-mode.ts";

test("each registered English-mode alias switches mode, including repeated speech", () => {
  for (const alias of ENGLISH_MODE_ALIASES) {
    assert.equal(isEnglishModeRequest(alias), true, alias);
    assert.equal(
      isEnglishModeRequest(`  ${alias}!! `),
      true,
      `${alias} with STT punctuation`,
    );
    assert.equal(
      isEnglishModeRequest(`${alias} ${alias}`),
      false,
      "a doubled transcript is not an exact alias",
    );
  }
});

test("English-mode aliases do not turn ordinary English questions into mode switches", () => {
  assert.equal(isEnglishModeRequest("영어로 이것 무슨 뜻이야?"), false);
  assert.equal(
    isEnglishModeRequest("Can we use English mode tomorrow?"),
    false,
  );
});

test("the shared prompt instruction contains every registered alias", () => {
  const instruction = englishModeInstruction();
  for (const alias of ENGLISH_MODE_ALIASES)
    assert.match(instruction, new RegExp(alias));
  assert.match(instruction, /even when it is repeated/);
});
