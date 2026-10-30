import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import type { FileStore, ScenarioRename } from "../../src/app/api-testing/main/store";
import { parseScenario } from "../../src/app/api-testing/shared/scenario";

const spec = JSON.stringify({ openapi: "3.0.3", info: { title: "test", version: "1" }, paths: { "/test": { get: { responses: { "200": { description: "OK" } } } } } });

async function setup(dir: string) {
  const workspace = new ApiWorkspace(dir);
  const projectId = randomUUID(), serverId = randomUUID(), otherServer = randomUUID(), dev = randomUUID(), stg = randomUUID();
  const baseUrls = { [serverId]: "https://example.invalid", [otherServer]: "https://other.invalid" };
  const project = { id: projectId, name: "test", servers: [{ id: serverId, name: "백엔드" }, { id: otherServer, name: "결제" }], environments: [{ id: dev, name: "dev", baseUrls }, { id: stg, name: "stg", baseUrls }] };
  await workspace.saveProject(project);
  const scope = { projectId, serverId, environmentId: dev };
  await workspace.importSpec(scope, spec);
  return { workspace, project, scope, serverId, otherServer, dev, stg };
}

test("project changes: scenarios follow renamed servers and environments; only listed environments block removal", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-settings-change-"));
  try {
    const { workspace, project, scope, serverId, otherServer, dev, stg } = await setup(dir);
    await workspace.saveScenario(scope, "id: test\nname: 조회\nserver: 백엔드\nenvironments: [dev]\nsteps:\n  - api: GET /test\n", {});
    await workspace.saveProject({ ...project, environments: project.environments.map(e => e.id === dev ? { ...e, name: "develop" } : e) });
    const item = (await workspace.listScenarios(project.id))[0];
    assert.deepEqual(parseScenario(item.source).environments, ["develop"]);
    assert.deepEqual((await workspace.previewScenario(scope, item.source, {})).issues, []);
    const renamed = (await workspace.listProjects())[0];
    const without = (id: string) => ({ servers: renamed.servers.filter(s => s.id !== id), environments: renamed.environments.map(e => ({ ...e, baseUrls: Object.fromEntries(Object.entries(e.baseUrls).filter(([key]) => key !== id)) })) });
    // Listed environment and used server: refused. Unlisted environment and unused server: removed.
    await assert.rejects(workspace.saveProject({ ...renamed, environments: renamed.environments.filter(e => e.id !== dev) }), /시나리오 참조를 먼저 정리하세요: 조회/);
    await assert.rejects(workspace.saveProject({ ...renamed, ...without(serverId) }), /조회/);
    await workspace.saveProject({ ...renamed, ...without(otherServer), environments: without(otherServer).environments.filter(e => e.id !== stg) });
    assert.deepEqual((await workspace.listProjects())[0].environments.map(e => e.name), ["develop"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("settings screen save: checks before saving, rewrites scenarios after", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-settings-screen-"));
  try {
    const { workspace, project, scope, serverId } = await setup(dir);
    await workspace.saveScenario(scope, "id: test\nname: 조회\nserver: 백엔드\nsteps:\n  - api: GET /test\n", {});
    // Without sign-in it only saves.
    let saves = 0;
    assert.equal(await workspace.saveTeamSettings({ servers: [], environments: [] }, async () => { saves++; return "saved"; }), "saved");
    assert.equal(saves, 1);

    // Signed in: a team store standing on this folder's files, whose rewrites are recorded.
    const files = (workspace as unknown as { files: FileStore }).files;
    const rewrites: ScenarioRename[] = [];
    const team = Object.assign(Object.create(files) as FileStore, { context: { projectId: project.id }, renameScenarios: async (renames: ScenarioRename[]) => { rewrites.push(...renames); } });
    (workspace as unknown as { teamStore: () => unknown }).teamStore = () => team;
    // The settings screen saves the servers itself (\`save\`); here it writes the project file.
    const saveAs = (next: typeof project) => async () => { saves++; await files.saveProject(next, project, []); };
    const environments = project.environments.map(({ id, name }) => ({ id, name }));

    await assert.rejects(workspace.saveTeamSettings({ servers: project.servers.filter(s => s.id !== serverId), environments }, saveAs(project)), /시나리오 참조를 먼저 정리하세요: 조회/);
    assert.equal(saves, 1, "a refused change is not saved");

    const servers = project.servers.map(s => s.id === serverId ? { ...s, name: "메인 API" } : s);
    await workspace.saveTeamSettings({ servers, environments }, saveAs({ ...project, servers }));
    assert.equal(saves, 2);
    assert.equal(rewrites.length, 1);
    assert.equal(parseScenario(rewrites[0].after.source).steps[0].server, "메인 API");

    // Addresses or web endpoints only: saved without reading scenarios.
    await workspace.saveTeamSettings({ servers, environments }, async () => { saves++; });
    assert.equal(saves, 3);
    assert.equal(rewrites.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
