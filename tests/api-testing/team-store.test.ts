import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { SpecSync } from "../../src/app/api-testing/main/spec-sync";
import type { ApiTeamContext } from "../../src/app/api-testing/main/team-store";

const spec = JSON.stringify({ openapi: "3.0.3", info: { title: "팀 명세", version: "1" }, paths: {
  "/items/{id}": { get: { summary: "상품 조회", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "성공" } } } },
  "/login": { post: { summary: "로그인", requestBody: { content: { "application/json": { schema: { type: "object", properties: { loginId: { type: "string" }, password: { type: "string" } } } } } }, responses: { "200": { description: "토큰" } } } },
} });

// Against the local Supabase (`supabase start` + migrations). Keys come from the environment or
// `supabase status`, never from a file; without a reachable server with the API tables this skips.
function localSupabase(): { url: string; anonKey: string; serviceKey: string } | null {
  const env = process.env;
  if (env.CHECKLY_TEST_SUPABASE_URL && env.CHECKLY_TEST_SUPABASE_ANON_KEY && env.CHECKLY_TEST_SUPABASE_SERVICE_ROLE_KEY)
    return { url: env.CHECKLY_TEST_SUPABASE_URL, anonKey: env.CHECKLY_TEST_SUPABASE_ANON_KEY, serviceKey: env.CHECKLY_TEST_SUPABASE_SERVICE_ROLE_KEY };
  try {
    const out = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 });
    const value = (name: string) => new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(out)?.[1];
    const url = value("API_URL"), anonKey = value("ANON_KEY"), serviceKey = value("SERVICE_ROLE_KEY");
    return url && anonKey && serviceKey ? { url, anonKey, serviceKey } : null;
  } catch { return null; }
}

const local = localSupabase();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = local && createClient(local.url, local.serviceKey, options);
let reachable: Promise<boolean> | undefined;
/** Skips the test when the local server or the API testing tables are not there. */
async function needSupabase(t: TestContext) {
  reachable ??= admin ? Promise.resolve(admin.from("api_scenarios").select("id", { head: true })).then(({ error }) => !error, () => false) : Promise.resolve(false);
  if (!await reachable) t.skip("local Supabase with the API testing tables is not running");
  return reachable;
}

