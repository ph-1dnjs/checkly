import test from "node:test";
import assert from "node:assert/strict";
import { responseFields } from "../../src/renderer/pages/api-testing/response-fields";

test("response selection shows one DTO array item with first-item pointers", () => {
  const responses = { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Result" } } } } };
  const spec = { components: { schemas: { Result: { type: "object", properties: { "a/b~c": { type: "string" }, data: { type: "array", items: { type: "object", properties: { id: { type: "integer" } } } } } } } } };
  const fields = responseFields(responses, spec);
  assert.ok(fields.some(f => f.pointer === "/a~1b~0c"));
  assert.ok(fields.some(f => f.pointer === "/data" && f.type === "array"));
  assert.ok(fields.some(f => f.pointer === "/data/0/id" && f.type === "integer"));
  assert.ok(!fields.some(f => f.pointer.startsWith("/data/1")));
  assert.deepEqual(responseFields(responses), []);
});
test("recursive response schemas are bounded", () => {
  const ref = { $ref: "#/components/schemas/Node" };
  const spec = { components: { schemas: { Node: { type: "object", properties: { next: ref } } } } };
  assert.ok(responseFields({ "200": { schema: ref } }, spec).length <= 13);
});
test("response field cache reuses unchanged schemas and separates spec revisions", () => {
  const responses = { "200": { schema: { $ref: "#/components/schemas/Result" } } };
  const first = { components: { schemas: { Result: { type: "string" } } } };
  const second = { components: { schemas: { Result: { type: "object", properties: { id: { type: "integer" } } } } } };
  assert.equal(responseFields(responses, first), responseFields(responses, first));
  assert.notEqual(responseFields(responses, first), responseFields(responses, second));
  assert.ok(responseFields(responses, second).some(field => field.pointer === "/id"));
});
