import assert from "node:assert/strict";
import test from "node:test";
import { bindingUseLocations, matchesScenarioInputType, pruneUnusedBrokenBindings, parseScenario, resolveDateTimeInput, resolveScenarioDateTimeInputs, stringifyScenario, ScenarioFormatError } from "../../src/app/api-testing/shared/scenario";

const source = `name: 로그인
server: backend
steps:
  - api: POST /bos/login
    body:
      loginId: "{{globals.loginId}}"
  - api: POST /bos/login
    body:
      token: "{{steps.1.response.body./data/challengeToken}}"
`;

test("only unused missing-source links are removed, consumers are identified and nothing internal is saved", () => {
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
  // A link whose source step is gone is saved as an empty value, never as {{vars.…}}.
  const saved = stringifyScenario(scenario, true);
  assert.match(saved, /id: ""/);
  assert.doesNotMatch(saved, /vars\.|valueBindings|unused/);
});

test("steps get distinct generated ids, the saved file has none and reads back identically", () => {
  const scenario = parseScenario(source);
  assert.deepEqual(scenario.steps.map(step => step.id), ["post__bos_login", "post__bos_login_2"]);
  assert.equal(scenario.steps[1].server, "backend");
  const saved = stringifyScenario(scenario, true);
  assert.match(saved, /^id: /m);
  assert.doesNotMatch(saved, /^\s+-?\s*id:/m);
  assert.deepEqual(parseScenario(saved), scenario);
});

test("scenario bearer authentication and step exceptions", () => {
  const scenario = parseScenario(`name: 혼합 인증\nserver: backend\nauth: globals.memberToken\nsteps:\n  - api: GET /members\n  - api: GET /admin\n    auth: globals.adminToken\n  - api: GET /public\n    auth: none\n`);
  assert.equal(scenario.auth, "globals.memberToken");
  assert.deepEqual(scenario.steps.map(step => step.auth), [undefined, "globals.adminToken", "none"]);
  assert.deepEqual(parseScenario(stringifyScenario(scenario)), scenario);
  assert.throws(() => parseScenario(`name: 잘못된 인증\nserver: backend\nauth: abc\nsteps:\n  - api: GET /x\n`));
});

test("earlier-step references cover request and response values and only look backwards", () => {
  const yaml = source.replace('token: "{{steps.1.response.body./data/challengeToken}}"', 'token: "{{steps.1.response.body./data/challengeToken}}"\n      login: "{{steps.1.request.body./loginId}}"\n      trace: "{{steps.1.response.header.X-Request-Id}}"');
  const scenario = parseScenario(yaml);
  assert.deepEqual(scenario.valueBindings.map(({ name, source: from, area }) => [name, from, area]), [["challengeToken", "response", "body"], ["loginId", "request", "body"], ["X_Request_Id", "response", "header"]]);
  const exported = stringifyScenario(scenario);
  for (const reference of ["{{steps.1.response.body./data/challengeToken}}", "{{steps.1.request.body./loginId}}", "{{steps.1.response.header.X-Request-Id}}"]) assert.ok(exported.includes(reference), reference);
  assert.deepEqual(parseScenario(exported), scenario);
  assert.throws(() => parseScenario(source.replace("steps.1.", "steps.2.")), /앞선 단계만/);
});

test("reordering keeps links and renumbers {{steps.N}} when saved", () => {
  const scenario = parseScenario(`name: 순서\nserver: backend\nsteps:\n  - api: POST /login\n  - api: GET /a\n  - api: GET /b\n    query: { token: "{{steps.1.response.body./token}}" }\n`);
  const [login, a, b] = scenario.steps;
  scenario.steps = [a, login, b];
  assert.match(stringifyScenario(scenario), /token: "\{\{steps\.2\.response\.body\.\/token\}\}"/);
});

test("step inputs are written and read as {{inputs.name}} and must be declared first", () => {
  const yaml = `name: 인증\nserver: backend\nsteps:\n  - name: 인증번호 확인\n    api: POST /verify\n    inputs:\n      - name: code\n        label: 인증번호\n    body:\n      code: "{{inputs.code}}"\n`;
  const scenario = parseScenario(yaml);
  // The runner keeps step input values in vars.
  assert.deepEqual(scenario.steps[0].request.body, { code: "{{vars.code}}" });
  const exported = stringifyScenario(scenario);
  assert.match(exported, /code: "\{\{inputs\.code\}\}"/);
  assert.doesNotMatch(exported, /vars\./);
  assert.deepEqual(parseScenario(exported), scenario);
  assert.throws(() => parseScenario(yaml.replace("{{inputs.code}}", "{{inputs.pin}}")), /inputs에 pin을 정의하세요/);
});

test("datetime inputs accept ISO timestamps and resolve now-relative expressions to UTC", () => {
  const now = new Date("2026-11-03T00:00:00.000Z");
  assert.equal(resolveDateTimeInput("now", now, "iso"), "2026-11-03T00:00:00.000Z");
  assert.equal(resolveDateTimeInput("now + 3d", now, "iso"), "2026-11-06T00:00:00.000Z");
  assert.equal(resolveDateTimeInput("now-2h", now, "iso"), "2026-11-02T22:00:00.000Z");
  assert.equal(resolveDateTimeInput("2026-11-03T09:00:00+09:00", now, "iso"), "2026-11-03T00:00:00.000Z");
  assert.equal(matchesScenarioInputType("2026-11-03T00:00:00.000Z", "datetime", "iso"), true);
  assert.equal(matchesScenarioInputType("now+3d", "datetime"), false);
  assert.throws(() => resolveDateTimeInput("tomorrow", now), /ISO 8601|now/);
  assert.throws(() => resolveDateTimeInput("now+2w", now), /ISO 8601|now/);
  const scenario = parseScenario(`name: 기간 조회\nserver: api\nsteps:\n  - name: 검색\n    api: GET /events\n    inputs: [{ name: startAt, label: 시작 시각, type: datetime, datetimeFormat: iso }]\n    query: { startAt: "{{inputs.startAt}}" }\n`);
  assert.equal(scenario.steps[0].inputs?.[0].type, "datetime");
  assert.match(stringifyScenario(scenario), /type: datetime/);
  assert.deepEqual(resolveScenarioDateTimeInputs(scenario, { startAt: "now+3d", ordinary: "now+3d" }, now), {
    startAt: "2026-11-06T00:00:00.000Z", ordinary: "now+3d",
  });
  assert.throws(() => resolveScenarioDateTimeInputs(scenario, { startAt: 3 }, now), /문자열로 전달/);
});