/** A team project with one owner, signed in like the app does (RLS applies). */
async function member(cleanup: Array<() => Promise<unknown>>): Promise<ApiTeamContext> {
  const code = `api-${randomUUID().slice(0, 8)}`, email = `owner.${code}@checkly.test`, password = randomUUID();
  const { data: user, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  cleanup.push(() => admin!.auth.admin.deleteUser(user.user.id));
  const { data: created, error: createError } = await admin!.rpc("create_project_for", { p_user: user.user.id, p_code: code, p_nickname: "owner" });
  if (createError) throw createError;
  const projectId = (created as Array<{ project_id: string }>)[0].project_id;
  cleanup.push(() => admin!.from("projects").delete().eq("id", projectId));
  const client = createClient(local!.url, local!.anonKey, options);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { client, userId: user.user.id, projectId, projectCode: code };
}

/** Another member of the same team project (joined with the invite code), signed in. */
async function teammate(team: ApiTeamContext, nickname: string, cleanup: Array<() => Promise<unknown>>): Promise<ApiTeamContext> {
  const email = `${nickname}.${team.projectCode}@checkly.test`, password = randomUUID();
  const { data: user, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  cleanup.push(() => admin!.auth.admin.deleteUser(user.user.id));
  const { data: project } = await admin!.from("projects").select("invite_code").eq("id", team.projectId).single();
  const { error: joinError } = await admin!.rpc("join_project_for", { p_user: user.user.id, p_invite: project!.invite_code, p_nickname: nickname });
  if (joinError) throw joinError;
  const client = createClient(local!.url, local!.anonKey, options);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { client, userId: user.user.id, projectId: team.projectId, projectCode: team.projectCode };
}

/** OS keychain stand-in: reversible, always available. */
const keychain = { available: () => true, encrypt: (value: string) => Buffer.from(value).toString("base64"), decrypt: (value: string) => Buffer.from(value, "base64").toString() };

async function rows(client: SupabaseClient, table: string) {
  const { data, error } = await client.from(table).select("*");
  if (error) throw error;
  return data as Array<Record<string, unknown>>;
}

test("team project: servers·environments map to the common tables, scenarios·suites·docs inputs are shared with conflicts", async t => {
  if (!await needSupabase(t)) return;
  const cleanup: Array<() => Promise<unknown>> = [];
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-team-"));
  const http = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end("{}"); });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  try {
    const team = await member(cleanup), other = await member(cleanup);
    const db = team.client;
    // What the settings screen would have made: a web endpoint with a dev address.
    const { data: web } = await db.from("endpoints").insert({ project_id: team.projectId, name: "프론트", kind: "web" }).select().single();
    const { data: dev } = await db.from("environments").insert({ project_id: team.projectId, name: "dev" }).select().single();
    await db.from("endpoint_urls").insert({ project_id: team.projectId, endpoint_id: web.id, environment_id: dev.id, base_url: "https://dev.app.test" });
    const webBefore = await rows(db, "endpoint_urls");

    const workspace = new ApiWorkspace(dir, () => team);
    assert.deepEqual(await workspace.getStorage(), { mode: "team", projectCode: team.projectCode, importable: [] });
    const [empty] = await workspace.listProjects();
    assert.deepEqual({ ...empty, revision: undefined }, { id: team.projectId, name: team.projectCode, revision: undefined, servers: [], environments: [{ id: dev.id, name: "dev", baseUrls: {} }] });
    await assert.rejects(workspace.saveProject({ ...empty, id: randomUUID(), servers: [{ id: randomUUID(), name: "API" }] }), /새로 만들 수 없습니다/);
    await assert.rejects(workspace.deleteProject(team.projectId), /삭제할 수 없습니다/);

    // A server with a dev address; a new stg environment whose address is left unset ("미설정").
    const serverId = randomUUID(), stgId = randomUUID();
    const project = await workspace.saveProject({ ...empty, servers: [{ id: serverId, name: "백엔드" }], environments: [{ id: dev.id, name: "dev", baseUrls: { [serverId]: baseUrl } }, { id: stgId, name: "stg", baseUrls: {} }] });
    assert.deepEqual(project.environments.map(environment => environment.baseUrls), [{ [serverId]: baseUrl }, {}]);
    assert.deepEqual((await rows(db, "endpoints")).map(row => [row.name, row.kind]).sort(), [["백엔드", "api"], ["프론트", "web"]]);
    // The web address is untouched (same row, same version).
    assert.deepEqual((await rows(db, "endpoint_urls")).filter(row => row.endpoint_id === web.id), webBefore);
    // Saving from an older copy is a conflict; a change to web only is not.
    await assert.rejects(workspace.saveProject({ ...project, revision: empty.revision }), /다른 팀원이 먼저 수정했습니다/);
    await db.from("endpoint_urls").update({ base_url: "https://dev2.app.test" }).eq("endpoint_id", web.id);
    const renamed = await workspace.saveProject({ ...project, environments: project.environments.map(environment => ({ ...environment, name: environment.name === "stg" ? "staging" : environment.name })) });
    assert.equal(renamed.environments[1].name, "staging");
    assert.equal((await rows(db, "endpoint_urls")).find(row => row.endpoint_id === web.id)?.base_url, "https://dev2.app.test");

    const devScope = { projectId: team.projectId, serverId, environmentId: dev.id }, stgScope = { ...devScope, environmentId: stgId };
    for (const scope of [devScope, stgScope]) await workspace.importSpec(scope, spec);
    await assert.rejects(workspace.execute(stgScope, "GET /items/{id}", { pathParams: { id: 1 } }), /staging 환경에 백엔드 서버 주소가 설정되지 않았습니다/);
    assert.match((await workspace.previewScenario(stgScope, "id: read\nname: 조회\nserver: 백엔드\nsteps:\n  - api: 'GET /items/{id}'\n    pathParams: { id: 1 }\n", {})).executionIssues?.join() ?? "", /미설정/);

    // Scenarios: saved to the team, conditional on the version read.
    const yaml = "id: read\nname: 조회\nserver: 백엔드\nsteps:\n  - api: 'GET /items/{id}'\n    pathParams: { id: 1 }\n";
    const first = await workspace.saveScenario(devScope, yaml, {}, undefined, { groupPath: ["상품"] });
    assert.deepEqual((await workspace.listScenarios(team.projectId)).map(item => [item.id, item.groupPath, item.updatedAt]), [["read", ["상품"], first.updatedAt]]);
    await assert.rejects(workspace.saveScenario(devScope, yaml, {}), /같은 ID의 시나리오가 있습니다/);
    const second = await workspace.saveScenario(devScope, yaml.replace("조회", "상품 조회"), {}, first.updatedAt);
    assert.notEqual(second.updatedAt, first.updatedAt);
    assert.equal(second.groupPath?.[0], "상품");
    await assert.rejects(workspace.saveScenario(devScope, yaml, {}, first.updatedAt), /그 사이 다른 곳\(팀원·다른 화면\)에서 이 시나리오를 저장했습니다/);
    await assert.rejects(workspace.deleteScenario(team.projectId, "read", first.updatedAt), /시나리오가 변경되었습니다/);
    // Kept titles are metadata: the version stays, so an open editor can still save.
    await db.from("api_scenarios").update({ kept_titles: [{ from: "a", to: "b" }] }).eq("project_id", team.projectId).eq("id", "read");
    assert.equal((await workspace.listScenarios(team.projectId))[0].updatedAt, second.updatedAt);
    assert.deepEqual((await workspace.listScenarios(team.projectId))[0].keptTitles, [{ from: "a", to: "b" }]);

    // Suites.
    const suite = await workspace.saveSuite(team.projectId, { id: randomUUID(), name: "묶음", scenarioIds: ["read", "read"], onFailure: "stop" });
    await assert.rejects(workspace.saveSuite(team.projectId, { id: suite.id, name: "다른 이름", scenarioIds: ["read"], onFailure: "stop" }), /묶음이 변경되었습니다/);
    const suite2 = await workspace.saveSuite(team.projectId, { id: suite.id, name: "다른 이름", scenarioIds: ["read"], onFailure: "continue" }, suite.updatedAt);
    assert.deepEqual((await workspace.listSuites(team.projectId)).map(item => [item.name, item.scenarioIds, item.onFailure]), [["다른 이름", ["read"], "continue"]]);
    await assert.rejects(workspace.deleteSuite(team.projectId, suite.id, suite.updatedAt), /묶음이 변경되었습니다/);

    // Docs inputs: shared per server; secrets too, since "비밀값도 팀에 공유" is on by default.
    await workspace.execute(devScope, "POST /login", { body: { loginId: "tester", password: "pw" } });
    assert.deepEqual(await workspace.getDocInputs(devScope), { "POST /login": { body: { loginId: "tester", password: "pw" } } });
    assert.deepEqual(await new ApiWorkspace(await mkdtemp(path.join(tmpdir(), "checkly-team-2-")), () => team).getDocInputs(devScope), { "POST /login": { body: { loginId: "tester", password: "pw" } } });

    // Spec URL: shared through endpoint_urls.spec_url, the account stays local.
    await workspace.shareSpecUrl(devScope, "https://dev.api.test/v3/api-docs");
    assert.equal(await workspace.sharedSpecUrl(devScope), "https://dev.api.test/v3/api-docs");
    assert.equal(await workspace.sharedSpecUrl(stgScope), null);
    assert.deepEqual(JSON.parse(await workspace.exportProject(team.projectId)).specUrls, [{ serverId, environmentId: dev.id, url: "https://dev.api.test/v3/api-docs" }]);

    // Another team sees none of it.
    const outsider = new ApiWorkspace(dir, () => other);
    await assert.rejects(outsider.listScenarios(team.projectId), /프로젝트를 찾을 수 없습니다/);
    for (const table of ["api_scenarios", "api_suites", "api_doc_inputs", "endpoints"]) assert.deepEqual(await rows(other.client, table), [], table);
    const { error: foreignInsert } = await other.client.from("api_scenarios").insert({ project_id: team.projectId, id: "x", name: "x", source: "x" });
    assert.ok(foreignInsert);

    // Renaming the server rewrites the scenarios that name it.
    const latest = (await workspace.listProjects())[0];
    await workspace.saveProject({ ...latest, servers: [{ id: serverId, name: "메인" }] });
    assert.match((await workspace.listScenarios(team.projectId))[0].source, /server: 메인/);
    assert.deepEqual((await rows(db, "endpoints")).map(row => row.name).sort(), ["메인", "프론트"]);

    await workspace.deleteSuite(team.projectId, suite.id, suite2.updatedAt);
    const current = (await workspace.listScenarios(team.projectId))[0];
    await workspace.deleteScenario(team.projectId, "read", current.updatedAt);
    assert.deepEqual(await workspace.listScenarios(team.projectId), []);
  } finally {
    http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve()));
    for (const step of cleanup.reverse()) await Promise.resolve(step()).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test("team project: a local project is copied in once, matching servers and environments by name", async t => {
  if (!await needSupabase(t)) return;
  const cleanup: Array<() => Promise<unknown>> = [];
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-team-import-"));
  try {
    const team = await member(cleanup);
    const db = team.client;
    // The team already has an api "백엔드" with a dev address and a web endpoint.
    const { data: backend } = await db.from("endpoints").insert({ project_id: team.projectId, name: "백엔드", kind: "api" }).select().single();
    const { data: web } = await db.from("endpoints").insert({ project_id: team.projectId, name: "프론트", kind: "web", position: 1 }).select().single();
    const { data: dev } = await db.from("environments").insert({ project_id: team.projectId, name: "dev" }).select().single();
    await db.from("endpoint_urls").insert([
      { project_id: team.projectId, endpoint_id: backend.id, environment_id: dev.id, base_url: "https://team-dev.api.test" },
      { project_id: team.projectId, endpoint_id: web.id, environment_id: dev.id, base_url: "https://dev.app.test" },
    ]);

    // A local project from before sign-in: 백엔드 + 인증 servers, dev + prod environments.
    const offline = new ApiWorkspace(dir);
    const [backendLocal, authLocal, devLocal, prodLocal] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const local = { id: randomUUID(), name: "로컬 QA", servers: [{ id: backendLocal, name: "백엔드" }, { id: authLocal, name: "인증" }], environments: [
      { id: devLocal, name: "dev", baseUrls: { [backendLocal]: "https://local-dev.api.test", [authLocal]: "https://local-dev.auth.test" } },
      { id: prodLocal, name: "prod", baseUrls: { [backendLocal]: "https://api.test", [authLocal]: "https://auth.test" } },
    ] };
    await offline.saveProject(local);
    const devScope = { projectId: local.id, serverId: backendLocal, environmentId: devLocal };
    await offline.importSpec(devScope, spec);
    await writeFile(path.join(dir, `spec-source-${local.id}-${devLocal}-${backendLocal}.json`), JSON.stringify({ url: "https://local-dev.api.test/v3/api-docs" }));
    await offline.saveScenario(devScope, "id: login\nname: 로그인\nserver: 백엔드\nsteps:\n  - api: POST /login\n", {});
    await offline.saveScenarioDraft(devScope, "id: draft\nname: 초안\nserver: 인증\nsteps:\n  - api: POST /login\n", {});
    await offline.saveSuite(local.id, { id: randomUUID(), name: "로그인 묶음", scenarioIds: ["login"], onFailure: "stop" });
    await writeFile(path.join(dir, `doc-inputs-${local.id}.json`), JSON.stringify({ [`${backendLocal} POST /login`]: { body: { loginId: "a" } } }));

    const workspace = new ApiWorkspace(dir, () => team);
    assert.deepEqual(await workspace.getStorage(), { mode: "team", projectCode: team.projectCode, importable: [{ id: local.id, name: "로컬 QA", scenarios: 2, suites: 1 }] });
    const result = await workspace.importLocalProject(local.id);
    assert.deepEqual([result.scenarios, result.suites, result.specUrls, result.merged], [2, 1, 1, { added: 3, updated: 0, kept: 0 }]);
    const project = (await workspace.listProjects())[0];
    const authId = project.servers.find(server => server.name === "인증")!.id, prod = project.environments.find(environment => environment.name === "prod")!;
    // Same names → same ids; the team's address wins, the file's fill what was unset.
    assert.deepEqual(project.servers.map(server => [server.name, server.id === backend.id]), [["백엔드", true], ["인증", false]]);
    assert.deepEqual(project.environments.find(environment => environment.id === dev.id)!.baseUrls, { [backend.id]: "https://team-dev.api.test", [authId]: "https://local-dev.auth.test" });
    assert.deepEqual(prod.baseUrls, { [backend.id]: "https://api.test", [authId]: "https://auth.test" });
    assert.ok((await rows(db, "endpoints")).some(row => row.id === web.id && row.kind === "web"));
    assert.deepEqual((await workspace.listScenarios(team.projectId)).map(item => [item.id, item.draft]), [["draft", true], ["login", false]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    // Brought in from the local project: made by whoever imported it.
    assert.deepEqual((await workspace.listScenarios(team.projectId)).map(item => item.createdBy), ["owner", "owner"]);
    assert.deepEqual((await workspace.listSuites(team.projectId)).map(suite => suite.scenarioIds), [["login"]]);
    const teamDev = { projectId: team.projectId, serverId: backend.id, environmentId: dev.id };
    assert.deepEqual(await workspace.getDocInputs(teamDev), { "POST /login": { body: { loginId: "a" } } });
    assert.equal(await workspace.sharedSpecUrl(teamDev), "https://local-dev.api.test/v3/api-docs");
    // The spec already read locally comes along, so it need not be fetched again.
    await access(path.join(dir, `catalog-${team.projectId}-${dev.id}-${backend.id}.json`));
    assert.equal((await workspace.getCatalog(teamDev))?.operations.length, 2);
    // Offered once: the team now has scenarios. The local project itself is untouched.
    assert.deepEqual((await workspace.getStorage() as { importable: unknown[] }).importable, []);
    assert.equal((await offline.listScenarios(local.id)).length, 2);
    // Importing again adds nothing and replaces nothing.
    assert.deepEqual((await workspace.importLocalProject(local.id)).merged, { added: 0, updated: 0, kept: 3 });
  } finally {
    for (const step of cleanup.reverse()) await Promise.resolve(step()).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test("team project: docs inputs' secrets and docs accounts are shared with the team; each member fetches the spec", async t => {
  if (!await needSupabase(t)) return;
  const cleanup: Array<() => Promise<unknown>> = [];
  const dirA = await mkdtemp(path.join(tmpdir(), "checkly-spec-a-")), dirB = await mkdtemp(path.join(tmpdir(), "checkly-spec-b-"));
  // The team's swagger, behind Basic auth.
  const swagger = createServer((req, res) => {
    if (req.url === "/login") { res.setHeader("content-type", "application/json"); res.end("{}"); return; }
    if (req.headers.authorization !== `Basic ${Buffer.from("docs:docs-pw").toString("base64")}`) { res.statusCode = 401; res.end(); return; }
    res.setHeader("content-type", "application/json"); res.end(spec);
  });
  await new Promise<void>(resolve => swagger.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(swagger.address() as { port: number }).port}`, specUrl = `${baseUrl}/v3/api-docs`;
  try {
    const a = await member(cleanup), b = await teammate(a, "minsu", cleanup), outsider = await member(cleanup);
    const workspaceA = new ApiWorkspace(dirA, () => a), workspaceB = new ApiWorkspace(dirB, () => b);
    const syncA = new SpecSync(dirA, workspaceA, keychain), syncB = new SpecSync(dirB, workspaceB, keychain);
    const serverId = randomUUID(), devId = randomUUID();
    const [empty] = await workspaceA.listProjects();
    await workspaceA.saveProject({ ...empty, servers: [{ id: serverId, name: "백엔드" }], environments: [{ id: devId, name: "dev", baseUrls: { [serverId]: baseUrl } }] });
    const dev = { projectId: a.projectId, serverId, environmentId: devId };

    // 1. A imports by URL with a remembered docs account: the URL and the account go to the team (the spec stays A's cache).
    assert.deepEqual(await workspaceA.getTeamSettings(), { shareSecrets: true });
    assert.equal((await syncA.get(dev)).shareAccount, true);
    const imported = await syncA.importUrl(dev, { kind: "url", url: specUrl, remember: true, auth: { kind: "basic", username: "docs", password: "docs-pw" } });
    assert.deepEqual((await rows(a.client, "api_spec_accounts")).map(row => [row.spec_url, row.username, row.password]), [[specUrl, "docs", "docs-pw"]]);

    // 2. B has no spec until fetching it, but sees the team's URL and account and fetches with them.
    assert.equal(await workspaceB.getCatalog(dev), null);
    const syncedB = await syncB.get(dev);
    assert.deepEqual([syncedB.url, syncedB.username, syncedB.hasSavedAccount, syncedB.teamAccount, syncedB.shareAccount], [specUrl, "docs", true, true, true]);
    const fetchedB = await syncB.importUrl(dev, { kind: "url", url: specUrl, useSavedAuth: true });
    assert.deepEqual(fetchedB.operations.map(operation => operation.key), imported.operations.map(operation => operation.key));
    await access(path.join(dirB, `catalog-${a.projectId}-${devId}-${serverId}.json`));

    // 3. Secrets in docs inputs: kept while sharing is on, stripped (now and later) once it is off.
    await workspaceA.execute(dev, "POST /login", { headers: { Authorization: "Bearer dev-token" }, body: { loginId: "tester", password: "pw" } }).catch(() => undefined);
    assert.deepEqual(await workspaceB.getDocInputs(dev), { "POST /login": { headers: { Authorization: "Bearer dev-token" }, body: { loginId: "tester", password: "pw" } } });
    const off = await workspaceB.setShareSecrets(false);
    assert.deepEqual([off.shareSecrets, off.updatedBy], [false, "minsu"]);
    assert.deepEqual(await workspaceA.getDocInputs(dev), { "POST /login": { body: { loginId: "tester", password: "" } } });
    await workspaceA.execute(dev, "POST /login", { body: { loginId: "tester2", password: "pw2" } }).catch(() => undefined);
    assert.deepEqual(await workspaceB.getDocInputs(dev), { "POST /login": { body: { loginId: "tester2", password: "" } } });

    // 4. Docs accounts: off removes the team's and stops new ones (also at the database).
    assert.deepEqual(await rows(a.client, "api_spec_accounts"), []);
    const offSync = await syncB.get(dev);
    assert.deepEqual([offSync.hasSavedAccount, offSync.teamAccount, offSync.shareAccount], [false, undefined, undefined]);
    const { error: blocked } = await a.client.from("api_spec_accounts").insert({ project_id: a.projectId, endpoint_id: serverId, environment_id: devId, spec_url: specUrl, username: "docs", password: "x" });
    assert.ok(blocked, "RLS refuses a shared account while sharing is off");
    await workspaceA.setShareSecrets(true);
    assert.deepEqual((await workspaceB.getTeamSettings())?.shareSecrets, true);

    // 5. Another team sees none of it and cannot write into it.
    for (const table of ["api_settings", "api_spec_accounts"]) assert.deepEqual(await rows(outsider.client, table), [], table);
    const { error: foreignSetting } = await outsider.client.from("api_settings").upsert({ project_id: a.projectId, share_secrets: false });
    assert.ok(foreignSetting);
    assert.equal((await workspaceA.getTeamSettings())?.shareSecrets, true);
    assert.equal(await new ApiWorkspace(dirB, () => outsider).getTeamSettings().then(settings => settings?.shareSecrets), true);
  } finally {
    swagger.closeAllConnections(); await new Promise<void>(resolve => swagger.close(() => resolve()));
    for (const step of cleanup.reverse()) await Promise.resolve(step()).catch(() => undefined);
    await rm(dirA, { recursive: true, force: true }); await rm(dirB, { recursive: true, force: true });
  }
});

test("team project: docs accounts stay in the keychain while sharing is off", async t => {
  if (!await needSupabase(t)) return;
  const cleanup: Array<() => Promise<unknown>> = [];
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-spec-off-"));
  const swagger = createServer((req, res) => {
    if (req.headers.authorization !== `Basic ${Buffer.from("docs:docs-pw").toString("base64")}`) { res.statusCode = 401; res.end(); return; }
    res.setHeader("content-type", "application/json"); res.end(spec);
  });
  await new Promise<void>(resolve => swagger.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(swagger.address() as { port: number }).port}`;
  try {
    const team = await member(cleanup);
    const workspace = new ApiWorkspace(dir, () => team), sync = new SpecSync(dir, workspace, keychain);
    const serverId = randomUUID(), devId = randomUUID();
    const [empty] = await workspace.listProjects();
    await workspace.saveProject({ ...empty, servers: [{ id: serverId, name: "백엔드" }], environments: [{ id: devId, name: "dev", baseUrls: { [serverId]: baseUrl } }] });
    const dev = { projectId: team.projectId, serverId, environmentId: devId };
    await workspace.setShareSecrets(false);
    await sync.importUrl(dev, { kind: "url", url: `${baseUrl}/v3/api-docs`, remember: true, auth: { kind: "basic", username: "docs", password: "docs-pw" } });
    assert.deepEqual(await rows(team.client, "api_spec_accounts"), []);
    const saved = await sync.get(dev);
    assert.deepEqual([saved.hasSavedAccount, saved.teamAccount, saved.shareAccount, saved.username], [true, undefined, undefined, "docs"]);
    // The keychain account still works for a refresh.
    assert.equal((await sync.importUrl(dev, { kind: "url", url: `${baseUrl}/v3/api-docs`, useSavedAuth: true })).operations.length, 2);
    await workspace.execute(dev, "POST /login", { body: { loginId: "a", password: "b" } }).catch(() => undefined);
    assert.deepEqual(await workspace.getDocInputs(dev), { "POST /login": { body: { loginId: "a", password: "" } } });
  } finally {
    swagger.closeAllConnections(); await new Promise<void>(resolve => swagger.close(() => resolve()));
    for (const step of cleanup.reverse()) await Promise.resolve(step()).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});

test("team project: who made·changed scenarios and suites is stamped by the database", async t => {
  if (!await needSupabase(t)) return;
  const cleanup: Array<() => Promise<unknown>> = [];
  const dirA = await mkdtemp(path.join(tmpdir(), "checkly-author-a-")), dirB = await mkdtemp(path.join(tmpdir(), "checkly-author-b-"));
  try {
    const a = await member(cleanup), b = await teammate(a, "hyewon", cleanup), leaver = await teammate(a, "leaver", cleanup);
    const workspaceA = new ApiWorkspace(dirA, () => a), workspaceB = new ApiWorkspace(dirB, () => b);
    const serverId = randomUUID(), devId = randomUUID();
    const [empty] = await workspaceA.listProjects();
    await workspaceA.saveProject({ ...empty, servers: [{ id: serverId, name: "백엔드" }], environments: [{ id: devId, name: "dev", baseUrls: { [serverId]: "https://dev.api.test" } }] });
    const scope = { projectId: a.projectId, serverId, environmentId: devId };
    await workspaceA.importSpec(scope, spec);
    await workspaceB.importSpec(scope, spec);
    const yaml = (id: string, name = id) => `id: ${id}\nname: ${name}\nserver: 백엔드\nsteps:\n  - api: 'GET /items/{id}'\n    pathParams: { id: 1 }\n`;
    const byId = async (workspace: ApiWorkspace, id: string) => (await workspace.listScenarios(a.projectId)).find(item => item.id === id)!;

    // 1. A writes, B edits: A stays the author, B is the last editor.
    const made = await workspaceA.saveScenario(scope, yaml("by-hand"), {});
    assert.deepEqual([made.createdBy, made.updatedBy, made.createdAt], ["owner", "owner", made.updatedAt]);
    const edited = await workspaceB.saveScenario(scope, yaml("by-hand", "고친 이름"), {}, made.updatedAt);
    assert.deepEqual([edited.createdBy, edited.updatedBy, edited.createdAt], ["owner", "hyewon", made.createdAt]);
    assert.notEqual(edited.updatedAt, made.updatedAt);
    // Optimistic concurrency is unchanged: A's stale copy is refused.
    await assert.rejects(workspaceA.saveScenario(scope, yaml("by-hand"), {}, made.updatedAt), /그 사이 다른 곳/);
    assert.deepEqual([(await byId(workspaceA, "by-hand")).createdBy, (await byId(workspaceA, "by-hand")).updatedBy], ["owner", "hyewon"]);

    // 2. Nobody can claim to be the author or rewrite when it was made.
    const { error: spoofError } = await b.client.from("api_scenarios").update({ created_by: b.userId, created_at: "2000-01-01T00:00:00Z" }).eq("project_id", a.projectId).eq("id", "by-hand");
    assert.equal(spoofError, null);
    const [row] = (await rows(a.client, "api_scenarios")).filter(item => item.id === "by-hand");
    assert.deepEqual([row.created_by, Date.parse(row.created_at as string)], [a.userId, Date.parse(made.createdAt!)]);
    const { error: insertError } = await b.client.from("api_scenarios").insert({ project_id: a.projectId, id: "claimed", name: "x", source: yaml("claimed"), created_by: a.userId, created_at: "2000-01-01T00:00:00Z" });
    assert.equal(insertError, null);
    const [claimed] = (await rows(a.client, "api_scenarios")).filter(item => item.id === "claimed");
    assert.equal(claimed.created_by, b.userId);
    assert.notEqual(new Date(claimed.created_at as string).getFullYear(), 2000);

    // 3. A share file brought in: made by whoever imported it.
    const shared = JSON.parse(await workspaceA.exportProject(a.projectId)) as { scenarios: Array<{ id: string; source: string }>; suites: unknown[] };
    shared.scenarios = shared.scenarios.filter(item => item.id === "by-hand").map(item => ({ ...item, id: "imported", source: item.source.replace("id: by-hand", "id: imported") }));
    const imported = await workspaceB.importProject(JSON.stringify(shared));
    assert.equal(imported.scenarios, 1);
    const importedItem = await byId(workspaceA, "imported");
    assert.deepEqual([importedItem.createdBy, importedItem.updatedBy], ["hyewon", "hyewon"]);

    // 4. Suites: same authorship; one read back (with its authorship) saves as is.
    const suite = await workspaceA.saveSuite(a.projectId, { id: randomUUID(), name: "묶음", scenarioIds: ["by-hand"], onFailure: "stop" });
    assert.deepEqual([suite.createdBy, suite.updatedBy], ["owner", "owner"]);
    const listedSuite = (await workspaceB.listSuites(a.projectId))[0];
    const { updatedAt: _updatedAt, ...withAuthorship } = listedSuite;
    const suiteEdited = await workspaceB.saveSuite(a.projectId, { ...withAuthorship, name: "고친 묶음" }, listedSuite.updatedAt);
    assert.deepEqual([suiteEdited.createdBy, suiteEdited.updatedBy, suiteEdited.createdAt], ["owner", "hyewon", suite.createdAt]);
    await assert.rejects(workspaceA.saveSuite(a.projectId, { id: suite.id, name: "x", scenarioIds: ["by-hand"], onFailure: "stop" }, suite.updatedAt), /묶음이 변경되었습니다/);
    // The share file stays importable (no authorship in it).
    const exported = JSON.parse(await workspaceA.exportProject(a.projectId)) as { suites: Array<Record<string, unknown>> };
    assert.deepEqual(Object.keys(exported.suites[0]).sort(), ["id", "name", "onFailure", "scenarioIds"]);

    // 5. A member who left: their work stays, shown as "(나간 멤버)".
    const leaverWorkspace = new ApiWorkspace(path.join(dirB, "leaver"), () => leaver);
    await leaverWorkspace.importSpec(scope, spec);
    await leaverWorkspace.saveScenario(scope, yaml("left-behind"), {});
    assert.equal((await byId(workspaceA, "left-behind")).createdBy, "leaver");
    const { error: leaveError } = await admin!.from("members").delete().eq("user_id", leaver.userId);
    assert.equal(leaveError, null);
    const fresh = new ApiWorkspace(dirA, () => ({ ...a }));
    const left = await byId(fresh, "left-behind");
    assert.deepEqual([left.createdBy, left.updatedBy], ["(나간 멤버)", "(나간 멤버)"]);
    // A cached member list is read again when an id it does not know shows up (someone who just joined).
    const late = await teammate(a, "latecomer", cleanup);
    const lateWorkspace = new ApiWorkspace(path.join(dirB, "late"), () => late);
    await lateWorkspace.importSpec(scope, spec);
    await lateWorkspace.saveScenario(scope, yaml("late"), {});
    await new Promise(resolve => setTimeout(resolve, 1_100));
    assert.equal((await byId(fresh, "late")).createdBy, "latecomer");
  } finally {
    for (const step of cleanup.reverse()) await Promise.resolve(step()).catch(() => undefined);
    await rm(dirA, { recursive: true, force: true }); await rm(dirB, { recursive: true, force: true });
  }
});

test("file mode: no authorship is kept or shown", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-author-file-"));
  try {
    const workspace = new ApiWorkspace(dir);
    const serverId = randomUUID(), devId = randomUUID();
    const project = await workspace.saveProject({ id: randomUUID(), name: "로컬", servers: [{ id: serverId, name: "백엔드" }], environments: [{ id: devId, name: "dev", baseUrls: { [serverId]: "https://dev.api.test" } }] });
    const scope = { projectId: project.id, serverId, environmentId: devId };
    await workspace.importSpec(scope, spec);
    const made = await workspace.saveScenario(scope, `id: by-hand\nname: 처음\nserver: 백엔드\nsteps:\n  - api: 'GET /items/{id}'\n    pathParams: { id: 1 }\n`, {});
    assert.deepEqual([made.createdAt, made.createdBy, made.updatedBy], [undefined, undefined, undefined]);
    const suite = await workspace.saveSuite(project.id, { id: randomUUID(), name: "묶음", scenarioIds: ["by-hand"], onFailure: "stop" });
    assert.deepEqual([suite.createdAt, suite.createdBy, suite.updatedBy], [undefined, undefined, undefined]);
    assert.doesNotMatch(await workspace.exportProject(project.id), /createdAt|createdBy|updatedBy/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
