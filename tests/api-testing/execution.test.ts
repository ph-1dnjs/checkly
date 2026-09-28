import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { ApiRunner } from "../../src/app/api-testing/main/execution";
import { parseScenario, scenarioSchema } from "../../src/app/api-testing/shared/scenario";
import { atPointer, resolve } from "../../src/app/api-testing/main/variables";

test("body checks retain default success status unless status is explicitly checked", async () => {
  const server = createServer((_req, res) => { res.statusCode = 400; res.setHeader("content-type", "application/json"); res.end('{"message":"error"}'); });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  try {
    const scenario = scenarioSchema.parse({ version: 1, id: "status-default", name: "기본 검증", steps: [{ id: "first", name: "조회", server: "api", api: { method: "GET", path: "/" }, expect: [{ source: "body", pointer: "/message", operator: "exists" }] }] });
    const options = { projectId: "test", environment: "dev", servers: { api: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` } } };
    const failed = await new ApiRunner().run(scenario, options);
    assert.equal(failed.status, "failed");
    // Every check is reported, not just the first failure: automatic 2xx failed, /message passed.
    assert.deepEqual(failed.steps[0].checks, [{ passed: false, actual: "400" }, { expect: 0, passed: true }]);
    scenario.steps[0].expect!.push({ source: "status", operator: "equals", value: 400 });
    scenario.steps[0].expect!.push({ source: "body", pointer: "/message", operator: "equals", value: "ok" });
    const mixed = await new ApiRunner().run(scenario, options);
    assert.equal(mixed.status, "failed");
    assert.deepEqual(mixed.steps[0].checks, [{ expect: 0, passed: true }, { expect: 1, passed: true }, { expect: 2, passed: false, actual: '"error"' }]);
    scenario.steps[0].expect!.pop();
    assert.equal((await new ApiRunner().run(scenario, options)).status, "passed");
  } finally { await new Promise<void>(r => server.close(() => r())); }
});

test("YAML validation and typed references", () => {
  assert.throws(() => parseScenario("version: 1\nversion: 2"));
  assert.throws(() => parseScenario("version: 9"));
  const ctx = { inputs: {}, vars: { id: 42, nested: [1, true] }, globals: {} };
  assert.equal(resolve("{{vars.id}}", ctx), 42);
  assert.deepEqual(resolve("{{vars.nested}}", ctx), [1, true]);
  assert.throws(() => resolve("{{vars.missing}}", ctx));
  assert.throws(() => resolve("prefix {{vars.nested}}", ctx));
  assert.equal(atPointer({ "a/b": { "~": null } }, "/a~1b/~0"), null);
  assert.equal(atPointer({}, "/missing"), undefined);
});

test("scenario bearer default, step override and no-auth use current globals", async () => {
  const observed: Array<string | undefined> = [];
  const server = createServer((req, res) => {
    observed.push(req.headers.authorization);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ token: "fresh-token" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const scenario = parseScenario(`name: 인증 혼합\nserver: api\nauth: globals.memberToken\nsteps:\n  - api: GET /member\n  - api: GET /admin\n    auth: globals.adminToken\n  - api: GET /public\n    auth: none\n  - api: GET /refresh\n    auth: none\n    extract:\n      - { source: body, pointer: /token, target: globals.memberToken }\n  - api: GET /member-again\n`);
    const runner = new ApiRunner();
    runner.globals.commit("auth-test", { memberToken: "old-token", adminToken: "admin-token" });
    const options = { projectId: "auth-test", environment: "dev", servers: { api: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` } } };
    assert.equal((await runner.run(scenario, options)).status, "passed");
    assert.deepEqual(observed, ["Bearer old-token", "Bearer admin-token", undefined, undefined, "Bearer fresh-token"]);
    scenario.steps[0].request.headers = { Authorization: "manual" };
    assert.equal((await runner.run(scenario, options)).steps[0].status, "failed");
    scenario.steps[0].request.headers = undefined;
    runner.globals.delete("auth-test", "memberToken");
    assert.equal((await runner.run(scenario, options)).steps[0].status, "blocked");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("two servers, step 2 to step 6, global reuse and project isolation", async () => {
  const seen: string[] = [];
  const server = (role: string) => createServer(async (req, res) => {
    seen.push(`${role} ${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    if (req.url === "/auth/login") { res.end(JSON.stringify({ accessToken: `${role}-secret` })); return; }
    assert.equal(req.headers.authorization, `Bearer ${role}-secret`);
    if (req.method === "POST") {
      res.statusCode = 201;
      res.end(JSON.stringify({ id: 42 }));
    } else res.end(JSON.stringify({ answer: { content: "테스트 답변입니다" } }));
  });
  const member = server("member"), admin = server("admin");
  await Promise.all([member, admin].map(s => new Promise<void>(r => s.listen(0, "127.0.0.1", r))));
  const address = (s: typeof member) => `http://127.0.0.1:${(s.address() as { port: number }).port}`;
  try {
    const source = readFileSync("docs/04-pages/070-api-testing/02-userflow.md", "utf8");
    const blocks = [...source.matchAll(/```yaml\n([\s\S]*?)```/g)];
    const scenario = parseScenario(blocks.find(b => b[1].includes("id: inquiry/create-and-answer"))![1]);
    const runner = new ApiRunner();
    const options = { projectId: "shop", environment: "dev", servers: { member: { baseUrl: address(member) }, admin: { baseUrl: address(admin) } }, inputs: { memberLoginId: "a", memberPassword: "secret", adminLoginId: "b", adminPassword: "secret" } };
    const result = await runner.run(scenario, options);
    assert.equal(result.status, "passed");
    assert.equal(result.steps.length, 6);
    assert.ok(seen.includes("admin POST /inquiries/42/answers"));
    assert.ok(seen.includes("member GET /inquiries/42"));
    assert.equal(JSON.stringify(result).includes("secret"), false);
    const single = scenarioSchema.parse({ version: 1, id: "reuse", name: "재사용", steps: [{ id: "read", name: "조회", server: "member", api: { method: "GET", path: "/inquiries" }, request: { headers: { Authorization: "Bearer {{globals.memberAccessToken}}" } } }] });
    assert.equal((await runner.run(single, options)).status, "passed");
    assert.equal((await runner.run(single, { ...options, projectId: "other" })).status, "blocked");
    assert.equal((await runner.run(single, { ...options, environment: "stg" })).status, "passed");
    single.steps[0].request.pathParams = { id: "{{vars.inquiryId}}" };
    assert.equal((await runner.run(single, options)).status, "blocked");
    const bad = scenarioSchema.parse({ ...single, steps: [{ id: "login", name: "로그인", server: "member", api: { method: "POST", path: "/auth/login" }, extract: [{ source: "body", pointer: "/accessToken", target: "globals.partial" }, { source: "body", pointer: "/absent", target: "vars.absent" }] }] });
    assert.equal((await runner.run(bad, options)).status, "failed");
    assert.equal(runner.globals.snapshot("shop").partial, undefined);
  } finally {
    await Promise.all([member, admin].map(s => new Promise<void>((resolve, reject) => { s.closeAllConnections(); s.close(e => e ? reject(e) : resolve()); })));
  }
});

test("step input waits for a value and exposes it only through vars", async () => {
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    res.setHeader("content-type", "application/json");
    if (req.url === "/send") { res.end(JSON.stringify({ sent: true })); return; }
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { code: "123456" });
    res.end(JSON.stringify({ verified: true }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const scenario = scenarioSchema.parse({ version: 1, id: "otp", name: "SMS 인증", steps: [
      { id: "send", name: "인증번호 발송", server: "api", api: { method: "POST", path: "/send" } },
      { id: "verify", name: "인증번호 확인", server: "api", api: { method: "POST", path: "/verify" }, input: { name: "phoneCode", label: "SMS 인증번호", sensitive: true }, request: { body: { code: "{{vars.phoneCode}}" } } },
    ] });
    const prompts: string[] = [];
    const result = await new ApiRunner().run(scenario, {
      projectId: "otp-project", environment: "local", runId: "otp-run",
      servers: { api: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` } },
      requestInput: async request => { prompts.push(`${request.stepId}:${request.name}`); return "123456"; },
    });
    assert.equal(result.status, "passed");
    assert.deepEqual(prompts, ["verify:phoneCode"]);
    assert.deepEqual(seen, ["POST /send", "POST /verify"]);
    assert.deepEqual(result.steps[1].input, { name: "phoneCode", provided: true });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("a step can wait for multiple runtime inputs", async () => {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { loginId: "user@example.com", password: "one-time" });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ verified: true }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const scenario = scenarioSchema.parse({ version: 1, id: "multiple-inputs", name: "여러 입력", steps: [{
      id: "login", name: "로그인", server: "api", api: { method: "POST", path: "/login" },
      inputs: [
        { name: "loginId", label: "로그인 ID", sensitive: false },
        { name: "password", label: "비밀번호", sensitive: true },
      ],
      request: { body: { loginId: "{{vars.loginId}}", password: "{{vars.password}}" } },
    }] });
    const prompts: string[] = [];
    const result = await new ApiRunner().run(scenario, {
      projectId: "multiple-inputs", environment: "local", runId: "multiple-inputs-run",
      servers: { api: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` } },
      requestInput: async request => { prompts.push(request.name); return request.name === "loginId" ? "user@example.com" : "one-time"; },
    });
    assert.equal(result.status, "passed");
    assert.deepEqual(prompts, ["loginId", "password"]);
    assert.deepEqual(result.steps[0].inputs, [{ name: "loginId", provided: true }, { name: "password", provided: true }]);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("scenario bindings can reuse request and response values from any earlier step", async () => {
  const server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/seed")) { res.setHeader("x-trace", "trace-value"); res.end(JSON.stringify({ token: "response-value" })); return; }
    assert.equal(req.url, "/consume?seed=request-value");
    assert.equal(req.headers["x-token"], "response-value");
    assert.equal(req.headers["x-trace"], "trace-value");
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const scenario = scenarioSchema.parse({ version: 1, id: "all-sources", name: "요청·응답 재사용", valueBindings: [
      { name: "seed", step: "seed", source: "request", area: "query", pointer: "/seed" },
      { name: "token", step: "seed", source: "response", area: "body", pointer: "/token" },
      { name: "trace", step: "seed", source: "response", area: "header", header: "X-Trace" },
    ], steps: [
      { id: "seed", name: "값 준비", server: "api", api: { method: "GET", path: "/seed" }, request: { query: { seed: "request-value" } } },
      { id: "consume", name: "값 사용", server: "api", api: { method: "GET", path: "/consume" }, request: { query: { seed: "{{vars.seed}}" }, headers: { "X-Token": "{{vars.token}}", "X-Trace": "{{vars.trace}}" } } },
    ] });
    const result = await new ApiRunner().run(scenario, { projectId: "all-sources", environment: "local", servers: { api: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` } } });
    assert.equal(result.status, "passed");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("resolved requests are reported and body binding type errors explain the selected path", async () => {
  let verifyCalls = 0;
  const server = createServer(async (req, res) => {
    if (req.url === "/login") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: { challengeToken: "challenge-value" } }));
      return;
    }
    verifyCalls++;
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const scenario = scenarioSchema.parse({ version: 1, id: "request-trace", name: "요청 추적", valueBindings: [
      { name: "challengeToken", step: "login", source: "response", area: "body", pointer: "/data", sensitive: true },
    ], steps: [
      { id: "login", name: "로그인", server: "api", api: { method: "GET", path: "/login" } },
      { id: "verify", name: "확인", server: "api", api: { operationId: "verify" }, request: { body: { challengeToken: "{{vars.challengeToken}}" } } },
    ] });
    const traces: Array<{ method: string; url: string; body?: unknown }> = [];
    const result = await new ApiRunner().run(scenario, {
      projectId: "request-trace", environment: "local", servers: { api: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` } },
      resolveOperation: () => ({ method: "POST", path: "/verify", bodySchema: { type: "object", properties: { challengeToken: { type: "string" } }, required: ["challengeToken"] } }),
      onRequest: request => traces.push({ method: request.method, url: request.url, body: request.body }),
    });
    assert.equal(result.status, "failed");
    assert.equal(verifyCalls, 0);
    assert.equal(traces.length, 2);
    assert.equal(traces[1].method, "POST");
    assert.deepEqual(traces[1].body, { challengeToken: { challengeToken: "challenge-value" } });
    assert.match(result.steps[1].error!, /body\.challengeToken는 string이어야 하지만 현재 object/);
    assert.match(result.steps[1].error!, /\/data\/challengeToken/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("cancellation, timeout and stop/continue do not dispatch dependent requests", async () => {
  let calls = 0;
  const server = createServer((_req, res) => { calls++; res.writeHead(200); res.flushHeaders(); });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const options = { projectId: "p", environment: "dev", timeoutMs: 30, servers: { api: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` } } };
  const scenario = scenarioSchema.parse({ version: 1, id: "slow", name: "시간 초과", steps: [1, 2].map(i => ({ id: String(i), name: "단계", server: "api", api: { method: "GET", path: "/" } })) });
  try {
    const runner = new ApiRunner();
    const result = await runner.run(scenario, options);
    assert.deepEqual(result.steps.map(s => s.status), ["failed", "skipped"]);
    assert.equal(calls, 1);
    assert.equal((await runner.run(scenario, { ...options, signal: AbortSignal.abort() })).status, "cancelled");
    assert.equal(calls, 1);
    const release = runner.globals.acquire("p");
    await assert.rejects(runner.run(scenario, options), /이미 실행/);
    // Globals are project-wide, so another environment of the same project is blocked too.
    await assert.rejects(runner.run(scenario, { ...options, environment: "stg" }), /이미 실행/);
    release();
    scenario.onFailure = "continue";
    scenario.steps[1].request.query = { id: "{{vars.absent}}" };
    assert.deepEqual((await runner.run(scenario, options)).steps.map(s => s.status), ["failed", "blocked"]);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});

test("a body left on a GET step fails with a clear message before any request", async () => {
  let hits = 0;
  const server = createServer((_req, res) => { hits++; res.end("{}"); });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  try {
    const scenario = scenarioSchema.parse({ version: 1, id: "get-body", name: "본문 남음", steps: [{ id: "first", name: "조회", server: "api", api: { method: "GET", path: "/" }, request: { body: { loginId: "a" } } }] });
    const result = await new ApiRunner().run(scenario, { projectId: "test", environment: "dev", servers: { api: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` } } });
    assert.equal(result.steps[0].status, "failed");
    assert.match(result.steps[0].error ?? "", /GET 요청에는 본문을 보낼 수 없습니다/);
    assert.equal(hits, 0);
  } finally { await new Promise<void>(r => server.close(() => r())); }
});

test("a value missing for a response save says where it was looked for", async () => {
  const server = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end('{"data":{}}'); });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  try {
    const scenario = scenarioSchema.parse({ version: 1, id: "extract-missing", name: "저장 실패", steps: [{ id: "first", name: "조회", server: "api", api: { method: "GET", path: "/" }, extract: [{ source: "body", pointer: "/data/token", target: "globals.token" }] }] });
    const result = await new ApiRunner().run(scenario, { projectId: "test", environment: "dev", servers: { api: { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` } } });
    assert.equal(result.steps[0].status, "failed");
    assert.equal(result.steps[0].error, "응답 저장 실패: 응답 본문 /data/token에서 globals.token에 저장할 값을 찾지 못했습니다.");
  } finally { await new Promise<void>(r => server.close(() => r())); }
});
