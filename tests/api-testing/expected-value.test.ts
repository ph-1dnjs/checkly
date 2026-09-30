import test from "node:test";
import assert from "node:assert/strict";
import { expectedValueText, parseExpectedValue } from "../../src/renderer/features/api-testing/edit-scenario/model/step-request-model";

test("expected values are typed as plain text and round-trip without changing type", () => {
  assert.equal(parseExpectedValue("success"), "success");
  assert.equal(parseExpectedValue("200"), 200);
  assert.equal(parseExpectedValue("true"), true);
  assert.deepEqual(parseExpectedValue('{"a":1}'), { a: 1 });
  assert.equal(parseExpectedValue('"200"'), "200");
  for (const value of ["success", "200", "true", 200, true, null, { a: 1 }, [1], '"quoted"']) {
    assert.deepEqual(parseExpectedValue(expectedValueText(value)), value);
  }
  assert.equal(expectedValueText("success"), "success");
  assert.equal(expectedValueText("200"), '"200"');
});
