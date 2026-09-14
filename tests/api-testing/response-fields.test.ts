import test from "node:test";
import assert from "node:assert/strict";
import { responseFields } from "../../src/renderer/pages/api-testing/response-fields";

test("response selection resolves schemas and escapes field names with explicit array index", () => {
  const responses = { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Result" } } } } };
  const spec = { components: { schemas: { Result: { type: "object", properties: { "a/b~c": { type: "string" }, data: { type: "array", items: { type: "object", properties: { id: { type: "integer" } } } } } } } } };
  const fields = responseFields(responses, spec);
  assert.ok(fields.some(f => f.pointer === "/a~1b~0c"));
  assert.ok(fields.some(f => f.pointer === "/data/0/id" && f.type === "integer"));
  assert.deepEqual(responseFields(responses), []);
});
test("recursive response schemas are bounded", () => {
  const ref = { $ref: "#/components/schemas/Node" };
  const spec = { components: { schemas: { Node: { type: "object", properties: { next: ref } } } } };
  assert.ok(responseFields({ "200": { schema: ref } }, spec).length <= 13);
});
