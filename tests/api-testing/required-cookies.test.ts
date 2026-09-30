import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";

const requiredCookie = { name: "deviceId", in: "cookie", required: true, schema: { type: "string" } };
const responses = { "200": { description: "OK" } };
const spec = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Required session cookies", version: "1" },
  paths: {
    "/login": { post: { responses } },
    "/session": { get: { parameters: [requiredCookie], responses } },
    "/accounts/{id}/session": {
      get: {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          requiredCookie,
        ],
        responses,
      },
    },
  },
});

async function cookieWorkspace(t: TestContext, options: {
  loginBaseUrl?: string;
  targetBaseUrl?: string;
  setCookies?: string[];
} = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-required-cookie-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const workspace = new ApiWorkspace(dir);
  const projectId = randomUUID(), loginServerId = randomUUID(), serverId = randomUUID(), environmentId = randomUUID();
  const project = {
    id: projectId,
    name: "Required cookie test",
    servers: [{ id: loginServerId, name: "auth" }, { id: serverId, name: "api" }],
    environments: [{ id: environmentId, name: "dev", baseUrls: {
      [loginServerId]: options.loginBaseUrl ?? "https://api.example.test",
      [serverId]: options.targetBaseUrl ?? "https://api.example.test",
    } }],
  };
  const scope = { projectId, serverId, environmentId };
  await workspace.saveProject(project);
  await workspace.importSpec({ ...scope, serverId: loginServerId }, spec);
  await workspace.importSpec(scope, spec);

  const requests: Array<{ url: string; cookie: string | null }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push({ url: url.toString(), cookie: new Headers(init?.headers).get("cookie") });
    const headers = new Headers({ "content-type": "application/json" });
    if (url.pathname.endsWith("/login")) {
      for (const cookie of options.setCookies ?? ["deviceId=session-device; Path=/; HttpOnly"])
        headers.append("set-cookie", cookie);
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  });

  const login = async () => {
    const result = await workspace.runScenario(scope, "name: Acquire session cookie\nserver: auth\nsteps:\n  - api: POST /login\n", {}, {});
    assert.equal(result.status, "passed");
    assert.deepEqual(result.steps.map(step => step.status), ["passed"]);
  };
  return { workspace, scope, project, requests, login };
}

test("a cookie acquired by a scenario satisfies a required cookie in Swagger execute", async t => {
  const { workspace, scope, requests, login } = await cookieWorkspace(t);
  await login();

  const result = await workspace.execute(scope, "GET /session", {});
  assert.equal(result.status, "passed");
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(requests, [
    { url: "https://api.example.test/login", cookie: null },
    { url: "https://api.example.test/session", cookie: "deviceId=session-device" },
  ]);

  const scenario = await workspace.runScenario(scope, "name: Reuse session cookie\nserver: api\nsteps:\n  - api: GET /session\n", {}, {});
  assert.equal(scenario.status, "passed");
  assert.equal(requests.at(-1)?.cookie, "deviceId=session-device");
});

test("explicit cookie values take precedence over a stored session cookie", async t => {
  const { workspace, scope, requests, login } = await cookieWorkspace(t);
  await login();
  await workspace.setGlobal({ projectId: scope.projectId }, "manualDevice", "manual-device");

  const result = await workspace.execute(scope, "GET /session", { cookies: { deviceId: "{{globals.manualDevice}}" } });
  assert.equal(result.status, "passed");
  assert.equal(requests.at(-1)?.cookie, "deviceId=manual-device");

  const before = requests.length;
  await assert.rejects(workspace.execute(scope, "GET /session", { cookies: { deviceId: "" } }), /필수 입력.*deviceId/);
  assert.equal(requests.length, before, "an explicitly empty required cookie must not fall back to the jar");
});

test("required cookie matching uses the resolved encoded path and base URL prefix", async t => {
  const { workspace, scope, requests, login } = await cookieWorkspace(t, {
    loginBaseUrl: "https://api.example.test/gateway/v1/",
    targetBaseUrl: "https://api.example.test/gateway/v1/",
    setCookies: ["deviceId=scoped-device; Path=/gateway/v1/accounts/team%2Falpha; Secure"],
  });
  await login();
  await workspace.setGlobal({ projectId: scope.projectId }, "accountId", "team/alpha");

  const result = await workspace.execute(scope, "GET /accounts/{id}/session", { pathParams: { id: "{{globals.accountId}}" } });
  assert.equal(result.status, "passed");
  assert.deepEqual(requests.at(-1), {
    url: "https://api.example.test/gateway/v1/accounts/team%2Falpha/session",
    cookie: "deviceId=scoped-device",
  });

  await workspace.setGlobal({ projectId: scope.projectId }, "accountId", "team/beta");
  const before = requests.length;
  await assert.rejects(workspace.execute(scope, "GET /accounts/{id}/session", { pathParams: { id: "{{globals.accountId}}" } }), /필수 입력.*deviceId/);
  assert.equal(requests.length, before, "a cookie for another resolved path must not satisfy preflight");
});

test("a Domain cookie can satisfy the required parameter on a sibling host", async t => {
  const { workspace, scope, requests, login } = await cookieWorkspace(t, {
    loginBaseUrl: "https://auth.example.test",
    targetBaseUrl: "https://api.example.test",
    setCookies: ["deviceId=shared-device; Domain=.example.test; Path=/; Secure"],
  });
  await login();
  assert.equal((await workspace.execute(scope, "GET /session", {})).status, "passed");
  assert.deepEqual(requests.at(-1), { url: "https://api.example.test/session", cookie: "deviceId=shared-device" });
});

test("missing, expired and URL-inapplicable cookies block before HTTP", async t => {
  const cases = [
    { name: "no cookie", setCookies: [] },
    { name: "expired cookie", setCookies: ["deviceId=expired-device; Path=/; Max-Age=1"], expire: true },
    { name: "host-only cookie on another host", loginBaseUrl: "https://auth.example.test", setCookies: ["deviceId=host-device; Path=/"] },
    { name: "cookie outside its path", setCookies: ["deviceId=path-device; Path=/auth"] },
    { name: "Secure cookie on HTTP", targetBaseUrl: "http://api.example.test", setCookies: ["deviceId=secure-device; Path=/; Secure"] },
  ];
  for (const example of cases) {
    await t.test(example.name, async t => {
      const { workspace, scope, requests, login } = await cookieWorkspace(t, example);
      await login();
      if (example.expire) {
        const expiredAt = Date.now() + 2_000;
        t.mock.method(Date, "now", () => expiredAt);
      }
      const before = requests.length;
      await assert.rejects(workspace.execute(scope, "GET /session", {}), /필수 입력.*deviceId/);
      assert.equal(requests.length, before, "the required-cookie failure must not send the API request");
    });
  }
});

test("a session cookie from another project cannot satisfy required cookie preflight", async t => {
  const { workspace, scope, project, requests, login } = await cookieWorkspace(t);
  await login();
  const other = { ...project, id: randomUUID(), name: "Isolated cookie project" };
  await workspace.saveProject(other);
  const otherScope = { ...scope, projectId: other.id };
  await workspace.importSpec(otherScope, spec);

  const before = requests.length;
  await assert.rejects(workspace.execute(otherScope, "GET /session", {}), /필수 입력.*deviceId/);
  assert.equal(requests.length, before);
  assert.equal((await workspace.execute(scope, "GET /session", {})).status, "passed");
  assert.equal(requests.at(-1)?.cookie, "deviceId=session-device");
});
