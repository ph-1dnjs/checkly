import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import type { Json } from "../../src/app/api-testing/shared/scenario";
import type { ApiScope } from "../../src/app/api-testing/shared/workspace";

const executionPaths = ["scenario YAML", "execute without operationId", "execute with operationId"] as const;
type ExecutionPath = typeof executionPaths[number];

async function workspaceFixture(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-operation-metadata-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workspace = new ApiWorkspace(dir);
  const projectId = randomUUID(), serverId = randomUUID(), environmentId = randomUUID();
  const scope = { projectId, serverId, environmentId };
  await workspace.saveProject({
    id: projectId, name: "metadata", servers: [{ id: serverId, name: "api" }],
    environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "https://example.invalid" } }],
  });
  const responses = { "200": { description: "OK" } };
  const search = {
    parameters: [
      { name: "filter", in: "query", style: "deepObject", explode: true, schema: { type: "object", properties: { page: { type: "integer" }, size: { type: "integer" } } } },
      { name: "tags", in: "query", style: "form", explode: false, schema: { type: "array", items: { type: "string" } } },
      { name: "spaces", in: "query", style: "spaceDelimited", schema: { type: "array", items: { type: "string" } } },
      { name: "pipes", in: "query", style: "pipeDelimited", schema: { type: "array", items: { type: "string" } } },
      { name: "sort", in: "query", style: "form", explode: false, schema: { type: "object", properties: { field: { type: "string" }, order: { type: "string" } } } },
    ],
    responses,
  };
  const submit = {
    requestBody: { required: true, content: { "application/json": { schema: {
      type: "object", required: ["quantity"], properties: { quantity: { type: "integer" } },
    } } } },
    responses,
  };
  const optionalBody = (type: "array" | "string") => ({
    requestBody: { required: false, content: { "application/json": { schema: {
      type, ...(type === "array" ? { items: { type: "integer" } } : {}),
    } } } },
    responses,
  });
  const requiredBody = (schema: Json) => ({
    requestBody: { required: true, content: { "application/json": { schema } } }, responses,
  });
  const integerBody = requiredBody({ type: "integer" });
  const nullableBody = requiredBody({ type: "object", required: ["nullableName", "name"], properties: {
    nullableName: { type: "string", nullable: true }, name: { type: "string" },
  } });
  const readOnlyBody = requiredBody({ type: "object", required: ["id", "name"], properties: {
    id: { type: "integer", readOnly: true }, name: { type: "string" },
  } });
  await workspace.importSpec(scope, JSON.stringify({
    openapi: "3.0.3", info: { title: "metadata", version: "1" },
    paths: {
      "/search": { get: search },
      "/search-with-id": { get: { ...search, operationId: "searchWithId" } },
      "/submit": { post: submit },
      "/submit-with-id": { post: { ...submit, operationId: "submitWithId" } },
      "/optional-array": { post: optionalBody("array") },
      "/optional-array-with-id": { post: { ...optionalBody("array"), operationId: "optionalArrayWithId" } },
      "/optional-string": { post: optionalBody("string") },
      "/optional-string-with-id": { post: { ...optionalBody("string"), operationId: "optionalStringWithId" } },
      "/integer-body": { post: integerBody },
      "/integer-body-with-id": { post: { ...integerBody, operationId: "integerBodyWithId" } },
      "/nullable-body": { post: nullableBody },
      "/nullable-body-with-id": { post: { ...nullableBody, operationId: "nullableBodyWithId" } },
      "/read-only-body": { post: readOnlyBody },
      "/read-only-body-with-id": { post: { ...readOnlyBody, operationId: "readOnlyBodyWithId" } },
    },
  }));
  return { workspace, scope };
}

async function invoke(workspace: ApiWorkspace, scope: ApiScope, executionPath: ExecutionPath, method: string, route: string, request: { query?: Record<string, Json>; body?: Json }) {
  const operationPath = executionPath === "execute with operationId" ? `${route}-with-id` : route;
  if (executionPath !== "scenario YAML") return workspace.execute(scope, `${method} ${operationPath}`, request);
  // Exercise the public authoring format, whose api is a METHOD/path string.
  const source = `name: metadata\nserver: api\nsteps:\n  - api: ${method} ${operationPath}\n`
    + Object.entries(request).map(([area, value]) => `    ${area}: ${JSON.stringify(value)}\n`).join("");
  const result = await workspace.runScenario(scope, source, {}, {});
  return result.steps[0];
}

