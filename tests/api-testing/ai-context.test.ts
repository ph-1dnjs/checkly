import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { schemaForAi } from "../../src/app/api-testing/main/ai-context";

test("copyable AI prompt lists every API with schemas but no values, URLs or examples", async () => {
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
    const request = { scope, goal: "회원과 관리자 로그인 흐름" };
    const text = await workspace.buildAiPrompt(request);
    for (const secret of ["session-secret", "example-secret", "default-secret", "body-secret", "response-secret", "private-server.example.com", "admin-private.example.com"]) assert.equal(text.includes(secret), false, secret);
    assert.ok(text.includes("POST /login — 로그인") && text.includes("POST /admin-login — 로그인") && text.includes("GET /not-selected"));
    assert.ok(text.includes("### 서버: 회원") && text.includes("### 서버: 관리자"));
    assert.ok(text.includes('"accessToken"') && text.includes('"type":"string"'));
    assert.ok(text.includes("```yaml 코드 블록") && text.includes("suite: {name") && text.includes("## 상세 명세") && text.includes("{{steps.1.response.body./data/challengeToken}}"));
    // One syntax: step inputs as {{inputs.x}}, no vars/valueBindings/step ids taught.
    assert.ok(text.includes("{{inputs.code}}") && text.includes("target: globals.accessToken"));
    for (const legacy of ["valueBindings", "{{vars.", "operationId", "request:"]) assert.equal(text.includes(legacy), false, legacy);
    assert.ok(text.includes("지금 작업 폴더가 이 API의 백엔드 소스라면"));
    // With the schemas saved to a file, the prompt only points at it.
    const short = await workspace.buildAiPrompt({ ...request, catalogFile: "/work/backend/checkly-api-catalog.json" });
    assert.ok(short.includes("/work/backend/checkly-api-catalog.json") && !short.includes("## 상세 명세") && short.length < text.length);
    const narrowed = await workspace.buildAiPrompt({ ...request, tags: ["missing-tag"] }).catch((error: Error) => error.message);
    assert.match(String(narrowed), /API 명세가 없습니다/);
    await assert.rejects(workspace.buildAiPrompt({ ...request, scope: { ...scope, environmentId: randomUUID() } }));
    await assert.rejects(workspace.buildAiPrompt({ ...request, goal: " " }));
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
