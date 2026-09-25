import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { schemaForAi } from "../../src/app/api-testing/main/ai-context";

test("AI guide lists every API, writes schemas to a file, and leaks no values, URLs or examples", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-ai-context-"));
  const serverId = randomUUID(), secondServerId = randomUUID(), environmentId = randomUUID();
  const projectId = randomUUID();
  const spec = (route: string) => JSON.stringify({ openapi: "3.0.3", info: { title: "테스트", version: "1" }, paths: {
    [route]: { post: { summary: "로그인", description: "로그인 설명 session-secret", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["password"], properties: { password: { type: "string", description: "비밀번호", example: "example-secret", default: "default-secret" } } }, example: { password: "body-secret" } } } }, responses: { "200": { description: "성공", content: { "application/json": { schema: { type: "object", properties: { accessToken: { type: "string" } } }, example: { accessToken: "response-secret" } } } } } } },
    "/not-selected": { get: { summary: "포함하지 않을 API", responses: {} } },
  } });
  try {
    const workspace = new ApiWorkspace(dir);
    await workspace.saveProject({ id: projectId, name: "QA", servers: [{ id: serverId, name: "회원" }, { id: secondServerId, name: "관리자" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "https://private-server.example.com", [secondServerId]: "https://admin-private.example.com" } }] });
    const scope = { projectId, environmentId };
    await workspace.importSpec({ ...scope, serverId }, spec("/login"));
    await workspace.importSpec({ ...scope, serverId: secondServerId }, spec("/admin-login"));
    await workspace.setGlobal({ projectId }, "accessToken", "session-secret");
    const request = { scope };
    const text = await workspace.buildAiPrompt(request);
    for (const secret of ["session-secret", "example-secret", "default-secret", "body-secret", "response-secret", "private-server.example.com", "admin-private.example.com"]) assert.equal(text.includes(secret), false, secret);
    // The API list lives only in the catalog file; the guide names the servers.
    assert.ok(text.includes("- 회원 (API 2개)") && text.includes("- 관리자 (API 2개)") && !text.includes("POST /login"));
    assert.ok(text.includes('"accessToken"'));
    // Schemas go to the catalog file, also without secrets.
    const catalog = await readFile(path.join(dir, "ai", projectId, "api-catalog.json"), "utf8");
    assert.ok(catalog.includes('"api": "POST /login"') && catalog.includes('"api": "POST /admin-login"') && catalog.includes('"api": "GET /not-selected"'));
    assert.ok(catalog.includes('"password"') && catalog.includes('"type": "string"'));
    for (const secret of ["session-secret", "example-secret", "default-secret", "body-secret", "response-secret"]) assert.equal(catalog.includes(secret), false, secret);
    assert.ok(text.includes("suite: {name") && text.includes("{{steps.1.response.body./data/challengeToken}}"));
    // One syntax: step inputs as {{inputs.x}}, no vars/valueBindings/step ids taught.
    assert.ok(text.includes("{{inputs.code}}") && text.includes("target: globals.accessToken"));
    for (const legacy of ["valueBindings", "{{vars.", "operationId", "request:"]) assert.equal(text.includes(legacy), false, legacy);
    const narrowed = await workspace.buildAiPrompt({ ...request, tags: ["missing-tag"] }).catch((error: Error) => error.message);
    assert.match(String(narrowed), /API 명세가 없습니다/);
    await assert.rejects(workspace.buildAiPrompt({ ...request, scope: { ...scope, environmentId: randomUUID() } }));
    await assert.rejects(workspace.buildAiPrompt({ ...request, goal: "목표" }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("schema export retains property names and flags unresolved refs without example values", () => {
  assert.deepEqual(schemaForAi({ type: "object", properties: { example: { type: "string", example: "secret" }, item: { $ref: "#/components/schemas/Item" } }, "x-secret": "hidden" }), { type: "object", properties: { example: { type: "string" }, item: { unresolvedReference: true } } });
});

test("AI schemas inline local $refs, cut cycles and resolve shared responses", async () => {
  const { specRefResolver, aiCatalogDetails } = await import("../../src/app/api-testing/main/ai-context");
  const spec = { components: {
    schemas: {
      Token: { type: "object", properties: { accessToken: { type: "string", example: "secret" } } },
      Node: { type: "object", properties: { child: { $ref: "#/components/schemas/Node" } } },
      Envelope: { type: "object", properties: { data: { $ref: "#/components/schemas/Token" } } },
    },
    responses: { Ok: { description: "성공", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } } },
  } };
  const resolve = specRefResolver(spec);
  assert.deepEqual(schemaForAi({ $ref: "#/components/schemas/Envelope" }, 0, resolve), { type: "object", properties: { data: { type: "object", properties: { accessToken: { type: "string" } } } } });
  assert.deepEqual(schemaForAi({ $ref: "#/components/schemas/Node" }, 0, resolve), { type: "object", properties: { child: { circularReference: "Node" } } });
  assert.deepEqual(schemaForAi({ $ref: "#/components/schemas/Missing" }, 0, resolve), { unresolvedReference: true });
  const [server] = aiCatalogDetails([{ serverName: "API", spec, operations: [{ key: "POST /login", method: "POST", path: "/login", summary: "로그인", description: "", tag: "auth", parameters: [], bodyRequired: true, bodySchema: { $ref: "#/components/schemas/Token" }, responses: { "200": { $ref: "#/components/responses/Ok" } }, warnings: [] }] }]);
  assert.deepEqual(server.apis[0].requestSchema, { type: "object", properties: { accessToken: { type: "string" } } });
  assert.deepEqual(server.apis[0].responses, { "200": { description: "성공", content: { "application/json": { schema: { type: "object", properties: { data: { type: "object", properties: { accessToken: { type: "string" } } } } } } } } });
});
