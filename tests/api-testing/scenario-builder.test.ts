import { test } from "node:test";
import assert from "node:assert/strict";
import { stringify } from "yaml";
import { normalizeScenarioForStorage, parseScenario } from "../../src/app/api-testing/shared/scenario";
import { apiReference, connectResponse, connectValue, moveStep } from "../../src/renderer/pages/api-testing/scenario-builder-model";

const sample = () => parseScenario(`version: 1
id: imported
name: AI 원본
description: 보존할 설명
environments: [dev]
onFailure: continue
inputs: { password: { type: string, required: true, sensitive: true } }
vars: { count: 3 }
steps:
  - { id: first, name: 첫 요청, server: member, api: { operationId: list }, request: { headers: { X-Custom: keep } } }
  - { id: middle, name: 중간 요청, server: member, api: { method: GET, path: /other } }
  - { id: last, name: 마지막 요청, server: order, api: { method: POST, path: /orders }, request: { body: { count: 3 } } }
`);

test("visual response binding generates non-adjacent typed reference and preserves AI fields", () => {
  const source = sample(), before = stringify(source);
  const linked = connectResponse(source, 0, 2, "/data/id", "itemId", "body", "id");
  assert.equal(stringify(source), before);
  assert.deepEqual(linked.steps[0].extract, [{source:"body",pointer:"/data/id",target:"vars.itemId",sensitive:false}]);
  assert.deepEqual(linked.steps[2].request.body, { count:3,id:"{{vars.itemId}}" });
  assert.deepEqual(parseScenario(stringify(linked)), linked);
  assert.deepEqual(linked.inputs, source.inputs);
  assert.deepEqual(linked.environments, source.environments);
  assert.deepEqual(linked.steps[0].api, {operationId:"list"});
  assert.equal(linked.onFailure,"continue");
});

test("builder reordering keeps IDs and rejects invalid response bindings", () => {
  const source = sample();
  assert.deepEqual(moveStep(source,2,-1).steps.map(s=>s.id),["first","last","middle"]);
  assert.deepEqual(source.steps.map(s=>s.id),["first","middle","last"]);
  assert.equal(moveStep(source,0,-1),source);
  assert.deepEqual(moveStep(source, 0, 2).steps.map(s => s.id), ["middle", "last", "first"]);
  assert.deepEqual(moveStep(source, 2, -2).steps.map(s => s.id), ["last", "first", "middle"]);
  assert.throws(()=>connectResponse(source,2,0,"/id","id","query","id"),/앞선/);
  assert.throws(()=>connectResponse(source,0,2,"data.id","id","query","id"),/Pointer/);
  assert.throws(()=>connectResponse(source,0,2,"/id","count","query","id"),/이미/);
  const linked=connectResponse(source,0,2,"/token","token","headers","Authorization","Bearer ");
  assert.equal(linked.steps[2].request.headers?.Authorization,"Bearer {{vars.token}}");
  assert.throws(()=>connectResponse(linked,0,2,"/id","token","query","id"),/이미/);
});

test("value bindings can point to any other step and keep request or response source metadata", () => {
  const source = sample();
  const linked = connectValue(source, 2, 0, "request", "body", "/count", undefined, "seed", "query", "seed");
  assert.equal(linked.steps[0].request.query?.seed, "{{vars.seed}}");
  assert.deepEqual(linked.valueBindings.at(-1), {
    name: "seed", step: "last", source: "request", area: "body", pointer: "/count", sensitive: false,
  });
  const response = connectValue(source, 0, 2, "response", "header", undefined, "X-Trace", "traceId", "headers", "X-Trace-Id");
  assert.equal(response.steps[2].request.headers?.["X-Trace-Id"], "{{vars.traceId}}");
  assert.deepEqual(response.valueBindings.at(-1), {
    name: "traceId", step: "first", source: "response", area: "header", header: "X-Trace", sensitive: true,
  });
  assert.deepEqual(parseScenario(stringify(linked)), linked);
});

test("visual scenario storage keeps OpenAPI metadata in the catalog", () => {
  const source = parseScenario(`version: 1
id: metadata
name: 메타데이터 분리
steps:
  - id: read
    name: 상품 조회 단계
    description: OpenAPI에서 다시 읽을 엔드포인트 설명
    server: member
    api: { method: GET, path: /items }
`);
  const stored = normalizeScenarioForStorage(source);
  assert.equal(stored.steps[0].description, undefined);
  const generated = parseScenario(`version: 1
id: generated
name: 자동 이름 없음
steps:
  - id: read
    server: member
    api: { operationId: listItems }
`);
  assert.equal(generated.steps[0].name, undefined);
  assert.deepEqual(apiReference({ operationId: "listItems", method: "GET", path: "/items" }), { operationId: "listItems" });
  assert.deepEqual(apiReference({ method: "GET", path: "/items" }), { method: "GET", path: "/items" });
});
