import assert from "node:assert/strict";
import test from "node:test";
import { bindingUseLocations, pruneUnusedBrokenBindings, parseScenario, resetStepConnections, stringifyScenario } from "../../src/app/api-testing/shared/scenario";

const source = `name: 로그인
server: backend
inputs:
  code:
    type: string
steps:
  - api: POST /bos/login
    body:
      loginId: "{{globals.loginId}}"
    extract:
      challengeToken: /data/challengeToken
  - api: POST /bos/login
    body:
      token: "{{vars.challengeToken}}"
`;

test("only unused missing-source bindings are removed and consumers are identified", () => {
  const scenario = parseScenario(source);
  scenario.valueBindings = [
    { name: "unused", step: "deleted", source: "response", area: "body", pointer: "/data", sensitive: false },
    { name: "needed", step: "deleted", source: "response", area: "body", pointer: "/data/id", sensitive: false },
    { name: "valid", step: scenario.steps[0].id, source: "response", area: "body", pointer: "/data", sensitive: false },
  ];
  scenario.steps[1].request.body = { nested: { id: "{{vars.needed}}" } };
  assert.deepEqual(bindingUseLocations(scenario, "needed"), ["2단계 요청.body.nested.id"]);
  const cleaned = pruneUnusedBrokenBindings(scenario);
  assert.deepEqual(cleaned.valueBindings.map(b => b.name), ["needed", "valid"]);
  assert.equal(scenario.valueBindings.length, 3);
  assert.deepEqual(cleaned.steps, scenario.steps);
  assert.doesNotMatch(stringifyScenario(scenario, true), /name: unused/);
});

test("operationId preview resolves endpoints without changing stored references", () => {
  const scenario = parseScenario(source);
  scenario.steps[0].api = { operationId: "bosLogin" };
  scenario.steps[1].api = { operationId: "unavailable" };
  const exported = stringifyScenario(scenario, false, step => "operationId" in step.api && step.api.operationId === "bosLogin" ? { method: "post", path: "/bos/login" } : undefined);
  assert.match(exported, /api: POST \/bos\/login/);
  assert.doesNotMatch(exported, /operationId: bosLogin/);
  assert.match(exported, /operationId: unavailable/);
  assert.deepEqual(scenario.steps[0].api, { operationId: "bosLogin" });
  assert.deepEqual(parseScenario(exported).steps[0].api, { method: "POST", path: "/bos/login" });
});

test("simple YAML expands defaults, duplicate endpoints and extraction", () => {
  const scenario = parseScenario(source);
  assert.equal(scenario.version, 1);
  assert.notEqual(scenario.steps[0].id, scenario.steps[1].id);
  assert.equal(scenario.steps[1].server, "backend");
  assert.equal(scenario.steps[0].extract[0].target, "vars.challengeToken");
  assert.equal(scenario.steps[0].extract[0].pointer, "/data/challengeToken");
  assert.deepEqual(parseScenario(stringifyScenario(scenario, true)), scenario);
  const ids = scenario.steps.map(s => s.id);
  scenario.steps.reverse();
  assert.deepEqual(parseScenario(stringifyScenario(scenario, true)).steps.map(s => s.id), ids.reverse());
});

test("simple YAML preserves scenario bearer authentication and step exceptions", () => {
  const scenario = parseScenario(`name: 혼합 인증\nserver: backend\nauth: globals.memberToken\nsteps:\n  - api: GET /members\n  - api: GET /admin\n    auth: globals.adminToken\n  - api: GET /public\n    auth: none\n`);
  assert.equal(scenario.auth, "globals.memberToken");
  assert.deepEqual(scenario.steps.map(step => step.auth), [undefined, "globals.adminToken", "none"]);
  assert.deepEqual(parseScenario(stringifyScenario(scenario)), scenario);
  assert.throws(() => parseScenario(`name: 잘못된 인증\nserver: backend\nauth: abc\nsteps:\n  - api: GET /x\n`));
});

test("simple export omits unneeded identities and preserves advanced binding sources", () => {
  const scenario = parseScenario(source);
  assert.doesNotMatch(stringifyScenario(scenario), /^\s*id:/m);
  scenario.valueBindings.push({ name: "requestLogin", step: scenario.steps[0].id, source: "request", area: "body", pointer: "/loginId", sensitive: true });
  scenario.steps[1].request.body = { login: "{{vars.requestLogin}}" };
  const restored = parseScenario(stringifyScenario(scenario));
  assert.equal(restored.valueBindings[0].step, restored.steps[0].id);
  assert.equal(restored.valueBindings[0].sensitive, true);
});

test("numbered references round trip without ids and reject future sources", () => {
  const yaml = source.replace("{{vars.challengeToken}}", "{{steps.1.response.body./data/challengeToken}}");
  const scenario = parseScenario(yaml);
  assert.equal(scenario.valueBindings.length, 1);
  const exported = stringifyScenario(scenario);
  assert.match(exported, /steps\.1\.response\.body\.\/data\/challengeToken/);
  assert.doesNotMatch(exported, /valueBindings:|\s+id:/);
  assert.equal(parseScenario(exported).valueBindings[0].pointer, "/data/challengeToken");
  assert.throws(() => parseScenario(yaml.replace("steps.1.", "steps.2.")), /앞선 단계/);
  const cleared = resetStepConnections(scenario);
  assert.equal(cleared.valueBindings.length, 0);
  assert.deepEqual(cleared.steps[1].request.body, { token: "" });
  assert.deepEqual(cleared.steps[0].request.body, { loginId: "{{globals.loginId}}" });
  assert.deepEqual(cleared.steps[0].extract, scenario.steps[0].extract);
});

test("ambiguous, invalid and unknown simple settings are rejected", () => {
  assert.throws(() => parseScenario(source.replace("POST /bos/login", "invalid")));
  assert.throws(() => parseScenario(source + "unknown: true\n"));
  assert.throws(() => parseScenario(`name: x\nserver: backend\nsteps:\n  - api: GET /x\n    body: 1\n    request:\n      body: 2\n`));
});
