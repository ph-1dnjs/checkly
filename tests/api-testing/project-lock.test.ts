import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";

test("a running request blocks every environment of the same project but not other projects", async () => {
  let releaseResponse: () => void = () => {};
  const held = new Promise<void>(resolve => { releaseResponse = resolve; });
  let first = true;
  const server = createServer(async (_req, res) => {
    if (first) { first = false; await held; }
    res.setHeader("content-type", "application/json");
    res.end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-lock-"));
  try {
    const workspace = new ApiWorkspace(dir);
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const serverId = randomUUID(), dev = randomUUID(), stg = randomUUID();
    const project = { id: randomUUID(), name: "잠금", servers: [{ id: serverId, name: "회원" }], environments: [{ id: dev, name: "dev", baseUrls: { [serverId]: url } }, { id: stg, name: "stg", baseUrls: { [serverId]: url } }] };
    const other = { ...project, id: randomUUID() };
    await workspace.saveProject(project);
    await workspace.saveProject(other);
    const spec = JSON.stringify({ openapi: "3.0.3", info: { title: "잠금", version: "1" }, paths: { "/ping": { get: { responses: { "200": { description: "성공" } } } } } });
    const devScope = { projectId: project.id, serverId, environmentId: dev };
    const stgScope = { ...devScope, environmentId: stg };
    const otherScope = { ...devScope, projectId: other.id };
    for (const scope of [devScope, stgScope, otherScope]) await workspace.importSpec(scope, spec);

    const running = workspace.execute(devScope, "GET /ping", {});
    await new Promise(resolve => setTimeout(resolve, 50));
    await assert.rejects(workspace.execute(stgScope, "GET /ping", {}), /이미/);
    await assert.rejects(workspace.setGlobal({ projectId: project.id }, "accessToken", "t"), /실행 중/);
    assert.equal((await workspace.execute(otherScope, "GET /ping", {})).status, "passed");
    releaseResponse();
    assert.equal((await running).status, "passed");
    assert.equal((await workspace.execute(stgScope, "GET /ping", {})).status, "passed");
  } finally {
    releaseResponse();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
