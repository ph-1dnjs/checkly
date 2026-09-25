import test from "node:test";
import assert from "node:assert/strict";
import { scenarioSchema } from "../../src/app/api-testing/shared/scenario";
import { scenarioFlow } from "../../src/renderer/pages/api-testing/scenario-flow";

test("flow groups settings around endpoints without exposing values", () => {
  const scenario = scenarioSchema.parse({ version: 1, id: "variables", name: "variables", steps: [
    { id: "login", server: "api", api: { method: "POST", path: "/login" },
      inputs: [{ name: "code", type: "string", required: true, sensitive: true }],
      request: { headers: { Authorization: "{{globals.token}}" }, body: { code: "{{vars.code}}", secret: "never-display-secret" } },
      extract: [{ source: "body", pointer: "/token", target: "globals.token" }] },
  ] });
  const source = scenarioFlow(scenario);
  assert.ok(source.includes('s0["1. POST /login"]'));
  assert.ok(source.includes("사용자 입력"));
  assert.ok(source.includes("전역변수 token"));
  assert.ok(source.includes("req0 ~~~ s0"));
  assert.ok(source.includes("s0 ~~~ res0"));
  assert.ok(source.includes("class s0 POST"));
  assert.ok(source.includes('#34;code#34;#58; #34;사용자 입력#34;'));
  assert.ok(!source.includes("never-display-secret"));
});

test("flow preview uses indexed nodes and keeps nonadjacent endpoints in order", () => {
  const scenario = scenarioSchema.parse({ version: 1, id: "flow", name: "flow", steps: [
    { id: "a", name: 'API"] --> injected', server: "api", api: { method: "GET", path: "/items" }, extract: [{ source: "body", pointer: "/data/id", target: "vars.id" }] },
    { id: "b", name: "중간", server: "api", api: { method: "GET", path: "/items" } },
    { id: "c", name: "마지막", server: "api", api: { method: "POST", path: "/order" }, request: { body: { id: "{{vars.id}}" } } },
  ] });
  const source = scenarioFlow(scenario);
  assert.ok(source.includes("stage0 ==> stage1"));
  assert.ok(source.includes("stage1 ==> stage2"));
  assert.ok(source.includes("/data/id"));
  assert.ok(!source.includes("res0"));
  assert.ok(source.includes("req2 ~~~ s2"));
  assert.ok(!source.includes('API"] --> injected'));
});

test("flow resolves operation references to the HTTP method and path", () => {
  const scenario = scenarioSchema.parse({ version: 1, id: "operation-ref", name: "operation ref", steps: [
    { id: "customers", server: "api", api: { operationId: "getCustomers" } },
  ] });
  const source = scenarioFlow(scenario, step => "operationId" in step.api && step.api.operationId === "getCustomers"
    ? { method: "GET", path: "/bos/customers" }
    : undefined);
  assert.ok(source.includes('s0["1. GET /bos/customers"]'));
  assert.ok(!source.includes("getCustomers"));
});

test("flow includes request and response binding sources in grouped boxes", () => {
  const scenario = scenarioSchema.parse({ version: 1, id: "binding-flow", name: "binding flow", valueBindings: [
    { name: "seed", step: "first", source: "request", area: "query", pointer: "/seed" },
    { name: "token", step: "first", source: "response", area: "body", pointer: "/token" },
  ], steps: [
    { id: "first", name: "첫 단계", server: "api", api: { method: "GET", path: "/seed" }, request: { query: { seed: "demo" } } },
    { id: "second", name: "둘째 단계", server: "api", api: { method: "GET", path: "/consume" }, request: { query: { seed: "{{vars.seed}}" }, headers: { Authorization: "Bearer {{vars.token}}" } } },
  ] });
  const source = scenarioFlow(scenario);
  assert.ok(source.includes("stage0 ==> stage1"));
  assert.ok(source.includes("1단계 요청 Query /seed"));
  assert.ok(source.includes("1단계 응답 Body /token"));
  assert.ok(!source.includes("demo"));
  assert.ok(!source.includes("res0"));
});
