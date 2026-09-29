import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";

const spec = JSON.stringify({ openapi: "3.0.3", info: { title: "상점", version: "1" }, paths: {
  "/items/{id}": { get: { parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } } },
} });
const read = "id: shop/read\nname: 상품 조회\nserver: 상점\nsteps:\n  - name: 상품 조회\n    api: GET /items/{id}\n    auth: none\n    pathParams: { id: 7 }\n";

test("a project shares as one file without secrets and imports as a new project", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-share-"));
  try {
    const workspace = new ApiWorkspace(dir);
    const serverId = randomUUID(), dev = randomUUID(), stage = randomUUID();
    const project = { id: randomUUID(), name: "쇼핑몰 QA", servers: [{ id: serverId, name: "상점" }], environments: [
      { id: dev, name: "dev", baseUrls: { [serverId]: "https://dev.example.com" } }, { id: stage, name: "stage", baseUrls: { [serverId]: "https://stage.example.com" } }] };
    await workspace.saveProject(project);
    await workspace.importSpec({ projectId: project.id, environmentId: dev, serverId }, spec);
    // What the spec sync stores: URL plus a docs account that must never be shared.
    await writeFile(path.join(dir, `spec-source-${project.id}-${dev}-${serverId}.json`), JSON.stringify({ url: "https://dev.example.com/v3/api-docs", username: "docs-user", encrypted: "secret-blob" }));
    const scope = { projectId: project.id, environmentId: dev };
    await workspace.saveScenario(scope, read, {}, undefined, { groupPath: ["상품"], tags: ["smoke"] });
    await workspace.saveScenarioDraft(scope, read.replace("shop/read", "shop/draft").replace("name: 상품 조회\nserver", "name: 작성 중\nserver"), {});
    await workspace.saveSuite(project.id, { id: randomUUID(), name: "기본", scenarioIds: ["shop/read"], onFailure: "stop" });
    await workspace.setGlobal({ projectId: project.id }, "accessToken", "global-secret");

    const text = await workspace.exportProject(project.id);
    for (const secret of ["global-secret", "docs-user", "secret-blob", "accessToken"]) assert.equal(text.includes(secret), false, secret);
    const data = JSON.parse(text);
    assert.equal(data.format, "checkly-api-project");
    assert.deepEqual(data.specUrls, [{ serverId, environmentId: dev, url: "https://dev.example.com/v3/api-docs" }]);
    assert.deepEqual(data.scenarios.map((item: { id: string; draft?: boolean }) => [item.id, item.draft ?? false]), [["shop/read", false], ["shop/draft", true]]);

    const imported = await workspace.importProject(text);
    assert.deepEqual({ scenarios: imported.scenarios, suites: imported.suites, specUrls: imported.specUrls }, { scenarios: 2, suites: 1, specUrls: 1 });
    // New ids everywhere, and a name that does not clash with the original.
    assert.equal(imported.project.name, "쇼핑몰 QA (2)");
    assert.notEqual(imported.project.id, project.id);
    assert.notEqual(imported.project.servers[0].id, serverId);
    const newServer = imported.project.servers[0].id, newDev = imported.project.environments.find(env => env.name === "dev")!.id;
    assert.equal(imported.project.environments.find(env => env.name === "stage")!.baseUrls[newServer], "https://stage.example.com");
    const scenarios = await workspace.listScenarios(imported.project.id);
    assert.deepEqual(scenarios.map(item => [item.id, item.draft, item.groupPath, item.tags]), [["shop/read", false, ["상품"], ["smoke"]], ["shop/draft", true, undefined, undefined]]);
    const [suite] = await workspace.listSuites(imported.project.id);
    assert.deepEqual(suite.scenarioIds, ["shop/read"]);
    assert.deepEqual(await workspace.getCatalog({ projectId: imported.project.id, environmentId: newDev, serverId: newServer }), null);
    // Globals stay with the original project.
    assert.deepEqual(await workspace.listGlobals({ projectId: imported.project.id }), []);
    assert.equal((await workspace.importProject(text)).project.name, "쇼핑몰 QA (3)");

    await assert.rejects(workspace.importProject("{}"), /Checkly 프로젝트 파일이 아닙니다/);
    await assert.rejects(workspace.importProject(JSON.stringify({ ...data, version: 2 })), /지원하지 않는 프로젝트 파일 형식/);
    await assert.rejects(workspace.importProject(JSON.stringify({ ...data, scenarios: [{ ...data.scenarios[0], source: "id: other\nname: x\nserver: 상점\nsteps: []\n" }] })));
    assert.equal((await workspace.listProjects()).length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
