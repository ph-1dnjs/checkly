import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { ApiRunner } from "../../src/app/api-testing/main/execution";
import { readOpenApi } from "../../src/app/api-testing/main/openapi";
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
