import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { parseScenario } from "../../src/app/api-testing/shared/scenario";

test("server names persist, rename with YAML, and reject stale saves", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-server-names-"));
  try {
    const workspace = new ApiWorkspace(dir);
    const projectId = randomUUID(), serverId = randomUUID(), environmentId = randomUUID();
    const scope = { projectId, serverId, environmentId };
    const project = { id: projectId, name: "test", servers: [{ id: serverId, name: "백엔드" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "https://example.invalid" } }] };
    await workspace.saveProject(project);
    await workspace.importSpec(scope, JSON.stringify({ openapi: "3.0.3", info: { title: "test", version: "1" }, paths: { "/test": { get: { responses: { "200": { description: "OK" } } } } } }));
    const source = "id: test\nname: test\nserver: 백엔드\nsteps:\n  - api: GET /test\n";
    assert.deepEqual((await workspace.previewScenario(scope, source, {})).issues, []);
    const saved = await workspace.saveScenario(scope, source, {});
    assert.equal(parseScenario(saved.source).steps[0].server, "백엔드");
    await workspace.saveProject({ ...project, servers: [{ id: serverId, name: "메인 API" }] });
    const renamed = (await workspace.listScenarios(projectId))[0];
    assert.equal(parseScenario(renamed.source).steps[0].server, "메인 API");
    assert.deepEqual((await workspace.previewScenario(scope, renamed.source, {})).issues, []);
    await assert.rejects(workspace.saveScenario(scope, renamed.source, {}, saved.updatedAt), /최신/);
    const duplicateId = randomUUID();
    await assert.rejects(workspace.saveProject({ ...project, servers: [...project.servers, { id: duplicateId, name: "백엔드" }], environments: [{ ...project.environments[0], baseUrls: { [serverId]: "https://example.invalid", [duplicateId]: "https://example.invalid" } }] }), /중복/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
