import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScenario, stringifyScenario, type Scenario } from "../../src/app/api-testing/shared/scenario";
import { apiReference, connectValue, linkVariableName, moveStep } from "../../src/renderer/features/api-testing/edit-scenario/model/scenario-builder-model";

const sample = () => parseScenario(`id: imported
name: AI 원본
description: 보존할 설명
environments: [dev]
onFailure: continue
steps:
  - { name: 첫 요청, server: member, api: GET /list, headers: { X-Custom: keep } }
  - { name: 중간 요청, server: member, api: GET /other }
  - { name: 마지막 요청, server: order, api: POST /orders, body: { count: 3 } }
`);
// Saving and reading back must not change what is saved.
const stable = (scenario: Scenario) => assert.equal(stringifyScenario(parseScenario(stringifyScenario(scenario, true)), true), stringifyScenario(scenario, true));

test("automatic links reuse source identity and survive duplicate endpoints and reordering", () => {
  const source = sample();
  source.steps[1].api = source.steps[0].api;
  const first = connectValue(source, 0, 2, "response", "body", "/data/id", undefined, "", "query", "id");
  const name = first.valueBindings[0].name;
  const reused = connectValue(first, 0, 1, "response", "body", "/data/id", undefined, "", "query", "id");
  assert.equal(reused.valueBindings.length, 1);
  assert.equal(reused.steps[1].request.query?.id, `{{vars.${name}}}`);
  const second = connectValue(reused, 1, 2, "response", "body", "/data/id", undefined, "", "query", "id");
  assert.equal(second.valueBindings.length, 2);
  assert.notEqual(second.valueBindings[1].name, name);
  assert.equal(second.steps[1].request.query?.id, `{{vars.${name}}}`);
  const moved = moveStep(second, 0, 2);
  assert.deepEqual(moved.valueBindings, second.valueBindings);
  assert.deepEqual(moved.steps.find(step => step.id === "post__orders")?.request, second.steps[2].request);
  assert.throws(() => connectValue(reused, 1, 2, "response", "body", "/other", undefined, name, "query", "id"), /이미/);
  const occupied = sample();
  occupied.steps[1].inputs = [{ name, type: "string", required: true, sensitive: true }];
  const unique = connectValue(occupied, 0, 2, "response", "body", "/data/id", undefined, "", "query", "id");
  assert.notEqual(unique.valueBindings[0].name, name);
  assert.match(stringifyScenario(unique, true), /id: "\{\{steps\.1\.response\.body\.\/data\/id\}\}"/);
  stable(unique);
});

test("builder reordering keeps step identities", () => {
  const source = sample();
  const ids = source.steps.map(s => s.id);
  assert.deepEqual(ids, ["get__list", "get__other", "post__orders"]);
  assert.deepEqual(moveStep(source, 2, -1).steps.map(s => s.id), [ids[0], ids[2], ids[1]]);
  assert.deepEqual(source.steps.map(s => s.id), ids);
  assert.equal(moveStep(source, 0, -1), source);
  assert.deepEqual(moveStep(source, 0, 2).steps.map(s => s.id), [ids[1], ids[2], ids[0]]);
  assert.deepEqual(moveStep(source, 2, -2).steps.map(s => s.id), [ids[2], ids[0], ids[1]]);
});

test("value links can point to any other step and keep request or response source metadata", () => {
  const source = sample();
  const linked = connectValue(source, 2, 0, "request", "body", "/count", undefined, "seed", "query", "seed");
  assert.equal(linked.steps[0].request.query?.seed, "{{vars.seed}}");
  assert.deepEqual(linked.valueBindings.at(-1), { name: "seed", step: "post__orders", source: "request", area: "body", pointer: "/count" });
  const response = connectValue(source, 0, 2, "response", "header", undefined, "X-Trace", "traceId", "headers", "X-Trace-Id");
  assert.equal(response.steps[2].request.headers?.["X-Trace-Id"], "{{vars.traceId}}");
  assert.deepEqual(response.valueBindings.at(-1), { name: "traceId", step: "get__list", source: "response", area: "header", header: "X-Trace" });
  assert.match(stringifyScenario(response), /X-Trace-Id: "\{\{steps\.1\.response\.header\.X-Trace\}\}"/);
  stable(response);
});

test("steps reference endpoints by method and path only", () => {
  const generated = parseScenario(`name: 자동 이름 없음\nserver: member\nsteps:\n  - api: GET /items\n`);
  assert.equal(generated.steps[0].name, undefined);
  assert.deepEqual(generated.steps[0].api, { method: "GET", path: "/items" });
  assert.deepEqual(apiReference({ method: "get", path: "/items" }), { method: "GET", path: "/items" });
});

test("linked values get readable default names from the source field", () => {
  assert.equal(linkVariableName("/data/challengeToken"), "challengeToken");
  assert.equal(linkVariableName("/data/content/0/member-id"), "member_id");
  assert.equal(linkVariableName("X-Request-Id"), "X_Request_Id");
  assert.equal(linkVariableName("/data/items/0"), "linkedValue");
  assert.equal(linkVariableName(""), "linkedValue");
  assert.equal(linkVariableName("/2fa"), "v_2fa");
  let scenario = sample();
  scenario.steps[1].inputs = [{ name: "token", type: "string", required: true, sensitive: true }];
  scenario = connectValue(scenario, 0, 2, "response", "body", "/data/token", undefined, "", "body", "a");
  scenario = connectValue(scenario, 0, 2, "response", "body", "/other/token", undefined, "", "body", "b");
  const body = scenario.steps[2].request.body as Record<string, string>;
  // "token" is taken by the step input, so numbering starts at _2.
  assert.deepEqual([body.a, body.b], ["{{vars.token_2}}", "{{vars.token_3}}"]);
  // The same source reuses its existing name.
  scenario = connectValue(scenario, 0, 2, "response", "body", "/data/token", undefined, "", "body", "c");
  assert.equal((scenario.steps[2].request.body as Record<string, string>).c, "{{vars.token_2}}");
});
