import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { ApiMcpService } from "../../src/app/api-testing/main/mcp/server";
import { McpAutoStart } from "../../src/app/api-testing/main/mcp/auto-start";
import type { ApiMcpRunEvent } from "../../src/app/api-testing/shared/workspace";

const parse = (result: any) => { assert.equal(result.isError, undefined, JSON.stringify(result)); return JSON.parse(result.content[0].text); };
test("MCP: authenticated scoped discovery, authoring, conflicts, runs, cancellation and revocation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "checkly-mcp-"));
  let slow = false;
  const api = createServer((_req, res) => { if (!slow) { res.setHeader("Content-Type", "application/json"); res.end('{"token":"never-export-this"}'); } });
  await new Promise<void>(resolve => api.listen(0, "127.0.0.1", resolve));
  const workspace = new ApiWorkspace(directory);
  const runs: ApiMcpRunEvent[] = [];
  const service = new ApiMcpService(workspace, undefined, { onRun: event => runs.push(event) });
  const client = new Client({ name: "test", version: "1" });
  const projectId = randomUUID(), environmentId = randomUUID(), serverId = randomUUID();
  const scope = { projectId, environmentId, serverId };
  try {
    assert.deepEqual(service.status(), { enabled: false });
    await workspace.saveProject({ id: projectId, name: "MCP", servers: [{ id: serverId, name: "API" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: `http://127.0.0.1:${(api.address() as { port: number }).port}` } }] });
    await workspace.importSpec(scope, JSON.stringify({ openapi: "3.0.3", info: { title: "MCP", version: "1" }, paths: { "/test": { get: { summary: "조회", responses: { "200": { description: "성공" } } } } } }));
    await workspace.setGlobal({ projectId }, "token", "never-export-this");
    await assert.rejects(service.start({ projectId, environmentId: randomUUID() }));
    const connection = await service.start(scopeWithoutServer(scope));
    assert.ok(connection.enabled);
    const headers = { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" };
    assert.equal((await fetch(connection.url, { method: "POST" })).status, 401);
    assert.equal((await fetch(connection.url, { method: "POST", headers: { ...headers, Origin: "https://evil.example" } })).status, 403);
    assert.equal(await new Promise<number | undefined>((resolve, reject) => { const req = request(connection.url, { method: "POST", headers: { ...headers, Host: "evil.example" } }, res => { res.resume(); resolve(res.statusCode); }); req.on("error", reject); req.end(); }), 403);
    assert.equal((await fetch(connection.url, { method: "POST", headers, body: "invalid" })).status, 400);
    assert.equal((await fetch(connection.url, { method: "POST", headers, body: JSON.stringify({ huge: "x".repeat(260_000) }) })).status, 413);
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.url), { requestInit: { headers } }));
    assert.match(client.getInstructions() ?? "", /목적을 한국어 1~2문장/);
    assert.match(client.getInstructions() ?? "", /실제 영향은 빠뜨리지 않습니다/);
    assert.match(client.getInstructions() ?? "", /description: \| 블록/);
    assert.match(client.getInstructions() ?? "", /multipart/);
    assert.match(client.getInstructions() ?? "", /kind: generated/);
    assert.match(client.getInstructions() ?? "", /Content-Type과 boundary/);
    assert.ok((await client.listTools()).tools.some(tool => tool.name === "save_scenario"));
    const call = async (name: string, args = {}) => parse(await client.callTool({ name, arguments: args }));
    const context = await call("get_context");
    assert.equal(context.project.id, projectId);
    assert.ok(!JSON.stringify(context).includes("never-export-this"));
    assert.equal(context.globals.find((item: { name: string }) => item.name === "token").hasValue, true);
    const spec = await call("get_api_spec", { serverId, apis: ["GET /test"] });
    assert.equal(spec.serverId, serverId);
    assert.equal(spec.serverName, "API");
    assert.equal(spec.apis[0].api, "GET /test");
    assert.equal((await client.callTool({ name: "get_api_spec", arguments: { serverId: randomUUID(), apis: ["GET /test"] } })).isError, true);
    const source = "name: MCP 조회\nserver: API\nsteps:\n  - name: 조회\n    api: GET /test\n    expect:\n      - { source: status, operator: equals, value: 200 }\n      - { source: body, pointer: /token, operator: exists }\n      - { source: body, pointer: /missing, operator: exists }\n";
    assert.deepEqual((await call("validate_scenario", { source })).issues, []);
    const saved = await call("save_scenario", { source });
    const item = await call("get_scenario", { id: saved.id });
    assert.equal((await call("list_scenarios")).total, 1);
    assert.equal((await client.callTool({ name: "save_scenario", arguments: { source: item.source } })).isError, true);
    await call("save_scenario", { source: item.source, expectedUpdatedAt: item.updatedAt });
    const pin = { projectId, environmentId };
    const wrongEnvironment = await client.callTool({ name: "run_scenario", arguments: { id: saved.id, projectId, environmentId: randomUUID() } });
    assert.equal(wrongEnvironment.isError, true);
    assert.match((wrongEnvironment.content as { text: string }[])[0].text, /get_context/);
    assert.equal((await client.callTool({ name: "run_scenario", arguments: { id: saved.id } })).isError, true);
    const run = await call("run_scenario", { id: saved.id, ...pin });
    let result;
    for (let i = 0; i < 100; i++) { result = await call("get_run", { runId: run.runId }); if (result.state !== "running") break; await new Promise(r => setTimeout(r, 10)); }
    assert.equal(result.result.steps[0].httpStatus, 200);
    assert.ok(!JSON.stringify(result).includes("never-export-this"));
    // The full trace goes only to the app (renderer) so the person can read what the AI cannot.
    assert.equal(runs.length, 1);
    assert.deepEqual({ projectId: runs[0].projectId, environmentId: runs[0].environmentId, scenarioId: runs[0].scenarioId }, { projectId, environmentId, scenarioId: saved.id });
    assert.equal(runs[0].preview.scenario.name, "MCP 조회");
    assert.ok(JSON.stringify(runs[0].result).includes("never-export-this"));
    // Checks are described from the saved YAML so the AI knows which one failed, without response values.
    assert.deepEqual(result.result.steps[0].checks.map(({ label, passed }: { label: string; passed: boolean }) => [label, passed]), [
      ["HTTP 상태 기대값과 같은지 200", true], ["/token 존재하는지", true], ["/missing 존재하는지", false],
    ]);
    slow = true;
    const pending = await call("run_scenario", { id: saved.id, ...pin });
    assert.equal((await client.callTool({ name: "run_scenario", arguments: { id: saved.id, ...pin } })).isError, true);
    await call("cancel_run", { runId: pending.runId });
    for (let i = 0; i < 100; i++) { result = await call("get_run", { runId: pending.runId }); if (result.state !== "running") break; await new Promise(r => setTimeout(r, 10)); }
    assert.equal(result.state, "cancelled");
    await service.stop();
    assert.deepEqual(service.status(), { enabled: false });
    await assert.rejects(fetch(connection.url));
  } finally {
    await client.close(); await service.stop(); api.closeAllConnections();
    await new Promise<void>(resolve => api.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
function scopeWithoutServer(scope: { projectId: string; environmentId: string }) { return { projectId: scope.projectId, environmentId: scope.environmentId }; }

test("local stdio setup survives HTTP rotation, reports offline state and keeps tokens out of install config", async () => {
  const { prepareMcpSetup } = await import("../../src/app/api-testing/main/mcp/setup");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const { readFile, stat } = await import("node:fs/promises");
  const directory = await mkdtemp(path.join(tmpdir(), "checkly mcp's setup-"));
  const workspace = new ApiWorkspace(path.join(directory, "workspace"));
  const discovery = path.join(directory, "connection.json");
  const service = new ApiMcpService(workspace, discovery);
  const client = new Client({ name: "stdio-test", version: "1" });
  const projectId = randomUUID(), environmentId = randomUUID(), prodId = randomUUID(), serverId = randomUUID();
  try {
    const setup = await prepareMcpSetup(directory, path.resolve("packages/checkly-mcp/bin/checkly-mcp.cjs"));
    assert.deepEqual(JSON.parse(setup.configJson).mcpServers.checkly, { command: "node", args: setup.args });
    // Both CLI commands register the same adapter; the directory name's quote must survive shell quoting.
    assert.equal(setup.claudeCommand.replace(/^claude mcp add --scope user checkly -- /, ""), setup.codexCommand.replace(/^codex mcp add checkly -- /, ""));
    assert.ok(setup.claudeCommand.includes(`'"'"'`));
    await workspace.saveProject({ id: projectId, name: "설치 테스트", servers: [{ id: serverId, name: "API" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "http://127.0.0.1:1" } }, { id: prodId, name: "prod", baseUrls: { [serverId]: "http://127.0.0.1:1" } }] });
    await workspace.importSpec({ projectId, environmentId, serverId }, JSON.stringify({ openapi: "3.0.3", info: { title: "MCP", version: "1" }, paths: { "/test": { get: { summary: "조회", responses: { "200": { description: "성공" } } } } } }));
    const saved = await workspace.saveScenario({ projectId, environmentId }, "name: 환경 고정\nserver: API\nsteps:\n  - name: 조회\n    api: GET /test\n", {});
    const first = await service.start({ projectId, environmentId });
    assert.ok(first.enabled);
    assert.ok(!JSON.stringify(setup).includes(first.token));
    if (process.platform !== "win32") assert.equal((await stat(discovery)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(discovery, "utf8")).token, first.token);
    await client.connect(new StdioClientTransport({ command: process.execPath, args: setup.args, stderr: "pipe" }));
    assert.equal(parse(await client.callTool({ name: "get_context", arguments: {} })).project.id, projectId);
    await service.stop();
    await assert.rejects(readFile(discovery), { code: "ENOENT" });
    await assert.rejects(client.callTool({ name: "get_context", arguments: {} }), /Checkly 앱/);
    const second = await service.start({ projectId, environmentId });
    assert.ok(second.enabled);
    assert.notEqual(second.token, first.token);
    // Same client and same installed command reconnect without restarting or config edits.
    assert.equal(parse(await client.callTool({ name: "get_context", arguments: {} })).project.id, projectId);
    // The adapter silently follows a switch to prod; a run still pinned to dev must not execute there.
    await service.stop();
    await service.start({ projectId, environmentId: prodId });
    const stale = await client.callTool({ name: "run_scenario", arguments: { id: saved.id, projectId, environmentId } });
    assert.equal(stale.isError, true);
    assert.match((stale.content as { text: string }[])[0].text, /바뀌었습니다/);
    assert.equal(parse(await client.callTool({ name: "get_context", arguments: {} })).project.environment.id, prodId);
  } finally { await client.close(); await service.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("a save still queued when the MCP grant ends is not written", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "checkly-mcp-queue-"));
  const workspace = new ApiWorkspace(directory);
  const projectId = randomUUID(), environmentId = randomUUID(), serverId = randomUUID();
  const scope = { projectId, environmentId };
  const source = (name: string) => `name: ${name}\nserver: API\nsteps:\n  - name: 조회\n    api: GET /test\n`;
  try {
    await workspace.saveProject({ id: projectId, name: "대기열", servers: [{ id: serverId, name: "API" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "http://127.0.0.1:1" } }] });
    await workspace.importSpec({ projectId, environmentId, serverId }, JSON.stringify({ openapi: "3.0.3", info: { title: "MCP", version: "1" }, paths: { "/test": { get: { summary: "조회", responses: { "200": { description: "성공" } } } } } }));
    const grant = new AbortController();
    const ahead = workspace.saveScenario(scope, source("앞선 저장"), {});
    const queued = assert.rejects(workspace.saveScenario(scope, source("대기 중 저장"), {}, undefined, undefined, grant.signal), { name: "AbortError" });
    grant.abort();
    await ahead;
    await queued;
    assert.deepEqual((await workspace.listScenarios(projectId)).map(item => item.name), ["앞선 저장"]);
    await assert.rejects(workspace.saveScenario(scope, source("끝난 연결"), {}, undefined, undefined, grant.signal), { name: "AbortError" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("MCP: list_apis filters a large spec cheaply, get_api_spec reads only named APIs, validate reports syntax errors as issues", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "checkly-mcp-apis-"));
  const workspace = new ApiWorkspace(directory);
  const service = new ApiMcpService(workspace);
  const client = new Client({ name: "test", version: "1" });
  const projectId = randomUUID(), environmentId = randomUUID(), serverId = randomUUID();
  const scope = { projectId, environmentId };
  const paths: Record<string, unknown> = {};
  for (let i = 0; i < 250; i++) paths[`/items/${i}`] = { get: { tags: [i % 2 ? "상품" : "주문"], summary: `항목 ${i} 조회`, responses: { "200": { description: "성공", content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } } } } } };
  paths["/login"] = { post: { tags: ["인증"], summary: "로그인", requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { loginId: { type: "string" } } } } } }, responses: { "200": { description: "성공" } } } };
  try {
    await workspace.saveProject({ id: projectId, name: "목록", servers: [{ id: serverId, name: "API" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "http://127.0.0.1:1" } }] });
    await workspace.importSpec({ ...scope, serverId }, JSON.stringify({ openapi: "3.0.3", info: { title: "목록", version: "1" }, paths }));
    await workspace.saveScenario(scope, "name: 로그인\nserver: API\nsteps:\n  - name: 로그인\n    api: POST /login\n    body: {loginId: a}\n    extract: [{pointer: /token, target: globals.accessToken}]\n", {});
    const connection = await service.start(scope);
    assert.ok(connection.enabled);
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.url), { requestInit: { headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" } } }));
    const call = async (name: string, args = {}) => parse(await client.callTool({ name, arguments: args }));
    // A global only produced by extract is still listed with its producer, so the AI reuses it.
    assert.deepEqual((await call("get_context")).globals, [{ name: "accessToken", producers: ["로그인"], consumers: [], hasValue: false }]);
    // serverId is optional with one server; one call covers 200 APIs, the rest via nextOffset, and tags summarize the spec.
    const first = await call("list_apis");
    assert.equal(first.total, 251);
    assert.equal(first.apis.length, 200);
    assert.equal(first.nextOffset, 200);
    assert.deepEqual(Object.keys(first.apis[0]).sort(), ["api", "summary", "tag"]);
    assert.deepEqual(first.tags.map((tag: { name: string }) => tag.name).sort(), ["상품", "인증", "주문"]);
    const rest = await call("list_apis", { offset: first.nextOffset });
    assert.equal(rest.apis.length, 51);
    assert.equal(rest.nextOffset, undefined);
    assert.equal((await call("list_apis", { tag: "상품" })).total, 125);
    const found = await call("list_apis", { query: "로그인 post" });
    assert.deepEqual(found.apis.map((api: { api: string }) => api.api), ["POST /login"]);
    assert.equal(found.tags, undefined);
    // Details only for the named APIs; method case is forgiven and unknown APIs are reported.
    const detail = await call("get_api_spec", { apis: ["post /login", "GET /nope"] });
    assert.deepEqual(detail.apis.map((api: { api: string }) => api.api), ["POST /login"]);
    assert.equal(detail.apis[0].requestSchema.properties.loginId.type, "string");
    assert.deepEqual(detail.notFound, ["GET /nope"]);
    assert.equal((await client.callTool({ name: "get_api_spec", arguments: { apis: [] } })).isError, true);
    const forward = await call("validate_scenario", { source: "name: 앞 참조\nserver: API\nsteps:\n  - name: 조회\n    api: GET /items/1\n    query: {x: \"{{steps.2.response.body./id}}\"}\n" });
    assert.equal(forward.valid, false);
    assert.match(forward.issues[0], /앞선 단계/);
    assert.equal((await call("validate_scenario", { source: "name: 정상\nserver: API\nsteps:\n  - name: 조회\n    api: GET /items/1\n" })).valid, true);
  } finally { await client.close(); await service.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("list_scenarios summarizes without bodies; delete_scenario needs the app user's approval", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "checkly-mcp-delete-"));
  const workspace = new ApiWorkspace(directory);
  const answers: boolean[] = [];
  const asked: string[] = [];
  const service = new ApiMcpService(workspace, undefined, { confirm: async ({ title }) => { asked.push(title); return answers.shift() ?? false; } });
  const client = new Client({ name: "delete-test", version: "1" });
  const projectId = randomUUID(), environmentId = randomUUID(), serverId = randomUUID();
  try {
    await workspace.saveProject({ id: projectId, name: "삭제", servers: [{ id: serverId, name: "API" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "http://127.0.0.1:1" } }] });
    await workspace.importSpec({ projectId, environmentId, serverId }, JSON.stringify({ openapi: "3.0.3", info: { title: "삭제", version: "1" }, paths: { "/login": { post: { responses: { "200": { description: "성공" } } } }, "/orders": { get: { responses: { "200": { description: "성공" } } } } } }));
    await workspace.saveScenario({ projectId, environmentId }, "name: 로그인\ndescription: 토큰 저장\nserver: API\nsteps:\n  - name: 로그인\n    api: POST /login\n    auth: none\n    extract: [{ pointer: /token, target: globals.token }]\n", {});
    await workspace.saveScenario({ projectId, environmentId }, "name: 주문 조회\nserver: API\nsteps:\n  - name: 목록\n    api: GET /orders\n  - name: 다시\n    api: GET /orders\n", {});
    const connection = await service.start({ projectId, environmentId });
    assert.ok(connection.enabled);
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.url), { requestInit: { headers: { Authorization: `Bearer ${connection.token}` } } }));
    const call = async (name: string, args = {}) => parse(await client.callTool({ name, arguments: args }));

    const tokenGlobal = (await call("get_context")).globals.find((item: { name: string }) => item.name === "token");
    assert.deepEqual({ hasValue: tokenGlobal.hasValue, producers: tokenGlobal.producers }, { hasValue: false, producers: ["로그인"] });
    const all = await call("list_scenarios");
    assert.equal(all.total, 2);
    assert.ok(all.items.every((item: Record<string, unknown>) => !("source" in item) && !("bindings" in item)));
    const login = all.items.find((item: { name: string }) => item.name === "로그인");
    assert.deepEqual({ description: login.description, stepCount: login.stepCount, apis: login.apis, producesGlobals: login.producesGlobals }, { description: "토큰 저장", stepCount: 1, apis: ["POST /login"], producesGlobals: ["token"] });
    const orders = await call("list_scenarios", { query: "get /orders" });
    assert.deepEqual(orders.items.map((item: { name: string; apis: string[] }) => [item.name, item.apis]), [["주문 조회", ["GET /orders"]]]);

    const stale = await client.callTool({ name: "delete_scenario", arguments: { id: login.id, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" } });
    assert.equal(stale.isError, true);
    assert.equal(asked.length, 0);
    answers.push(false);
    assert.equal((await call("delete_scenario", { id: login.id, expectedUpdatedAt: login.updatedAt })).deleted, false);
    assert.match(asked[0], /로그인/);
    assert.equal((await call("list_scenarios")).total, 2);
    answers.push(true);
    assert.deepEqual(await call("delete_scenario", { id: login.id, expectedUpdatedAt: login.updatedAt }), { id: login.id, deleted: true });
    assert.deepEqual((await call("list_scenarios")).items.map((item: { name: string }) => item.name), ["주문 조회"]);
  } finally { await client.close(); await service.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("delete_scenario is refused without an app confirmation and when the grant ends mid-prompt", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "checkly-mcp-delete-off-"));
  const workspace = new ApiWorkspace(directory);
  let service!: ApiMcpService;
  const withoutConfirm = new ApiMcpService(workspace);
  const client = new Client({ name: "delete-off", version: "1" });
  const projectId = randomUUID(), environmentId = randomUUID(), serverId = randomUUID();
  try {
    await workspace.saveProject({ id: projectId, name: "삭제 거부", servers: [{ id: serverId, name: "API" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "http://127.0.0.1:1" } }] });
    const saved = await workspace.saveScenarioDraft({ projectId, environmentId }, "name: 초안\nserver: API\nsteps:\n  - name: 조회\n    api: GET /x\n", {});
    let connection = await withoutConfirm.start({ projectId, environmentId });
    assert.ok(connection.enabled);
    await client.connect(new StreamableHTTPClientTransport(new URL(connection.url), { requestInit: { headers: { Authorization: `Bearer ${connection.token}` } } }));
    const refused = await client.callTool({ name: "delete_scenario", arguments: { id: saved.id, expectedUpdatedAt: saved.updatedAt } });
    assert.equal(refused.isError, true);
    await client.close(); await withoutConfirm.stop();

    // The user approves only after the MCP connection was turned off: nothing is deleted.
    service = new ApiMcpService(workspace, undefined, { confirm: async () => { await service.stop(); return true; } });
    connection = await service.start({ projectId, environmentId });
    assert.ok(connection.enabled);
    const late = new Client({ name: "delete-late", version: "1" });
    await late.connect(new StreamableHTTPClientTransport(new URL(connection.url), { requestInit: { headers: { Authorization: `Bearer ${connection.token}` } } }));
    await late.callTool({ name: "delete_scenario", arguments: { id: saved.id, expectedUpdatedAt: saved.updatedAt } }).catch(() => undefined);
    assert.equal((await workspace.listScenarios(projectId)).length, 1);
  } finally { await client.close(); await withoutConfirm.stop(); await service?.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("MCP remembers the connection the user left on and forgets it when turned off", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "checkly-mcp-auto-"));
  const file = path.join(directory, "nested", "auto-start.json");
  const autoStart = new McpAutoStart(file);
  const first = { projectId: randomUUID(), environmentId: randomUUID() };
  const second = { projectId: randomUUID(), environmentId: randomUUID() };
  try {
    assert.equal(await autoStart.scope(), null);
    await autoStart.remember(first);
    assert.deepEqual(await autoStart.scope(), first);
    await autoStart.remember(second);
    assert.deepEqual(await autoStart.scope(), second);
    assert.ok(!(await readFile(file, "utf8")).includes("token"));
    await autoStart.forget();
    assert.equal(await autoStart.scope(), null);
    await autoStart.forget();
    await writeFile(file, "{broken");
    assert.equal(await autoStart.scope(), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
