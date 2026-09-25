import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";

test("preflight reports missing globals without preventing storage and allows earlier extraction", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-preflight-"));
  try {
    const workspace = new ApiWorkspace(dir);
    const projectId = randomUUID(), serverId = randomUUID(), environmentId = randomUUID();
    const scope = { projectId, serverId, environmentId };
    await workspace.saveProject({ id: projectId, name: "test", servers: [{ id: serverId, name: "api" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "https://example.invalid" } }] });
    await workspace.importSpec(scope, JSON.stringify({ openapi: "3.0.3", info: { title: "test", version: "1" }, paths: { "/test": { get: { responses: { "200": { description: "OK" } } } } } }));
    const source = `version: 1\nid: test\nname: test\nsteps:\n  - id: use\n    server: ${serverId}\n    api: { method: GET, path: /test }\n    request: { headers: { Authorization: '{{globals.token}}' } }\n`;
    const missing = await workspace.previewScenario(scope, source, {});
    assert.equal(missing.issues.length, 0);
    assert.match(missing.executionIssues!.join(), /1단계.*token/);
    await workspace.saveScenario(scope, source, {});
    await assert.rejects(workspace.runScenario(scope, source, {}, {}), /token/);
    const produced = source.replace("steps:\n", `steps:\n  - id: produce\n    server: ${serverId}\n    api: { method: GET, path: /test }\n    extract: [{ source: body, pointer: /token, target: globals.token }]\n`);
    assert.deepEqual((await workspace.previewScenario(scope, produced, {})).executionIssues, []);
    await workspace.setGlobal({ projectId }, "token", "secret-value");
    assert.deepEqual((await workspace.previewScenario(scope, source, {})).executionIssues, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("preflight checks inherited bearer, per-step override and duplicate header", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-auth-preview-"));
  try {
    const workspace = new ApiWorkspace(dir);
    const projectId = randomUUID(), serverId = randomUUID(), environmentId = randomUUID();
    const scope = { projectId, serverId, environmentId };
    await workspace.saveProject({ id: projectId, name: "test", servers: [{ id: serverId, name: "api" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "https://example.invalid" } }] });
    await workspace.importSpec(scope, JSON.stringify({ openapi: "3.0.3", info: { title: "test", version: "1" }, paths: { "/test": { get: { responses: { "200": { description: "OK" } } } } } }));
    const source = `name: auth\nserver: ${serverId}\nauth: globals.memberToken\nsteps:\n  - api: GET /test\n  - api: GET /test\n    auth: globals.adminToken\n  - api: GET /test\n    auth: none\n`;
    const first = await workspace.previewScenario(scope, source, {});
    assert.deepEqual(first.issues, []);
    assert.equal(first.executionIssues?.length, 2);
    await workspace.setGlobal({ projectId }, "memberToken", "member-token");
    await workspace.setGlobal({ projectId }, "adminToken", "admin-token");
    assert.deepEqual((await workspace.previewScenario(scope, source, {})).executionIssues, []);
    const duplicate = source.replace("  - api: GET /test\n    auth: globals.adminToken", "  - api: GET /test\n    auth: globals.adminToken\n    headers: { Authorization: manual }");
    assert.match((await workspace.previewScenario(scope, duplicate, {})).issues.join(), /중복/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
