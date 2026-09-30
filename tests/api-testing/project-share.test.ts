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

test("a share file merges back into its copy: one-side changes apply, both-side changes are conflicts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-share-merge-"));
  try {
    const workspace = new ApiWorkspace(dir);
    const serverId = randomUUID(), dev = randomUUID();
    const original = { id: randomUUID(), name: "쇼핑몰 QA", servers: [{ id: serverId, name: "상점" }], environments: [{ id: dev, name: "dev", baseUrls: { [serverId]: "https://a.example.com" } }] };
    await workspace.saveProject(original);
    await workspace.importSpec({ projectId: original.id, environmentId: dev, serverId }, spec);
    const scenario = (id: string, name: string, itemId = 7) => read.replace("shop/read", id).replace("name: 상품 조회\nserver", `name: ${name}\nserver`).replace("id: 7", `id: ${itemId}`);
    const aScope = { projectId: original.id, environmentId: dev };
    for (const [id, name] of [["x", "X"], ["y", "Y"], ["z", "Z"]]) await workspace.saveScenario(aScope, scenario(id, name), {});

    // A shares; B imports it as a copy.
    const first = await workspace.exportProject(original.id);
    const copy = (await workspace.importProject(first)).project;
    const bScope = { projectId: copy.id, environmentId: copy.environments[0].id };
    await workspace.importSpec({ ...bScope, serverId: copy.servers[0].id }, spec);
    const edit = async (scope: typeof aScope, id: string, name: string, itemId: number) => {
      const saved = (await workspace.listScenarios(scope.projectId)).find(item => item.id === id)!;
      await workspace.saveScenario(scope, scenario(id, name, itemId), {}, saved.updatedAt);
    };
    // A edits X and Z (and shares again with someone else); B edits Y and Z, and adds W.
    await edit(aScope, "x", "X", 1); await edit(aScope, "z", "Z", 1);
    await workspace.exportProject(original.id);
    await edit(bScope, "y", "Y", 2); await edit(bScope, "z", "Z", 2);
    await workspace.saveScenario(bScope, scenario("w", "W"), {});

    // B's file back into A: W is new, Y changed only in B, X kept (A's own), Z conflicts.
    const fromB = await workspace.exportProject(copy.id);
    assert.equal(JSON.parse(fromB).origin, original.id);
    const plan = await workspace.planProjectImport(fromB);
    assert.deepEqual(plan.targets.map(target => target.projectId).sort(), [original.id, copy.id].sort());
    const toA = plan.targets.find(target => target.projectId === original.id)!;
    assert.deepEqual({ added: toA.scenarios.added.map(i => i.id), incoming: toA.scenarios.incoming.map(i => i.id), conflicts: toA.scenarios.conflicts.map(i => i.id), mine: toA.scenarios.mine, same: toA.scenarios.same },
      { added: ["w"], incoming: ["y"], conflicts: ["z"], mine: 1, same: 0 });

    // Keeping A's Z: W added, Y applied, X and Z stay A's.
    const merged = await workspace.importProject(fromB, { projectId: original.id, scenarioIds: [], suiteIds: [] });
    assert.deepEqual(merged.merged, { added: 1, updated: 1, kept: 2 });
    const a = Object.fromEntries((await workspace.listScenarios(original.id)).map(item => [item.id, item.source.match(/id: (\d+)/)![1]]));
    assert.deepEqual(a, { x: "1", y: "2", z: "1", w: "7" });
    assert.equal((await workspace.listProjects()).find(p => p.id === original.id)!.environments[0].baseUrls[serverId], "https://a.example.com");

    // After the merge B's version is the common base: the same file again changes nothing,
    // and taking the file side for a conflict overwrites it.
    const again = (await workspace.planProjectImport(fromB)).targets.find(target => target.projectId === original.id)!;
    assert.deepEqual([again.scenarios.added.length, again.scenarios.incoming.length, again.scenarios.conflicts.length], [0, 0, 0]);
    await edit(aScope, "z", "Z", 3);
    await edit(bScope, "z", "Z", 4);
    const conflict = await workspace.exportProject(copy.id);
    assert.deepEqual((await workspace.planProjectImport(conflict)).targets.find(t => t.projectId === original.id)!.scenarios.conflicts.map(i => i.id), ["z"]);
    await workspace.importProject(conflict, { projectId: original.id, scenarioIds: ["z"], suiteIds: [] });
    assert.match((await workspace.listScenarios(original.id)).find(item => item.id === "z")!.source, /id: 4/);

    // A file from another project cannot merge into this one.
    const other = await workspace.importProject(first.replace(original.id, randomUUID()).replace(`"origin": "${original.id}"`, `"origin": "${randomUUID()}"`));
    await assert.rejects(workspace.importProject(first, { projectId: other.project.id, scenarioIds: [], suiteIds: [] }), /같은 프로젝트가 아닙니다/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("share edge cases: long names still number, spec URLs go as written, folder/tag changes merge", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-share-edge-"));
  try {
    const workspace = new ApiWorkspace(dir);
    const serverId = randomUUID(), dev = randomUUID();
    const project = { id: randomUUID(), name: "가".repeat(100), servers: [{ id: serverId, name: "상점" }], environments: [{ id: dev, name: "dev", baseUrls: { [serverId]: "https://a.example.com" } }] };
    await workspace.saveProject(project);
    await workspace.importSpec({ projectId: project.id, environmentId: dev, serverId }, spec);
    await writeFile(path.join(dir, `spec-source-${project.id}-${dev}-${serverId}.json`), JSON.stringify({ url: "https://a.example.com/v3/api-docs?group=shop" }));
    const scope = { projectId: project.id, environmentId: dev };
    await workspace.saveScenario(scope, read, {}, undefined, { groupPath: ["상품"] });

    // Spec URLs go as written (secrets belong in globals, which never leave).
    const file = await workspace.exportProject(project.id);
    assert.equal(JSON.parse(file).specUrls[0].url, "https://a.example.com/v3/api-docs?group=shop");

    // A 100-character name that already exists gets a numbered name within the limit.
    const copy = (await workspace.importProject(file)).project;
    assert.equal(copy.name, `${"가".repeat(96)} (2)`);
    assert.equal((await workspace.importProject(file)).project.name, `${"가".repeat(96)} (3)`);

    // Only the folder changed in the copy: it is an incoming change for the original, and applied.
    await workspace.importSpec({ projectId: copy.id, environmentId: copy.environments[0].id, serverId: copy.servers[0].id }, spec);
    const saved = (await workspace.listScenarios(copy.id))[0];
    await workspace.saveScenario({ projectId: copy.id, environmentId: copy.environments[0].id }, saved.source, {}, saved.updatedAt, { groupPath: ["주문"], tags: ["smoke"] });
    const fromCopy = await workspace.exportProject(copy.id);
    const target = (await workspace.planProjectImport(fromCopy)).targets.find(item => item.projectId === project.id)!;
    assert.deepEqual(target.scenarios.incoming.map(item => item.id), ["shop/read"]);
    await workspace.importProject(fromCopy, { projectId: project.id, scenarioIds: [], suiteIds: [] });
    const merged = (await workspace.listScenarios(project.id))[0];
    assert.deepEqual([merged.groupPath, merged.tags], [["주문"], ["smoke"]]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
