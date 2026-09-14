import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { parseScenario } from "../../src/app/api-testing/shared/scenario";
import { schemaForAi } from "../../src/app/api-testing/main/ai-context";

test("AI context is selected, environment-scoped, value-free and has importable YAML example", async () => {
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
    await workspace.setGlobal(scope, "accessToken", "session-secret");
    const request = { scope, goal: "회원과 관리자 로그인 흐름", selections: [{ serverId, operationKey: "POST /login" }, { serverId: secondServerId, operationKey: "POST /admin-login" }] };
    const text = await workspace.buildAiContext(request);
    for (const secret of ["session-secret", "example-secret", "default-secret", "body-secret", "response-secret", "private-server.example.com", "admin-private.example.com", "/not-selected"]) assert.equal(text.includes(secret), false, secret);
    assert.ok(text.includes("/login") && text.includes("/admin-login"));
    assert.ok(text.includes('"accessToken"') && text.includes('"type": "string"'));
    const yaml = /```yaml\n([\s\S]*?)```/.exec(text)![1];
    const parsed = parseScenario(yaml);
    assert.equal(parsed.steps[0].server, serverId);
    assert.deepEqual((await workspace.previewScenario(scope, yaml, {})).issues, []);
    await assert.rejects(workspace.buildAiContext({ ...request, scope: { ...scope, environmentId: randomUUID() } }));
    await assert.rejects(workspace.buildAiContext({ ...request, selections: [{ serverId, operationKey: "GET /missing" }] }));
    await assert.rejects(workspace.buildAiContext({ ...request, selections: [] }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("schema export retains property names and flags unresolved refs without example values", () => {
  assert.deepEqual(schemaForAi({ type: "object", properties: { example: { type: "string", example: "secret" }, item: { $ref: "#/components/schemas/Item" } }, "x-secret": "hidden" }), { type: "object", properties: { example: { type: "string" }, item: { unresolvedReference: true } } });
});
