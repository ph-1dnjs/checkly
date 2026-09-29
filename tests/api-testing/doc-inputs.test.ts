import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { docInputFromRequest } from "../../src/app/api-testing/shared/doc-inputs";

test("docs inputs keep plain values and drop secrets (body keys stay, emptied)", () => {
  assert.deepEqual(docInputFromRequest({
    pathParams: { id: 7 }, query: { page: 2, accessToken: "q-secret", empty: "" },
    headers: { Authorization: "Bearer h-secret", "X-Trace": "abc", "x-api-key": "k-secret" }, cookies: { sessionId: "c-secret", theme: "dark" },
    body: { loginId: "tester", password: "b-secret", profile: { nick: "a", refreshToken: "r-secret" }, items: [{ otpCode: "1", qty: 2 }] },
  }), {
    pathParams: { id: 7 }, query: { page: 2 }, headers: { "X-Trace": "abc" }, cookies: { theme: "dark" },
    body: { loginId: "tester", password: "", profile: { nick: "a", refreshToken: "" }, items: [{ otpCode: "", qty: 2 }] },
  });
  assert.equal(docInputFromRequest({ headers: { Authorization: "Bearer x" }, query: {} }), undefined);
});

test("executing from the docs remembers inputs per server for the whole project, and they can be forgotten", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-doc-inputs-"));
  const server = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end("{}"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const workspace = new ApiWorkspace(dir);
    const projectId = randomUUID(), apiId = randomUUID(), authId = randomUUID(), dev = randomUUID(), stage = randomUUID();
    const project = { id: projectId, name: "Docs", servers: [{ id: apiId, name: "API" }, { id: authId, name: "Auth" }], environments: [{ id: dev, name: "dev", baseUrls: { [apiId]: baseUrl, [authId]: baseUrl } }, { id: stage, name: "stage", baseUrls: { [apiId]: baseUrl, [authId]: baseUrl } }] };
    await workspace.saveProject(project);
    const spec = JSON.stringify({ openapi: "3.0.3", info: { title: "t", version: "1" }, paths: {
      "/items/{id}": { get: { parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } } },
      "/login": { post: { requestBody: { content: { "application/json": { schema: { type: "object", properties: { loginId: { type: "string" }, password: { type: "string" } } } } } }, responses: { "200": { description: "OK" } } } },
    } });
    for (const environmentId of [dev, stage]) for (const serverId of [apiId, authId]) await workspace.importSpec({ projectId, environmentId, serverId }, spec);
    const devApi = { projectId, environmentId: dev, serverId: apiId };

    await workspace.execute(devApi, "GET /items/{id}", { pathParams: { id: 7 } });
    await workspace.execute(devApi, "POST /login", { body: { loginId: "tester", password: "secret-pw" } });
    const expected = { "GET /items/{id}": { pathParams: { id: 7 } }, "POST /login": { body: { loginId: "tester", password: "" } } };
    assert.deepEqual(await workspace.getDocInputs(devApi), expected);
    // Project-wide like globals: another environment sees them, another server does not.
    assert.deepEqual(await workspace.getDocInputs({ ...devApi, environmentId: stage }), expected);
    assert.deepEqual(await workspace.getDocInputs({ ...devApi, serverId: authId }), {});

    await workspace.forgetDocInput(devApi, "POST /login");
    assert.deepEqual(await workspace.getDocInputs(devApi), { "GET /items/{id}": { pathParams: { id: 7 } } });

    // Removing a server drops its inputs; deleting the project drops the file.
    await workspace.execute({ ...devApi, serverId: authId }, "GET /items/{id}", { pathParams: { id: 1 } });
    await workspace.saveProject({ ...project, servers: [project.servers[0]], environments: project.environments.map(env => ({ ...env, baseUrls: { [apiId]: baseUrl } })) });
    assert.deepEqual(Object.keys(await workspace.getDocInputs(devApi)), ["GET /items/{id}"]);
    await workspace.deleteProject(projectId);
    await assert.rejects(workspace.getDocInputs(devApi));
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
