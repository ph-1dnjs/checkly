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
    assert.equal((await new ApiRunner().run(scenario, options)).status, "failed");
    scenario.steps[0].expect!.push({ source: "status", operator: "equals", value: 400 });
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

test("two servers, step 2 to step 6, global reuse and project/environment isolation", async () => {
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
    const source = readFileSync("docs/04-pages/060-api-testing/02-userflow.md", "utf8");
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
    assert.equal((await runner.run(single, { ...options, environment: "stg" })).status, "blocked");
    single.steps[0].request.pathParams = { id: "{{vars.inquiryId}}" };
    assert.equal((await runner.run(single, options)).status, "blocked");
    const bad = scenarioSchema.parse({ ...single, steps: [{ id: "login", name: "로그인", server: "member", api: { method: "POST", path: "/auth/login" }, extract: [{ source: "body", pointer: "/accessToken", target: "globals.partial" }, { source: "body", pointer: "/absent", target: "vars.absent" }] }] });
    assert.equal((await runner.run(bad, options)).status, "failed");
    assert.equal(runner.globals.snapshot("shop", "dev").partial, undefined);
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
    const release = runner.globals.acquire("p", "dev");
    await assert.rejects(runner.run(scenario, options), /이미 실행/);
    release();
    scenario.onFailure = "continue";
    scenario.steps[1].request.query = { id: "{{vars.absent}}" };
    assert.deepEqual((await runner.run(scenario, options)).steps.map(s => s.status), ["failed", "blocked"]);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
});
