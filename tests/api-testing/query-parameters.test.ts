import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ApiRunner } from "../../src/app/api-testing/main/execution";
import { readOpenApi } from "../../src/app/api-testing/main/openapi";
import { scenarioSchema } from "../../src/app/api-testing/shared/scenario";

const querySpec = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "쿼리 객체 테스트", version: "1" },
  paths: {
    "/customers": {
      get: {
        operationId: "getCustomers",
        parameters: [
          { name: "pageable", in: "query", required: true, style: "deepObject", explode: true, schema: { type: "object", properties: { page: { type: "integer" }, size: { type: "integer" } } } },
          { name: "tags", in: "query", schema: { type: "array", items: { type: "string" } } },
        ],
        responses: { "200": { description: "성공" } },
      },
    },
  },
});

test("OpenAPI object and array query parameters keep their declared serialization", async () => {
  const catalog = readOpenApi(querySpec);
  const operation = catalog.operations[0];
  assert.deepEqual(operation.warnings, []);

  let received: URL | undefined;
  const server = createServer((request, response) => {
    received = new URL(request.url ?? "/", "http://127.0.0.1");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const scenario = scenarioSchema.parse({
      version: 1,
      id: "query-shapes",
      name: "객체 쿼리",
      steps: [{
        id: "customers",
        name: "고객 목록",
        server: "api",
        api: { operationId: "getCustomers" },
        request: { query: { pageable: { page: 2, size: 20 }, tags: ["active", "new"] } },
      }],
    });
    const result = await new ApiRunner().run(scenario, {
      projectId: "query-project",
      environment: "dev",
      servers: { api: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` } },
      resolveOperation: () => operation,
    });
    assert.equal(result.status, "passed");
    assert.equal(received?.searchParams.get("pageable[page]"), "2");
    assert.equal(received?.searchParams.get("pageable[size]"), "20");
    assert.deepEqual(received?.searchParams.getAll("tags"), ["active", "new"]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
