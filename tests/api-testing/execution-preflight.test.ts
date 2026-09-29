import { test, type TestContext } from "node:test";
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
    const source = `id: test\nname: test\nsteps:\n  - server: ${serverId}\n    api: GET /test\n    headers: { Authorization: '{{globals.token}}' }\n`;
    const missing = await workspace.previewScenario(scope, source, {});
    assert.equal(missing.issues.length, 0);
    assert.match(missing.executionIssues!.join(), /1단계.*token/);
    await workspace.saveScenario(scope, source, {});
    await assert.rejects(workspace.runScenario(scope, source, {}, {}), /token/);
    const produced = source.replace("steps:\n", `steps:\n  - server: ${serverId}\n    api: GET /test\n    extract: [{ pointer: /token, target: globals.token }]\n`);
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

async function bearerWorkspace(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-produced-bearer-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workspace = new ApiWorkspace(dir);
  const projectId = randomUUID(), serverId = randomUUID(), environmentId = randomUUID();
  const scope = { projectId, serverId, environmentId };
  await workspace.saveProject({ id: projectId, name: "test", servers: [{ id: serverId, name: "api" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "https://example.invalid" } }] });
  await workspace.importSpec(scope, JSON.stringify({ openapi: "3.0.3", info: { title: "test", version: "1" }, paths: {
    "/login": { post: { responses: { "200": { description: "OK" } } } },
    "/member": { get: { responses: { "200": { description: "OK" } } } },
    "/admin": { get: { responses: { "200": { description: "OK" } } } },
  } }));
  return { workspace, scope };
}

const producedBearerSource = `name: login then authenticated requests
server: api
auth: globals.memberToken
steps:
  - api: POST /login
    auth: none
    extract:
      - { pointer: /memberToken, target: globals.memberToken }
      - { pointer: /adminToken, target: globals.adminToken }
  - api: GET /member
  - api: GET /admin
    auth: globals.adminToken
`;

test("earlier extractions provide inherited and overridden bearer tokens for preview and execution", async t => {
  for (const staleGlobals of [false, true]) {
    await t.test(staleGlobals ? "replace invalid stored tokens" : "start with no stored tokens", async t => {
      const { workspace, scope } = await bearerWorkspace(t);
      if (staleGlobals) {
        await workspace.setGlobal({ projectId: scope.projectId }, "memberToken", 123);
        await workspace.setGlobal({ projectId: scope.projectId }, "adminToken", "Bearer stale-token");
      }
      const requests: Array<{ url: string; authorization: string | null }> = [];
      t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
        return new Response(JSON.stringify({ memberToken: "fresh-member-token", adminToken: "fresh-admin-token" }), { status: 200 });
      });

      const preview = await workspace.previewScenario(scope, producedBearerSource, {});
      assert.deepEqual(preview.issues, []);
      assert.deepEqual(preview.executionIssues, []);
      const duplicate = producedBearerSource.replace("    auth: globals.adminToken", "    auth: globals.adminToken\n    headers: { Authorization: manual }");
      assert.match((await workspace.previewScenario(scope, duplicate, {})).issues.join(), /중복/);

      const result = await workspace.runScenario(scope, producedBearerSource, {}, {});
      assert.equal(result.status, "passed");
      assert.deepEqual(result.steps.map(step => step.status), ["passed", "passed", "passed"]);
      assert.deepEqual(requests, [
        { url: "https://example.invalid/login", authorization: null },
        { url: "https://example.invalid/member", authorization: "Bearer fresh-member-token" },
        { url: "https://example.invalid/admin", authorization: "Bearer fresh-admin-token" },
      ]);
    });
  }
});

test("preflight still blocks tokens without an earlier producer before sending any request", async t => {
  const { workspace, scope } = await bearerWorkspace(t);
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 200 }));
  const cases = [
    { name: "no producer", steps: "  - api: GET /member\n" },
    { name: "same-step producer", steps: "  - api: GET /member\n    extract: [{ pointer: /token, target: globals.memberToken }]\n" },
    { name: "future producer", steps: "  - api: GET /member\n  - api: POST /login\n    auth: none\n    extract: [{ pointer: /token, target: globals.memberToken }]\n" },
    { name: "invalid stored type", steps: "  - api: GET /member\n", stored: 123 },
    { name: "invalid stored token", steps: "  - api: GET /member\n", stored: "Bearer invalid-token" },
  ];
  for (const example of cases) {
    await workspace.deleteGlobal({ projectId: scope.projectId }, "memberToken");
    if (example.stored !== undefined) await workspace.setGlobal({ projectId: scope.projectId }, "memberToken", example.stored);
    const source = `name: ${example.name}\nserver: api\nauth: globals.memberToken\nsteps:\n${example.steps}`;
    const preview = await workspace.previewScenario(scope, source, {});
    assert.deepEqual(preview.issues, [], example.name);
    assert.equal(preview.executionIssues?.length, 1, example.name);
    assert.match(preview.executionIssues![0], /1단계.*memberToken/, example.name);
    await assert.rejects(workspace.runScenario(scope, source, {}, {}), /memberToken/, example.name);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("an invalid token actually extracted at runtime blocks the authenticated request", async t => {
  const { workspace, scope } = await bearerWorkspace(t);
  let memberToken: string | number = 123;
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    return new Response(JSON.stringify({ memberToken, adminToken: "valid-admin-token" }), { status: 200 });
  });
  for (const token of [123, "Bearer invalid-token"]) {
    memberToken = token;
    const preview = await workspace.previewScenario(scope, producedBearerSource, {});
    assert.deepEqual(preview.issues, []);
    assert.deepEqual(preview.executionIssues, []);
    const before = fetchMock.mock.callCount();
    const result = await workspace.runScenario(scope, producedBearerSource, {}, {});
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.steps.map(step => step.status), ["passed", "blocked", "skipped"]);
    assert.equal(result.steps[1].failure?.kind, "input");
    assert.equal(fetchMock.mock.callCount() - before, 1, "only the unauthenticated login may reach HTTP");
  }
});
