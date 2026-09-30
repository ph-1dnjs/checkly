import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { ApiRunner } from "../../src/app/api-testing/main/execution";
import { readOpenApi } from "../../src/app/api-testing/main/openapi";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { scenarioSchema } from "../../src/app/api-testing/shared/scenario";

const cookieSpec = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "쿠키 테스트", version: "1" },
  paths: {
    "/session": {
      get: {
        parameters: [{ name: "deviceId", in: "cookie", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "성공" } },
      },
    },
  },
});

test("simple OpenAPI cookie parameters are executable and complex cookies stay unsupported", async () => {
  const catalog = readOpenApi(cookieSpec);
  assert.deepEqual(catalog.operations[0].warnings, []);
  assert.equal(catalog.operations[0].parameters[0].location, "cookie");

  const complex = cookieSpec.replace('"type":"string"', '"type":"array","items":{"type":"string"}');
  assert.ok(readOpenApi(complex).operations[0].warnings.some(message => message.includes("deviceId")));

  const received: string[] = [];
  const server = createServer((request, response) => {
    received.push(request.headers.cookie ?? "");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const scenario = scenarioSchema.parse({
      version: 1,
      id: "cookie-session",
      name: "쿠키 세션",
      steps: [{
        id: randomUUID(), name: "세션 확인", server: "api",
        api: { method: "GET", path: "/session" },
        request: { headers: { Cookie: "existing=keep" }, cookies: { deviceId: "device-test" } },
      }],
    });
    const result = await new ApiRunner().run(scenario, {
      projectId: "cookie-project",
      environment: "dev",
      servers: { api: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` } },
    });
    assert.equal(result.status, "passed");
    assert.equal(received[0], "existing=keep; deviceId=device-test");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("stored catalogs refresh stale support warnings from their saved spec", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-catalog-migration-"));
  try {
    const workspace = new ApiWorkspace(dir);
    const projectId = randomUUID(), serverId = randomUUID(), environmentId = randomUUID();
    await workspace.saveProject({ id: projectId, name: "카탈로그 보정", servers: [{ id: serverId, name: "API" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "http://127.0.0.1:1" } }] });
    const scope = { projectId, serverId, environmentId };
    await workspace.importSpec(scope, cookieSpec);
    const filename = path.join(dir, `catalog-${projectId}-${environmentId}-${serverId}.json`);
    const saved = JSON.parse(await readFile(filename, "utf8"));
    saved.operations[0].warnings = ["deviceId: 이 파라미터 형식은 아직 실행을 지원하지 않습니다"];
    await writeFile(filename, JSON.stringify(saved));

    const reloaded = new ApiWorkspace(dir);
    const catalog = await reloaded.getCatalog(scope);
    assert.deepEqual(catalog?.operations[0].warnings, []);
    const source = "id: cookie-preview\nname: 쿠키 확인\nsteps:\n  - name: 세션 확인\n    server: api\n    api: GET /session\n";
    assert.deepEqual((await reloaded.previewScenario({ projectId, environmentId }, source, { api: serverId })).issues, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scenario runner reuses response cookies for later steps", async () => {
  const received: string[] = [];
  const server = createServer((request, response) => {
    received.push(request.headers.cookie ?? "");
    response.setHeader("content-type", "application/json");
    if (request.url === "/login") response.setHeader("set-cookie", ["deviceId=generated-device; Path=/"]);
    response.writeHead(200);
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const scenario = scenarioSchema.parse({
      version: 1,
      id: "cookie-sequence",
      name: "응답 쿠키 재사용",
      steps: [
        { id: "login", name: "쿠키 발급", server: "api", api: { method: "GET", path: "/login" }, request: {} },
        { id: "verify", name: "쿠키 재사용", server: "api", api: { method: "GET", path: "/verify" }, request: {} },
      ],
    });
    const result = await new ApiRunner().run(scenario, {
      projectId: "cookie-sequence-project",
      environment: "dev",
      servers: { api: { baseUrl: `http://127.0.0.1:${port}` } },
    });
    assert.equal(result.status, "passed");
    assert.deepEqual(received, ["", "deviceId=generated-device"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
