import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";

test("scenario save and server removal apply in call order without a dangling reference", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-save-race-"));
  try {
    const workspace = new ApiWorkspace(dir);
    const memberId = randomUUID(), orderId = randomUUID(), dev = randomUUID();
    const url = "http://127.0.0.1:1";
    const project = { id: randomUUID(), name: "경쟁", servers: [{ id: memberId, name: "회원" }, { id: orderId, name: "주문" }], environments: [{ id: dev, name: "dev", baseUrls: { [memberId]: url, [orderId]: url } }] };
    await workspace.saveProject(project);
    const spec = JSON.stringify({ openapi: "3.0.3", info: { title: "주문", version: "1" }, paths: { "/orders": { get: { responses: { "200": { description: "성공" } } } } } });
    await workspace.importSpec({ projectId: project.id, serverId: orderId, environmentId: dev }, spec);
    const yaml = "version: 1\nid: orders\nname: 주문 조회\nsteps:\n  - { id: list, server: 주문, api: { method: GET, path: /orders } }\n";

    // Issued back to back: the save validates against the project that still has 주문,
    // so the server removal must see the saved scenario and refuse.
    const saving = workspace.saveScenario({ projectId: project.id, environmentId: dev }, yaml, {});
    const removing = workspace.saveProject({ ...project, servers: [project.servers[0]], environments: [{ id: dev, name: "dev", baseUrls: { [memberId]: url } }] });
    const [saved, removed] = await Promise.allSettled([saving, removing]);

    assert.equal(saved.status, "fulfilled");
    assert.equal(removed.status, "rejected");
    assert.match((removed as PromiseRejectedResult).reason.message, /시나리오 참조를 먼저 정리/);
    assert.equal((await workspace.listProjects())[0].servers.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
