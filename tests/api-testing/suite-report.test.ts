import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { producedGlobalNames, renderSuiteReport, reportScenario, usesInvalidatedGlobal } from "../../src/app/api-testing/shared/suite-report";
import { parseScenario } from "../../src/app/api-testing/shared/scenario";

test("a failed producer invalidates stale globals used by later scenarios", () => {
  const producer = parseScenario(`id: login\nname: 로그인\nserver: main\nsteps:\n  - api: POST /login\n    extract:\n      - { source: body, pointer: /token, target: globals.accessToken }\n`);
  const consumer = parseScenario(`id: data\nname: 조회\nauth: globals.accessToken\nserver: main\nsteps:\n  - api: GET /data\n`);
  const names = new Set(producedGlobalNames(producer));
  assert.deepEqual([...names], ["accessToken"]);
  assert.equal(usesInvalidatedGlobal(consumer, names), true);
  assert.equal(usesInvalidatedGlobal(consumer, new Set()), false);
});

test("HTML report escapes labels and excludes raw credentials, request and response", () => {
  const secret = "sensitive-token-123";
  const result = { status: "failed", variables: { accessToken: secret }, steps: [{ id: "read", name: "조회", status: "failed", durationMs: 14, httpStatus: 401, request: { method: "GET", url: `https://example.test/?token=${secret}`, headers: { Authorization: `Bearer ${secret}` } }, headers: { "set-cookie": secret }, body: { token: secret }, error: secret, failure: { kind: "assertion" as const, source: "status" as const, operator: "equals" as const } }] };
  const row = reportScenario("read", "<script>alert(1)</script>", result, [{ name: "조회", reference: "GET /read" }], 15);
  const html = renderSuiteReport({ suiteName: "<b>묶음</b>", projectName: "프로젝트", environmentName: "dev", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.015Z", status: "failed", scenarios: [row] });
  assert.match(html, /&lt;b&gt;묶음&lt;\/b&gt;/);
  assert.match(html, /HTTP 상태 일치 검증 실패/);
  assert.doesNotMatch(html, /sensitive-token-123|Authorization|set-cookie|<script>/);
  assert.match(html, /<!doctype html>/);
});

test("HTML report summarizes failures, skipped runs and repeated scenarios without exposing values", () => {
  const source = parseScenario(`id: lookup\nname: 조회\nserver: main\nsteps:\n  - api: GET /lookup\n    expect:\n      - { source: status, operator: equals, value: 200 }\n    extract:\n      - { source: body, pointer: /token, target: globals.accessToken, sensitive: true }\n`);
  const result = { status: "failed", variables: { accessToken: "private-token" }, steps: [{ id: "get__lookup", name: "조회", status: "failed", durationMs: 21, httpStatus: 500, body: { token: "private-token" }, failure: { kind: "assertion" as const, source: "status" as const, operator: "equals" as const } }] };
  const row = reportScenario("lookup", "조회", result, [{ name: "조회", reference: "GET /lookup" }], 24, source);
  const html = renderSuiteReport({ suiteName: "반복 점검", projectName: "프로젝트", environmentName: "dev", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:01Z", status: "failed", scenarios: [row, { ...row, durationMs: 35 }, { id: "later", name: "다음 조회", status: "skipped", durationMs: 0, steps: [], reason: "앞 시나리오가 통과하지 않아 호출하지 않았습니다." }] });
  assert.match(html, /확인이 필요한 항목/);
  assert.match(html, /href="#scenario-2"/);
  assert.match(html, /2회차 · 첫 실행 대비 \+11ms/);
  assert.match(html, /검증 1개 · 값 저장 1개 설정/);
  assert.match(html, /건너뜀/);
  assert.match(html, /HTTP 상태 일치 검증 실패/);
  assert.doesNotMatch(html, /private-token|"token"|accessToken/);
});

test("HTML report lists each check with pass/fail in words, never the actual response value", () => {
  const source = parseScenario(`id: lookup\nname: 조회\nserver: main\nsteps:\n  - api: GET /lookup\n    expect:\n      - { source: body, pointer: /data, operator: exists }\n      - { source: body, pointer: /state, operator: equals, value: ACTIVE }\n`);
  const result = { status: "failed", variables: {}, steps: [{ id: source.steps[0].id, name: "조회", status: "failed", durationMs: 21, httpStatus: 200, checks: [{ passed: true }, { expect: 0, passed: true }, { expect: 1, passed: false, actual: '"secret-state"' }], failure: { kind: "assertion" as const, source: "body" as const, operator: "equals" as const } }] };
  const row = reportScenario("lookup", "조회", result, [{ name: "조회", reference: "GET /lookup" }], 24, source);
  assert.deepEqual(row.steps[0].checkResults, [
    { label: "HTTP 상태 2xx (자동 확인)", passed: true },
    { label: "/data 존재하는지", passed: true },
    { label: "/state 기대값과 같은지 ACTIVE", passed: false },
  ]);
  const html = renderSuiteReport({ suiteName: "검증", projectName: "프로젝트", environmentName: "dev", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:01Z", status: "failed", scenarios: [row] });
  assert.match(html, /✗ \/state 기대값과 같은지 ACTIVE/);
  assert.doesNotMatch(html, /secret-state/);
});

test("suite persistence validates order, revision and referenced scenarios", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "checkly-suite-"));
  try {
    const workspace = new ApiWorkspace(directory);
    const serverId = randomUUID(), environmentId = randomUUID(), projectId = randomUUID();
    await workspace.saveProject({ id: projectId, name: "프로젝트", servers: [{ id: serverId, name: "main" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "http://127.0.0.1:1234" } }] });
    await workspace.importSpec({ projectId, serverId, environmentId }, JSON.stringify({ openapi: "3.0.3", info: { title: "API", version: "1" }, paths: { "/health": { get: { responses: { "200": { description: "ok" } } } } } }));
    const source = `id: health\nname: 상태 조회\nserver: main\nsteps:\n  - api: GET /health\n`;
    await workspace.saveScenario({ projectId, environmentId }, source, {});
    const suite = await workspace.saveSuite(projectId, { id: randomUUID(), name: "기본 점검", scenarioIds: ["health"], onFailure: "stop" });
    assert.deepEqual(await new ApiWorkspace(directory).listSuites(projectId), [suite]);
    const repeated = await workspace.saveSuite(projectId, { id: suite.id, name: suite.name, scenarioIds: ["health", "health"], onFailure: "stop" }, suite.updatedAt);
    assert.deepEqual((await new ApiWorkspace(directory).listSuites(projectId))[0].scenarioIds, ["health", "health"]);
    await assert.rejects(workspace.saveSuite(projectId, { id: randomUUID(), name: "잘못된 묶음", scenarioIds: ["missing"], onFailure: "stop" }), /실행 가능/);
    const revised = await workspace.saveSuite(projectId, { id: suite.id, name: "기본 점검 수정", scenarioIds: ["health", "health"], onFailure: "continue" }, repeated.updatedAt);
    assert.notEqual(revised.updatedAt, repeated.updatedAt);
    await assert.rejects(workspace.saveSuite(projectId, { id: suite.id, name: "충돌", scenarioIds: ["health"], onFailure: "stop" }, repeated.updatedAt), /변경/);
    await assert.rejects(workspace.deleteSuite(projectId, suite.id, "stale"), /변경/);
    await workspace.deleteSuite(projectId, suite.id, revised.updatedAt);
    assert.deepEqual(await workspace.listSuites(projectId), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("ordered scenarios reuse a token produced by the previous scenario without exporting it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "checkly-suite-run-"));
  const secret = "private-suite-token";
  let dataCalls = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/login") response.end(JSON.stringify({ token: secret }));
    else { dataCalls += 1; response.statusCode = request.headers.authorization === `Bearer ${secret}` ? 200 : 401; response.end(JSON.stringify({ ok: response.statusCode === 200 })); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const workspace = new ApiWorkspace(directory);
    const serverId = randomUUID(), environmentId = randomUUID(), projectId = randomUUID();
    const scope = { projectId, environmentId };
    await workspace.saveProject({ id: projectId, name: "점검", servers: [{ id: serverId, name: "main" }], environments: [{ id: environmentId, name: "local", baseUrls: { [serverId]: `http://127.0.0.1:${(server.address() as { port: number }).port}` } }] });
    await workspace.importSpec({ ...scope, serverId }, JSON.stringify({ openapi: "3.0.3", info: { title: "API", version: "1" }, paths: { "/login": { post: { responses: { "200": { description: "ok" } } }, }, "/data": { get: { responses: { "200": { description: "ok" } } } } } }));
    const login = `id: login\nname: 로그인\nserver: main\nsteps:\n  - api: POST /login\n    extract:\n      - { source: body, pointer: /token, target: globals.accessToken, sensitive: true }\n`;
    const data = `id: data\nname: 조회\nauth: globals.accessToken\nserver: main\nsteps:\n  - api: GET /data\n`;
    await workspace.saveScenario(scope, login, {});
    await workspace.saveScenario(scope, data, {});
    const first = await workspace.runScenario(scope, login, {}, {});
    const second = await workspace.runScenario(scope, data, {}, {});
    const third = await workspace.runScenario(scope, data, {}, {});
    assert.equal(first.status, "passed"); assert.equal(second.status, "passed"); assert.equal(third.status, "passed");
    assert.equal(dataCalls, 2);
    const report = renderSuiteReport({ suiteName: "로그인 후 조회", projectName: "점검", environmentName: "local", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:01Z", status: "passed", scenarios: [reportScenario("login", "로그인", first, [{ name: "로그인", reference: "POST /login" }], 10), reportScenario("data", "조회", second, [{ name: "조회", reference: "GET /data" }], 10)] });
    assert.match(report, /POST \/login/); assert.match(report, /GET \/data/);
    assert.doesNotMatch(report, /private-suite-token|Authorization|Bearer/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