test("workspace execution retains OpenAPI query serialization metadata", async t => {
  for (const executionPath of executionPaths) await t.test(executionPath, async t => {
    const { workspace, scope } = await workspaceFixture(t);
    const urls: URL[] = [];
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      urls.push(new URL(String(input)));
      return new Response("{}", { status: 200 });
    });
    const result = await invoke(workspace, scope, executionPath, "GET", "/search", { query: {
      filter: { page: 2, size: 20 }, tags: ["active", "new"],
      spaces: ["alpha", "beta"], pipes: ["left", "right"], sort: { field: "name", order: "asc" },
    } });
    assert.equal(result.status, "passed");
    assert.equal(urls.length, 1);
    assert.equal(urls[0].pathname, executionPath === "execute with operationId" ? "/search-with-id" : "/search");
    assert.deepEqual([...urls[0].searchParams], [
      ["filter[page]", "2"], ["filter[size]", "20"], ["tags", "active,new"],
      ["spaces", "alpha beta"], ["pipes", "left|right"], ["sort", "field,name,order,asc"],
    ]);
  });
});

test("workspace validates resolved request body types before sending HTTP", async t => {
  for (const executionPath of executionPaths) await t.test(executionPath, async t => {
    const { workspace, scope } = await workspaceFixture(t);
    const bodies: unknown[] = [];
    t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    });
    await workspace.setGlobal({ projectId: scope.projectId }, "quantity", "wrong-type");
    const request = { body: { quantity: "{{globals.quantity}}" } };
    const invalid = await invoke(workspace, scope, executionPath, "POST", "/submit", request);
    assert.equal(invalid.status, "failed");
    assert.match(invalid.error ?? "", /body\.quantity.*integer.*string/);
    assert.equal(bodies.length, 0, "a schema type mismatch must not reach HTTP");

    await workspace.setGlobal({ projectId: scope.projectId }, "quantity", 2);
    const valid = await invoke(workspace, scope, executionPath, "POST", "/submit", request);
    assert.equal(valid.status, "passed");
    assert.deepEqual(bodies, [{ quantity: 2 }]);
  });
});

test("optional array and scalar bodies can be omitted on every workspace execution path", async t => {
  for (const executionPath of executionPaths) await t.test(executionPath, async t => {
    const { workspace, scope } = await workspaceFixture(t);
    const requests: Array<{ path: string; body: BodyInit | null | undefined }> = [];
    t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ path: new URL(String(input)).pathname, body: init?.body });
      return new Response("{}", { status: 200 });
    });
    for (const type of ["array", "string"]) {
      const result = await invoke(workspace, scope, executionPath, "POST", `/optional-${type}`, {});
      assert.equal(result.status, "passed", `omitting an optional ${type} body must be allowed`);
    }
    const suffix = executionPath === "execute with operationId" ? "-with-id" : "";
    assert.deepEqual(requests, [
      { path: `/optional-array${suffix}`, body: undefined },
      { path: `/optional-string${suffix}`, body: undefined },
    ]);
  });
});

test("request body validation accepts integer, nullable and readOnly schemas without weakening invalid input checks", async t => {
  const cases: Array<{ route: string; valid: Json; invalid: Json; error: RegExp }> = [
    { route: "/integer-body", valid: 2, invalid: 2.5, error: /integer/ },
    { route: "/nullable-body", valid: { nullableName: null, name: "present" }, invalid: { nullableName: null, name: null }, error: /body\.name.*string/ },
    { route: "/read-only-body", valid: { name: "present" }, invalid: {}, error: /필수 요청값 누락: body\.name/ },
  ];
  for (const executionPath of executionPaths) await t.test(executionPath, async t => {
    const { workspace, scope } = await workspaceFixture(t);
    const bodies: Json[] = [];
    t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Json);
      return new Response("{}", { status: 200 });
    });
    for (const example of cases) {
      const valid = await invoke(workspace, scope, executionPath, "POST", example.route, { body: example.valid });
      assert.equal(valid.status, "passed", `valid ${example.route} body should reach HTTP`);
      const before = bodies.length;
      const invalid = await invoke(workspace, scope, executionPath, "POST", example.route, { body: example.invalid });
      assert.equal(invalid.status, "failed", `invalid ${example.route} body should be rejected`);
      assert.match(invalid.error ?? "", example.error);
      assert.equal(bodies.length, before, `invalid ${example.route} body must not reach HTTP`);
    }
    assert.deepEqual(bodies, cases.map(example => example.valid));
  });
});
