import test from "node:test";
import assert from "node:assert/strict";
import { scenarioSchema } from "../../src/app/api-testing/shared/scenario";
import { scenarioFlow } from "../../src/renderer/pages/api-testing/scenario-flow";

test("flow preview uses indexed nodes and shows nonadjacent response dependencies", () => {
  const scenario = scenarioSchema.parse({ version: 1, id: "flow", name: "flow", steps: [
    { id: "a", name: 'API"] --> injected', server: "api", api: { method: "GET", path: "/items" }, extract: [{ source: "body", pointer: "/data/id", target: "vars.id" }] },
    { id: "b", name: "중간", server: "api", api: { method: "GET", path: "/items" } },
    { id: "c", name: "마지막", server: "api", api: { method: "POST", path: "/order" }, request: { body: { id: "{{vars.id}}" } } },
  ] });
  const source = scenarioFlow(scenario);
  assert.ok(source.includes("s0 --> s1"));
  assert.ok(source.includes('s0 -. "/data/id" .-> s2'));
  assert.ok(!source.includes('API"] --> injected'));
});

test("flow preview shows request and response value binding edges", () => {
  const scenario = scenarioSchema.parse({ version: 1, id: "binding-flow", name: "binding flow", valueBindings: [
    { name: "seed", step: "first", source: "request", area: "query", pointer: "/seed" },
    { name: "token", step: "first", source: "response", area: "body", pointer: "/token" },
  ], steps: [
    { id: "first", name: "첫 단계", server: "api", api: { method: "GET", path: "/seed" }, request: { query: { seed: "demo" } } },
    { id: "second", name: "둘째 단계", server: "api", api: { method: "GET", path: "/consume" }, request: { query: { seed: "{{vars.seed}}" }, headers: { Authorization: "Bearer {{vars.token}}" } } },
  ] });
  const source = scenarioFlow(scenario);
  assert.ok(source.includes('s0 -. "request #183; /seed" .-> s1'));
  assert.ok(source.includes('s0 -. "response #183; /token" .-> s1'));
});
