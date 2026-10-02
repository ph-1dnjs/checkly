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
    assert.match(result.drafts[1].issues.join(), /명세에 없는 API입니다/);
    assert.match(result.drafts[2].issues.join(), /id 'taken'가 기존 시나리오와 겹칩니다/);
    assert.match(result.drafts[3].issues[0], /^YAML 오류/);
    assert.deepEqual(result.suite, { name: "상점 흐름", scenarioIds: ["shop/login", "ghost"], problems: ["스위트의 'ghost'가 이번 결과와 기존 시나리오 이름에 없습니다"] });
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
    assert.deepEqual(second.notices, ["같은 이름의 시나리오가 이미 있습니다. 저장하면 같은 이름이 하나 더 생깁니다"]);
    assert.equal(second.sameName, true);
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
    // Picking single operations ("<serverId> <METHOD path>") narrows the same way.
    await workspace.buildAiPrompt({ scope, operations: [`${project.servers[0].id} POST /login`] });
    const picked = await readFile(catalogFile, "utf8");
    assert.ok(picked.includes('"loginId"') && !picked.includes("/items/{id}"));
    await workspace.buildAiPrompt({ scope, tags: ["item"] });
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

test("after a spec refresh: steps whose API is gone are listed, and steps named after an old title can take the new one", async () => {
  const { dir, workspace, project, scope } = await setup();
  const specScope = { ...scope, serverId: project.servers[0].id };
  try {
    await workspace.saveScenario(scope, read, {});
    // A step the user named themselves is never renamed.
    await workspace.saveScenario(scope, read.replace("id: shop/read", "id: shop/custom").replace("name: 상품 조회\nserver", "name: 내 조회\nserver").replace("  - name: 상품 조회", "  - name: 내가 붙인 이름"), {});
    assert.deepEqual(await workspace.checkScenarioSpecs(scope), { missing: [], renamed: [] });
    // Title changed, path kept.
    await workspace.importSpec(specScope, spec.replace('summary: "상품 조회"', 'summary: "상품 상세 조회"').replace('"summary":"상품 조회"', '"summary":"상품 상세 조회"'));
    const impact = await workspace.checkScenarioSpecs(scope);
    assert.deepEqual(impact.missing, []);
    assert.deepEqual(impact.renamed.map(item => [item.scenario, item.steps]), [["상품 조회", [{ from: "상품 조회", to: "상품 상세 조회" }]]]);
    assert.deepEqual(await workspace.applyTitleRenames(scope), { updated: ["상품 조회"], skipped: [] });
    assert.deepEqual((await workspace.checkScenarioSpecs(scope)).renamed, []);
    const saved = (await workspace.listScenarios(project.id)).find(item => item.id === "shop/read");
    assert.match(saved!.source, /name: 상품 상세 조회/);
    // Path renamed: the saved steps point at an API that is gone.
    await workspace.importSpec(specScope, spec.replace("/items/{id}", "/products/{id}"));
    const missing = (await workspace.checkScenarioSpecs(scope)).missing;
    assert.deepEqual(missing.map(item => item.steps), [["상품 상세 조회 (GET /items/{id})"], ["내가 붙인 이름 (GET /items/{id})"]]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("title renames still apply to a scenario that also uses an API gone from the spec", async () => {
  const { dir, workspace, project, scope } = await setup();
  try {
    await workspace.saveScenario(scope, "id: shop/mixed\nname: 섞임\nserver: 상점\nsteps:\n  - name: 로그인\n    api: POST /login\n    auth: none\n    body: { loginId: tester }\n  - name: 상품 조회\n    api: GET /items/{id}\n    auth: none\n    pathParams: { id: 7 }\n", {});
    const next = JSON.parse(spec);
    delete next.paths["/login"];
    next.paths["/items/{id}"].get.summary = "상품 상세 조회";
    await workspace.importSpec({ ...scope, serverId: project.servers[0].id }, JSON.stringify(next));
    const impact = await workspace.checkScenarioSpecs(scope);
    assert.deepEqual(impact.missing.map(item => item.steps), [["로그인 (POST /login)"]]);
    assert.deepEqual(await workspace.applyTitleRenames(scope), { updated: ["섞임"], skipped: [] });
    const after = await workspace.checkScenarioSpecs(scope);
    assert.deepEqual(after.renamed, []);
    assert.equal(after.missing.length, 1);
    const saved = (await workspace.listScenarios(project.id)).find(item => item.id === "shop/mixed");
    assert.equal(saved?.draft, false);
    assert.match(saved!.source, /name: 상품 상세 조회/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("keeping a scenario's old step names stops the suggestion until the title changes again", async () => {
  const { dir, workspace, project, scope } = await setup();
  const specScope = { ...scope, serverId: project.servers[0].id };
  try {
    await workspace.saveScenario(scope, read, {});
    await workspace.importSpec(specScope, spec.replace('"summary":"상품 조회"', '"summary":"상품 상세 조회"'));
    const before = (await workspace.listScenarios(project.id))[0];
    await workspace.keepTitles(scope, "shop/read");
    assert.deepEqual((await workspace.checkScenarioSpecs(scope)).renamed, []);
    assert.deepEqual(await workspace.applyTitleRenames(scope), { updated: [], skipped: [] });
    const kept = (await workspace.listScenarios(project.id))[0];
    // Metadata only: the name and updatedAt stay, so an open editor can still save.
    assert.equal(kept.updatedAt, before.updatedAt);
    assert.match(kept.source, /name: 상품 조회\n/);
    // A later save keeps the choice.
    await workspace.saveScenario(scope, kept.source, {}, kept.updatedAt);
    assert.deepEqual((await workspace.checkScenarioSpecs(scope)).renamed, []);
    // A different new title is suggested again.
    await workspace.importSpec(specScope, spec.replace('"summary":"상품 조회"', '"summary":"상품 정보"'));
    assert.deepEqual((await workspace.checkScenarioSpecs(scope)).renamed.map(item => item.steps), [[{ from: "상품 조회", to: "상품 정보" }]]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a suite can reuse a saved scenario by name, and a broken scenario keeps its written name", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const saved = await workspace.saveScenario(scope, "name: 기존 로그인\nserver: 상점\nsteps:\n  - { api: 'GET /items/{id}', pathParams: { id: 1 } }\n", {});
    const broken = "name: 깨진 시나리오\nserver: 상점\nsteps:\n  - { api: 'GET /items/{id}', pathParams: { id: '{{steps.2.response.body./id}}' } }\n";
    const text = [broken, "suite: { name: 흐름, scenarios: [기존 로그인, 깨진 시나리오] }\n"].join("---\n");
    const result = await workspace.checkAiScenarios(scope, text);
    assert.equal(result.drafts[0].name, "깨진 시나리오");
    assert.match(result.drafts[0].issues.join(), /YAML 오류/);
    assert.deepEqual(result.suite?.scenarioIds, [saved.id, result.drafts[0].id]);
    assert.deepEqual(result.suite?.saved, { [saved.id]: "기존 로그인" });
    assert.deepEqual(result.suite?.problems, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a same-name draft falls back to the saved scenario, and saved drafts cannot join the suite", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    const source = (name: string) => `name: ${name}\nserver: 상점\nsteps:\n  - { api: 'GET /items/{id}', pathParams: { id: 1 } }\n`;
    const saved = await workspace.saveScenario(scope, source("로그인"), {});
    await workspace.saveScenarioDraft(scope, "name: 미완성\nserver: 상점\nsteps:\n  - { api: 'GET /nowhere' }\n", {});
    const text = [source("로그인"), "suite: { name: 흐름, scenarios: [로그인, 미완성] }\n"].join("---\n");
    const result = await workspace.checkAiScenarios(scope, text);
    const [draft] = result.drafts;
    assert.equal(draft.sameName, true);
    assert.deepEqual(result.suite?.fallbacks, { [draft.id]: saved.id });
    assert.deepEqual(result.suite?.problems, ["스위트의 '미완성'는 실행할 수 없는 초안이라 넣을 수 없습니다"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("missing globals are listed once per global with their steps and the scenario that makes them", async () => {
  const { dir, workspace, scope } = await setup();
  try {
    await workspace.saveScenario(scope, login.replace("id: shop/login", "id: shop/issue").replace("name: 로그인", "name: 토큰 발급").replace("globals.accessToken", "globals.otherToken"), {});
    const uses = "name: 두 번 조회\nserver: 상점\nauth: globals.otherToken\nsteps:\n  - { name: 첫 조회, api: 'GET /items/{id}', pathParams: { id: 1 } }\n  - { name: 둘째 조회, api: 'GET /items/{id}', pathParams: { id: '{{globals.missingId}}' } }\n  - { name: 셋째 조회, api: 'GET /items/{id}', pathParams: { id: '{{globals.batchId}}' } }\n";
    // A scenario in the same result can make a value too.
    const makes = "name: 같은 결과의 발급\nserver: 상점\nsteps:\n  - { name: 발급, api: POST /login, auth: none, body: { loginId: tester }, extract: [{ pointer: /id, target: globals.batchId }] }\n";
    const result = await workspace.checkAiScenarios(scope, [uses, makes].join("---\n"));
    assert.deepEqual(result.drafts[0].executionIssues, [
      "1·2·3단계: 전역변수 'otherToken' 값이 없습니다. '토큰 발급'을(를) 먼저 실행하면 만들어집니다",
      "2단계: 전역변수 'missingId' 값이 없습니다. 전역변수에서 설정하세요",
      "3단계: 전역변수 'batchId' 값이 없습니다. '같은 결과의 발급'을(를) 먼저 실행하면 만들어집니다",
    ]);
    assert.deepEqual(result.drafts[0].issues, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
