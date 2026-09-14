import { test } from "node:test";
import assert from "node:assert/strict";
import type { ApiCatalog, ApiOperation } from "../../src/app/api-testing/shared/workspace";
import { groupDocumentation } from "../../src/renderer/pages/api-testing/documentation-order";

const operation = (tag: string, path = "/items", method = "GET"): ApiOperation => ({
  tag, path, method, key: `${method} ${path}`, summary: path, description: "",
  parameters: [], bodyRequired: false, responses: {}, warnings: [],
});
const catalog = (operations: ApiOperation[], tags?: string[]): ApiCatalog => ({
  title: "정렬", version: "1", importedAt: "", operations,
  tags: tags?.map(name => ({ name, description: "" })),
});

test("declared tags keep order; undeclared tags sort by name, including legacy catalogs", () => {
  const data = catalog([operation("다"), operation("나"), operation("가"), operation("라")], ["라", "나", "라", "빈 태그"]);
  assert.deepEqual(groupDocumentation(data).ordered, ["라", "나", "가", "다"]);
  assert.deepEqual(groupDocumentation({ ...data, tags: undefined }).ordered, ["가", "나", "다", "라"]);
});

test("paths then all methods sort without mutating source data", () => {
  const methods = ["OPTIONS", "DELETE", "PATCH", "HEAD", "PUT", "POST", "GET"];
  const data = catalog([operation("API", "/z"), ...methods.map(method => operation("API", "/a", method))]);
  const before = JSON.stringify(data);
  Object.freeze(data.operations);
  const result = groupDocumentation(data).groups.get("API")!;
  assert.deepEqual(result.map(o => o.key), ["GET /a", "POST /a", "PUT /a", "PATCH /a", "DELETE /a", "HEAD /a", "OPTIONS /a", "GET /z"]);
  assert.equal(JSON.stringify(data), before);
});

test("multiple tags deduplicate, missing tags fall back, filtering keeps order", () => {
  const shared = { ...operation("나", "/z"), tags: ["나", "가", "가"] };
  const data = catalog([shared, operation("가", "/a"), operation("", "/other")]);
  assert.equal(groupDocumentation(data).groups.get("가")!.length, 2);
  assert.ok(groupDocumentation(data).groups.has("기타"));
  assert.deepEqual(groupDocumentation(data, "/z").ordered, ["가", "나"]);
  assert.deepEqual(groupDocumentation(data, "missing").ordered, []);
});