test("datetime inputs can resolve to zone-less local timestamps for LocalDateTime APIs", () => {
  const now = new Date("2026-11-03T06:48:42.694Z");
  const localNow = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
  assert.equal(resolveDateTimeInput("now", now), localNow);
  assert.equal(resolveDateTimeInput("now+3d", now, "local").endsWith("Z"), false);
  assert.equal(matchesScenarioInputType("2026-11-03T15:48:42.694", "datetime", "local"), true);
  assert.equal(matchesScenarioInputType("2026-11-03T15:48:42.694", "datetime"), true);
  assert.equal(matchesScenarioInputType("2026-11-03T06:48:42.694Z", "datetime", "local"), false);
  assert.equal(resolveDateTimeInput("now+3d", now).endsWith("Z"), false);
  const scenario = parseScenario(`name: 기간 조회\nserver: api\nsteps:\n  - api: GET /events\n    inputs: [{ name: startAt, type: datetime, datetimeFormat: local, default: now }]\n    query: { startAt: "{{inputs.startAt}}" }\n`);
  assert.equal(scenario.steps[0].inputs?.[0].datetimeFormat, "local");
  assert.match(stringifyScenario(scenario), /datetimeFormat: local/);
  const resolved = resolveScenarioDateTimeInputs(scenario, { startAt: "now" }, now).startAt;
  assert.equal(typeof resolved, "string");
  assert.equal((resolved as string).endsWith("Z"), false);
});

test("datetime input defaults persist now-relative expressions and reject defaults on other types", () => {
  const scenario = parseScenario(`name: 기간 조회\nserver: api\nsteps:\n  - api: GET /events\n    inputs: [{ name: startAt, type: datetime, default: now+3d }]\n    query: { startAt: "{{inputs.startAt}}" }\n`);
  assert.equal(scenario.steps[0].inputs?.[0].default, "now+3d");
  assert.match(stringifyScenario(scenario), /default: now\+3d/);
  assert.deepEqual(parseScenario(stringifyScenario(scenario)), scenario);
  assert.throws(() => parseScenario(`name: 잘못된 입력\nserver: api\nsteps:\n  - api: GET /events\n    inputs: [{ name: label, type: string, default: now }]\n`), /날짜·시간 입력에서만/);
  assert.throws(() => parseScenario(`name: 잘못된 시각\nserver: api\nsteps:\n  - api: GET /events\n    inputs: [{ name: startAt, type: datetime, default: tomorrow }]\n`), /ISO 8601 또는 now/);
  assert.throws(() => parseScenario(`name: 고정 기본값\nserver: api\nsteps:\n  - api: GET /events\n    inputs: [{ name: startAt, type: datetime, default: "2026-11-03T00:00:00.000Z" }]\n`), /ISO 8601 또는 now/);
});

test("retired syntaxes are rejected with the way to write them now", () => {
  const cases: Array<[string, RegExp]> = [
    [`version: 1\n${source}`, /version은 쓰지 않습니다/],
    [source.replace("server: backend\n", "server: backend\nvars: { a: 1 }\n"), /vars는 쓰지 않습니다/],
    [source.replace("server: backend\n", "server: backend\ninputs: { code: { type: string } }\n"), /단계의 inputs에 쓰고/],
    [source.replace("server: backend\n", "server: backend\nvalueBindings: []\n"), /\{\{steps\.N\.response/],
    [source.replace("  - api: POST /bos/login\n    body:\n      loginId", "  - id: login\n    api: POST /bos/login\n    body:\n      loginId"), /1단계: 단계 id는 쓰지 않습니다/],
    [`name: x\nserver: backend\nsteps:\n  - api: GET /x\n    request:\n      body: 2\n`, /request: 없이/],
    [`name: x\nserver: backend\nsteps:\n  - api: GET /x\n    input: { name: code }\n`, /input 대신 inputs/],
    [`name: x\nserver: backend\nsteps:\n  - api: { method: GET, path: /x }\n`, /api는 'POST \/bos\/login' 형식의 문자열/],
    [source.replace("{{steps.1.response.body./data/challengeToken}}", "{{vars.challengeToken}}"), /\{\{vars\.challengeToken\}\}는 쓰지 않습니다/],
    [`name: x\nsteps:\n  - api: GET /x\n`, /server를 시나리오 또는 단계에 쓰세요/],
  ];
  for (const [yaml, message] of cases) {
    assert.throws(() => parseScenario(yaml), (error: Error) => error instanceof ScenarioFormatError && message.test(error.message), String(message));
  }
  assert.throws(() => parseScenario(source.replace("POST /bos/login", "invalid")), /api는 'POST \/bos\/login' 형식으로/);
  assert.throws(() => parseScenario(source + "unknown: true\n"));
});
