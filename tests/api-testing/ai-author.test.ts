import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-ai-author-"));
  const workspace = new ApiWorkspace(dir);
  const serverId = randomUUID(), environmentId = randomUUID();
  const project = { id: randomUUID(), name: "AI", servers: [{ id: serverId, name: "상점" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "https://private-base.example.com" } }] };
  await workspace.saveProject(project);
  await workspace.importSpec({ projectId: project.id, serverId, environmentId }, spec);
  await workspace.setGlobal({ projectId: project.id }, "accessToken", "global-secret-value");
  return { dir, workspace, project, scope: { projectId: project.id, environmentId } };
}

test("pasted AI output: fences and prose are ignored, --- splits scenarios, the suite document is read", () => {
  const chat = `시나리오를 만들었습니다.\n\n\`\`\`yaml\n${login}---\n${read}---\nsuite:\n  name: 상점 흐름\n  scenarios: [shop/login, shop/read]\n\`\`\`\n\n확인이 필요한 점: 상품 id는 7로 가정했습니다.`;
  const bundle = splitAiBundle(chat);
  assert.equal(bundle.scenarios.length, 2);
  assert.match(bundle.scenarios[0].yaml, /^id: shop\/login/);
  assert.deepEqual(bundle.suite, { name: "상점 흐름", scenarios: ["shop/login", "shop/read"] });
  // group is taken out of the scenario so the scenario syntax stays strict.
  const grouped = splitAiBundle(`group: 상점/인증\n${login}---\nsuite: { name: 흐름, group: 상점, scenarios: [로그인] }\n`);
  assert.equal(grouped.scenarios[0].group, "상점/인증");
  assert.doesNotMatch(grouped.scenarios[0].yaml, /group:/);
  assert.equal(grouped.suite?.group, "상점");
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
    assert.deepEqual(result.suite, { name: "상점 흐름", scenarioIds: ["shop/login", "ghost"], problems: ["스위트의 'ghost'가 이번 결과의 시나리오 이름에 없습니다"] });
    assert.deepEqual((await workspace.listScenarios(project.id)).map(item => item.id), ["taken"]);
    await assert.rejects(workspace.checkAiScenarios(scope, "AI가 아무것도 만들지 않았습니다"), /시나리오 YAML을 찾지 못했습니다/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("scenarios without an id get one, the suite follows names, and name clashes are reported", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    await workspace.saveScenario(scope, "name: 상품 조회\nserver: 상점\nsteps:\n  - { api: 'GET /items/{id}', pathParams: { id: 1 } }\n", {});
    const noId = (yaml: string) => yaml.replace(/^id: .*\n/, "");
    const text = [noId(login), noId(read), noId(read), "suite: { name: 상점 흐름, scenarios: [로그인, 상품 조회] }\n"].join("---\n");
    const result = await workspace.checkAiScenarios(scope, text);
    const [first, second, third] = result.drafts;
    assert.match(first.id, /^scenario-[0-9a-f-]{36}$/);
    assert.match(first.yaml, /^id: scenario-/);
    assert.notEqual(second.id, third.id);
    assert.deepEqual(first.issues, []);
    assert.deepEqual(second.notices, ["같은 이름의 시나리오가 이미 있습니다"]);
    assert.match(third.issues.join(), /이름 '상품 조회'이 이번 결과의 다른 시나리오와 겹칩니다/);
    assert.deepEqual(result.suite?.scenarioIds, [first.id, second.id]);
    assert.deepEqual(result.suite?.problems, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("groups from the AI become folders; the guide lists groups and who makes and uses each global", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    await workspace.saveScenario(scope, login, {}, undefined, { groupPath: ["상점", "인증"] });
    await workspace.saveScenario(scope, read, {});
    const prompt = await workspace.buildAiPrompt({ scope });
    assert.ok(prompt.includes("- accessToken (string) ← 만듦: 로그인 / 사용: 상품 조회"));
    assert.ok(prompt.includes("- 상점/인증") && prompt.includes("- 로그인 [상점/인증]"));
    const noId = (yaml: string) => yaml.replace(/^id: .*\n/, "").replace("name: 로그인", "name: 관리자 로그인").replace("name: 상품 조회", "name: 상품 다시 조회");
    const result = await workspace.checkAiScenarios(scope, [`group: 상점/인증\n${noId(login)}`, `group: "a/${"b/".repeat(10)}c"\n${noId(read)}`, "suite: { name: 흐름, group: 상점, scenarios: [관리자 로그인] }\n"].join("---\n"));
    assert.deepEqual(result.drafts[0].groupPath, ["상점", "인증"]);
    assert.match(result.drafts[1].issues.join(), /그룹 .*을 쓸 수 없습니다/);
    assert.deepEqual(result.suite?.groupPath, ["상점"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the guide asks what to test, points at the schema and result files, and hides secrets", async () => {
  const { dir, workspace, project, scope } = await setup();
  try {
    const prompt = await workspace.buildAiPrompt({ scope, tags: ["item"] });
    const aiDir = path.join(dir, "ai", project.id);
    const catalogFile = path.join(aiDir, "api-catalog.json"), resultFile = path.join(aiDir, "scenarios.yaml");
    assert.ok(prompt.includes("먼저 사용자에게 무엇을 테스트할지 물어보세요"));
    assert.ok(prompt.includes(catalogFile) && prompt.includes(`결과를 파일 ${resultFile} 에 저장합니다`));
    assert.ok(prompt.includes("- 상점 (API 1개)") && prompt.includes("id는 쓰지 않습니다") && prompt.includes("시나리오 name]"));
    const catalog = await readFile(catalogFile, "utf8");
    assert.ok(catalog.includes("/items/{id}") && !catalog.includes('"loginId"'));
    for (const secret of ["global-secret-value", "private-base.example.com", "example-secret"]) {
      assert.equal(prompt.includes(secret), false, secret);
      assert.equal(catalog.includes(secret), false, secret);
    }
    // The AI writes the result file; Checkly reads it back.
    assert.equal(await workspace.readAiResult(scope), null);
    await writeFile(resultFile, read);
    const loaded = await workspace.readAiResult(scope);
    assert.equal(loaded?.path, resultFile);
    assert.equal(loaded?.text, read);
    // Deleting the project removes its exchange folder.
    await workspace.deleteProject(project.id);
    await assert.rejects(readFile(catalogFile));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
