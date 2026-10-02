import { test } from "node:test";
import assert from "node:assert/strict";
import { requestValueFields, requestValueText } from "../../src/renderer/features/api-testing/edit-scenario/model/value-link-model";

test("request values show what they are, not their type", () => {
  const inputs = new Set(["productName"]);
  assert.equal(requestValueText("관리자 상품", inputs), '"관리자 상품"');
  assert.equal(requestValueText(20000, inputs), "20000");
  assert.equal(requestValueText(null, inputs), "null");
  assert.equal(requestValueText("{{inputs.code}}", inputs), "실행 중 입력");
  // Runtime inputs are stored as vars; the step's input names tell them apart from links.
  assert.equal(requestValueText("{{vars.productName}}", inputs), "실행 중 입력");
  assert.equal(requestValueText("{{vars.itemId}}", inputs), "값 연결");
  assert.equal(requestValueText("{{globals.accessToken}}", inputs), "전역변수 accessToken");
  // A reference inside other text is shown as written.
  assert.equal(requestValueText("Bearer {{globals.accessToken}}", inputs), '"Bearer {{globals.accessToken}}"');
});

test("only inputs, globals and links are dynamic, so only they can be an expected value", () => {
  const request = { body: { name: "{{vars.productName}}", price: 20000, tags: ["{{globals.tag}}"], owner: { id: "{{vars.ownerId}}", note: "fixed" }, "a/b": true } };
  const options = requestValueFields(request, "body", new Set(["productName"]));
  assert.deepEqual(options.map(({ pointer, type, label, dynamic }) => ({ pointer, type, label, dynamic })), [
    { pointer: "", type: "object", label: undefined, dynamic: undefined },
    { pointer: "/name", type: "string", label: "실행 중 입력", dynamic: true },
    { pointer: "/price", type: "number", label: "20000", dynamic: false },
    { pointer: "/tags", type: "array", label: undefined, dynamic: undefined },
    { pointer: "/tags/0", type: "string", label: "전역변수 tag", dynamic: true },
    { pointer: "/owner", type: "object", label: undefined, dynamic: undefined },
    { pointer: "/owner/id", type: "string", label: "값 연결", dynamic: true },
    { pointer: "/owner/note", type: "string", label: '"fixed"', dynamic: false },
    // Keys with "/" are escaped as JSON Pointer.
    { pointer: "/a~1b", type: "boolean", label: "true", dynamic: false },
  ]);
  assert.deepEqual(requestValueFields(request, "query"), []);
  assert.deepEqual(requestValueFields({ query: { q: "{{inputs.q}}" } }, "query").map(option => option.dynamic), [undefined, true]);
});
