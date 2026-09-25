import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { splitAiBundle } from "../../src/app/api-testing/main/ai-context";

const spec = JSON.stringify({ openapi: "3.0.3", info: { title: "상점", version: "1" }, paths: {
  "/login": { post: { tags: ["auth"], summary: "로그인", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["loginId"], properties: { loginId: { type: "string", example: "example-secret" } } } } } }, responses: { "200": { description: "성공", content: { "application/json": { schema: { type: "object", properties: { accessToken: { type: "string" }, id: { type: "integer" } } } } } } } } },
  "/items/{id}": { get: { tags: ["item"], summary: "상품 조회", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "성공" } } } },
} });

const login = "id: shop/login\nname: 로그인\nserver: 상점\nsteps:\n  - name: 로그인\n    api: POST /login\n    auth: none\n    body: { loginId: tester }\n    extract: [{ pointer: /accessToken, target: globals.accessToken, sensitive: true }]\n";
const read = "id: shop/read\nname: 상품 조회\nserver: 상점\nsteps:\n  - name: 상품 조회\n    api: GET /items/{id}\n    auth: globals.accessToken\n    pathParams: { id: 7 }\n";

async function setup(backendPath?: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-ai-author-"));
  const workspace = new ApiWorkspace(dir);
  const serverId = randomUUID(), environmentId = randomUUID();
  const project = { id: randomUUID(), name: "AI", servers: [{ id: serverId, name: "상점" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "https://private-base.example.com" } }], ...(backendPath ? { backendPath } : {}) };
  await workspace.saveProject(project);
  await workspace.importSpec({ projectId: project.id, serverId, environmentId }, spec);
  await workspace.setGlobal({ projectId: project.id }, "accessToken", "global-secret-value");
  return { dir, workspace, project, scope: { projectId: project.id, environmentId } };
}

test("pasted AI output: fences and prose are ignored, --- splits scenarios, the suite document is read", () => {
  const chat = `시나리오를 만들었습니다.\n\n\`\`\`yaml\n${login}---\n${read}---\nsuite:\n  name: 상점 흐름\n  scenarios: [shop/login, shop/read]\n\`\`\`\n\n확인이 필요한 점: 상품 id는 7로 가정했습니다.`;
  const bundle = splitAiBundle(chat);
  assert.equal(bundle.scenarios.length, 2);
  assert.match(bundle.scenarios[0], /^id: shop\/login/);
  assert.deepEqual(bundle.suite, { name: "상점 흐름", scenarioIds: ["shop/login", "shop/read"] });
  // Bare YAML (e.g. from a file) works the same; a broken document is kept for its error.
  const bare = splitAiBundle(`${read}---\nname: [\n`);
  assert.equal(bare.scenarios.length, 2);
  assert.equal(bare.suite, null);
});

test("checking pasted scenarios reports problems per draft and for the suite without saving", async () => {
  const { dir, workspace, project, scope } = await setup();
  try {
    await workspace.saveScenario(scope, "id: taken\nname: 기존\nserver: 상점\nsteps:\n  - { api: 'GET /items/{id}', pathParams: { id: 1 } }\n", {});
    const text = [login, read.replace("GET /items/{id}", "GET /missing"), read.replace("shop/read", "taken"), "suite: { name: 상점 흐름, scenarios: [shop/login, ghost] }\n", "name: ["].join("---\n");
    const result = await workspace.checkAiScenarios(scope, text);
    assert.deepEqual(result.drafts[0].issues, []);
    assert.match(result.drafts[1].issues.join(), /API를 유일하게 찾을 수 없습니다/);
    assert.match(result.drafts[2].issues.join(), /id 'taken'가 기존 시나리오와 겹칩니다/);
    assert.match(result.drafts[3].issues[0], /^YAML 오류/);
    assert.deepEqual(result.suite, { name: "상점 흐름", scenarioIds: ["shop/login", "ghost"], problems: ["스위트의 'ghost'가 생성한 시나리오 id에 없습니다"] });
    assert.deepEqual((await workspace.listScenarios(project.id)).map(item => item.id), ["taken"]);
    await assert.rejects(workspace.checkAiScenarios(scope, "AI가 아무것도 만들지 않았습니다"), /시나리오 YAML을 찾지 못했습니다/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("prompt names the backend folder; the schema file follows the tags and hides secrets", async () => {
  const backend = await mkdtemp(path.join(tmpdir(), "checkly-backend-"));
  const { dir, workspace, scope } = await setup(backend);
  try {
    const prompt = await workspace.buildAiPrompt({ scope, goal: "상품", tags: ["item"] });
    assert.ok(prompt.includes(`백엔드 소스는 ${backend} 에 있습니다`));
    assert.ok(prompt.includes("GET /items/{id}") && !prompt.includes("POST /login"));
    assert.ok(prompt.includes("```yaml") && prompt.includes("Checkly 검사 결과"));
    const catalog = await workspace.buildAiCatalog({ scope, tags: ["auth"] });
    assert.ok(catalog.includes('"loginId"') && !catalog.includes("/items/{id}"));
    for (const secret of ["global-secret-value", "private-base.example.com", "example-secret"]) {
      assert.equal(prompt.includes(secret), false, secret);
      assert.equal(catalog.includes(secret), false, secret);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(backend, { recursive: true, force: true });
  }
});
