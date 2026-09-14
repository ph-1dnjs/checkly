import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { readOpenApi } from "../../src/app/api-testing/main/openapi";

export const spec = JSON.stringify({ openapi: "3.0.3", info: { title: "테스트 명세", version: "1" }, paths: {
  "/items/{id}": { get: { summary: "상품 조회", description: "상품의 정보를 확인합니다.", parameters: [{ name: "id", in: "path", required: true, description: "상품 번호", schema: { type: "integer" } }], responses: { "200": { description: "성공" } } } },
  "/login": { post: { summary: "로그인", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Login" } } } }, responses: { "200": { description: "토큰" } } } },
}, components: { schemas: { Login: { type: "object", properties: { loginId: { type: "string" } } } } } });

test("globals and saved scenario lifecycle: mapping, reuse, masking, conflicts and isolation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-scenarios-"));
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/login" ? { accessToken: "session-secret", id: 42 } : { id: 42, echoed: req.headers.authorization }));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const serverId = randomUUID(), environmentId = randomUUID(), otherEnvironment = randomUUID();
  const baseUrls = { [serverId]: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
  const project = { id: randomUUID(), name: "시나리오 프로젝트", servers: [{ id: serverId, name: "회원" }], environments: [{ id: environmentId, name: "dev", baseUrls }, { id: otherEnvironment, name: "stg", baseUrls }] };
  const scope = { projectId: project.id, serverId, environmentId };
  const yaml = `version: 1
id: login/read
name: 로그인 후 조회
description: 응답 ID와 토큰을 재사용합니다.
steps:
  - id: login
    name: 로그인
    server: member
    api: { method: POST, path: /login }
    extract:
      - { source: body, pointer: /accessToken, target: globals.accessToken, sensitive: true }
      - { source: body, pointer: /id, target: vars.itemId }
  - id: read
    name: 상품 조회
    server: member
    api: { method: GET, path: '/items/{id}' }
    request:
      pathParams: { id: '{{vars.itemId}}' }
      headers: { Authorization: 'Bearer {{globals.accessToken}}' }
`;
  try {
    const workspace = new ApiWorkspace(dir);
    await workspace.saveProject(project); await workspace.importSpec(scope, spec);
    await workspace.setGlobal(scope, "manual", "manual-secret");
    assert.equal(JSON.stringify(await workspace.listGlobals(scope)).includes("manual-secret"), false);
    assert.deepEqual(await workspace.listGlobals({ ...scope, environmentId: otherEnvironment }), []);
    await workspace.deleteGlobal(scope, "manual");
    assert.deepEqual(await workspace.listGlobals(scope), []);
    assert.ok((await workspace.previewScenario(scope, yaml, {})).issues.some(i => i.includes("서버")));
    const bindings = { member: serverId };
    assert.deepEqual((await workspace.previewScenario(scope, yaml, bindings)).issues, []);
    assert.ok((await workspace.previewScenario(scope, yaml.replace("vars.itemId}}", "vars.missing}}"), bindings)).issues.some(i => i.includes("정의")));
    const futureValue = `version: 1
id: future-value
name: 순서 오류
valueBindings:
  - { name: laterId, step: later, source: request, area: query, pointer: /id }
steps:
  - { id: first, name: 먼저 사용, server: member, api: { method: GET, path: '/items/{id}' }, request: { pathParams: { id: '{{vars.laterId}}' } } }
  - { id: later, name: 나중 출처, server: member, api: { method: GET, path: '/items/{id}' }, request: { pathParams: { id: 7 } } }
`;
    const futureIssues = (await workspace.previewScenario(scope, futureValue, bindings)).issues;
    assert.equal(futureIssues.filter(issue => issue.includes("값 순서 오류")).length, 1);
    assert.equal(futureIssues.some(issue => issue.includes("vars.laterId는")), false);
    const item = await workspace.saveScenario(scope, yaml, bindings);
    await assert.rejects(workspace.saveScenario(scope, yaml, bindings), /같은 ID/);
    assert.equal((await new ApiWorkspace(dir).listScenarios(project.id))[0].source, yaml);
    await workspace.saveScenario(scope, yaml, bindings, item.updatedAt);
    const result = await workspace.runScenario(scope, yaml, bindings, {});
    assert.equal(result.status, "passed");
    assert.equal(result.variables.itemId, 42);
    assert.equal(JSON.stringify(result).includes("session-secret"), false);
    const single = await workspace.execute(scope, "GET /items/{id}", { pathParams: { id: 42 }, headers: { Authorization: "Bearer {{globals.accessToken}}" } });
    assert.equal(single.status, "passed");
    assert.equal(JSON.stringify(single).includes("session-secret"), false);
    assert.ok((await workspace.listGlobals(scope)).some(v => v.name === "accessToken"));
    assert.deepEqual(await new ApiWorkspace(dir).listGlobals(scope), []);
    await assert.rejects(workspace.runScenario({ ...scope, environmentId: otherEnvironment }, yaml, bindings, {}), /명세/);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(dir, { recursive: true, force: true }); }
});

test("OpenAPI descriptions, local refs and unsupported formats", () => {
  const catalog = readOpenApi(spec);
  assert.equal(catalog.operations[0].description, "상품의 정보를 확인합니다.");
  assert.equal(catalog.operations[0].parameters[0].description, "상품 번호");
  assert.deepEqual(catalog.operations[1].bodyExample, { loginId: "" });
  assert.throws(() => readOpenApi('{"swagger":"2.0"}'), /3.0/);
  assert.throws(() => readOpenApi(spec.replace("#/components/schemas/Login", "https://example.com/schema")), /외부/);
});

test("project persistence, catalog isolation, failed import retention and real masked response", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-api-"));
  const server = createServer((req, res) => { res.setHeader("content-type", "application/json"); res.setHeader("set-cookie", "secret=hidden"); res.end(JSON.stringify({ id: 7, path: req.url, accessToken: "secret-token" })); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const serverId = randomUUID(), environmentId = randomUUID();
  const project = { id: randomUUID(), name: "테스트", servers: [{ id: serverId, name: "회원 API" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: `http://127.0.0.1:${(server.address() as { port: number }).port}` } }] };
  const scope = { projectId: project.id, serverId, environmentId };
  try {
    const workspace = new ApiWorkspace(dir);
    await workspace.saveProject(project);
    assert.deepEqual(await new ApiWorkspace(dir).listProjects(), [project]);
    await workspace.importSpec(scope, spec);
    await assert.rejects(workspace.importSpec(scope, "bad"));
    assert.equal((await new ApiWorkspace(dir).getCatalog(scope))?.operations.length, 2);
    await assert.rejects(workspace.getCatalog({ ...scope, projectId: "../../escape" }));
    await assert.rejects(workspace.execute(scope, "GET /items/{id}", {}), /필수/);
    const response = await workspace.execute(scope, "GET /items/{id}", { pathParams: { id: 7 } });
    assert.equal(response.httpStatus, 200);
    assert.deepEqual(response.body, { id: 7, path: "/items/7", accessToken: "***" });
    assert.equal(response.headers?.["set-cookie"], "***");
    assert.equal(JSON.stringify(response).includes("secret-token"), false);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});
