import assert from "node:assert/strict";
import test from "node:test";
import { bindingUseLocations, pruneUnusedBrokenBindings, parseScenario, stringifyScenario } from "../../src/app/api-testing/shared/scenario";

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
  // Saved files keep the scenario id but never step ids; they are regenerated on read.
  assert.match(stringifyScenario(scenario, true), /^id: /m);
  assert.doesNotMatch(stringifyScenario(scenario, true), /^\s+-?\s*id:/m);
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
  // Readable internal name, never written to the file.
  assert.equal(scenario.valueBindings[0].name, "challengeToken_2");
});

test("reordering keeps links and renumbers {{steps.N}} when saved", () => {
  const scenario = parseScenario(`name: 순서\nserver: backend\nsteps:\n  - api: POST /login\n  - api: GET /a\n  - api: GET /b\n    query: { token: "{{steps.1.response.body./token}}" }\n`);
  const [login, a, b] = scenario.steps;
  scenario.steps = [a, login, b];
  assert.match(stringifyScenario(scenario), /token: "\{\{steps\.2\.response\.body\.\/token\}\}"/);
});

test("step inputs are written and read as {{inputs.name}}", () => {
  const yaml = `name: 인증\nserver: backend\nsteps:\n  - name: 인증번호 확인\n    api: POST /verify\n    inputs:\n      - name: code\n        label: 인증번호\n    body:\n      code: "{{inputs.code}}"\n`;
  const scenario = parseScenario(yaml);
  // The runner keeps step input values in vars.
  assert.deepEqual(scenario.steps[0].request.body, { code: "{{vars.code}}" });
  const exported = stringifyScenario(scenario);
  assert.match(exported, /code: "\{\{inputs\.code\}\}"/);
  assert.doesNotMatch(exported, /vars\./);
  assert.deepEqual(parseScenario(exported), scenario);
  // A scenario-level input with the same name stays a scenario-level input.
  const topLevel = parseScenario(`name: x\nserver: backend\ninputs: { code: { type: string } }\nsteps:\n  - api: POST /verify\n    body: { code: "{{inputs.code}}" }\n`);
  assert.deepEqual(topLevel.steps[0].request.body, { code: "{{inputs.code}}" });
});

test("ambiguous, invalid and unknown simple settings are rejected", () => {
  assert.throws(() => parseScenario(source.replace("POST /bos/login", "invalid")));
  assert.throws(() => parseScenario(source + "unknown: true\n"));
  assert.throws(() => parseScenario(`name: x\nserver: backend\nsteps:\n  - api: GET /x\n    body: 1\n    request:\n      body: 2\n`));
});
