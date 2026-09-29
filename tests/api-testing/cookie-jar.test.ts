import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CookieJar } from "../../src/app/api-testing/main/cookies";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";

const setCookie = (...values: string[]) => { const headers = new Headers(); values.forEach(value => headers.append("set-cookie", value)); return headers; };
const sent = (jar: CookieJar, url: string, now?: number) => jar.forUrl(new URL(url), now);

test("Domain cookies are shared across subdomains while host-only cookies are not", () => {
  const jar = new CookieJar();
  jar.store(new URL("https://auth.example.com/login"), setCookie("SESSION=s1; Domain=.example.com; Path=/", "HOSTONLY=h1; Path=/"));
  assert.deepEqual(sent(jar, "https://api.example.com/me"), { SESSION: "s1" });
  assert.deepEqual(sent(jar, "https://auth.example.com/me"), { SESSION: "s1", HOSTONLY: "h1" });
  assert.deepEqual(sent(jar, "https://example.org/me"), {});
});

test("cookies for an unrelated domain are rejected", () => {
  const jar = new CookieJar();
  jar.store(new URL("https://api.example.com/"), setCookie("A=1; Domain=other.com", "B=2; Domain=sub.api.example.com"));
  assert.deepEqual(jar.list(), []);
});

test("default path follows the request directory and the most specific path wins", () => {
  const jar = new CookieJar();
  jar.store(new URL("https://api.test/auth/login"), setCookie("SCOPED=1", "TOKEN=root; Path=/"));
  jar.store(new URL("https://api.test/auth/login"), setCookie("TOKEN=auth; Path=/auth"));
  assert.deepEqual(sent(jar, "https://api.test/auth/me"), { TOKEN: "auth", SCOPED: "1" });
  assert.deepEqual(sent(jar, "https://api.test/orders"), { TOKEN: "root" });
});

test("Secure, Max-Age precedence, expiry and deletion", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const jar = new CookieJar();
  jar.store(new URL("https://api.test/"), setCookie("S=1; Secure", "M=1; Max-Age=60; Expires=Thu, 01 Jan 2025 00:00:00 GMT", "E=1; Expires=Thu, 01 Jan 2026 00:00:10 GMT"), now);
  assert.deepEqual(sent(jar, "http://api.test/", now), { M: "1", E: "1" });
  assert.deepEqual(sent(jar, "https://api.test/", now + 30_000), { S: "1", M: "1" });
  jar.store(new URL("https://api.test/"), setCookie("S=; Max-Age=0"), now + 30_000);
  assert.deepEqual(sent(jar, "https://api.test/", now + 30_000), { M: "1" });
  assert.deepEqual(sent(jar, "https://api.test/", now + 61_000), {});
});

test("list exposes names and scopes only", () => {
  const jar = new CookieJar();
  jar.store(new URL("https://api.test/"), setCookie("SESSION=secret-value; Path=/"));
  assert.deepEqual(jar.list(), [{ name: "SESSION", domain: "api.test", path: "/" }]);
  assert.equal(JSON.stringify(jar.list()).includes("secret-value"), false);
  jar.clear();
  assert.deepEqual(jar.list(), []);
});

test("project cookies carry over between scenarios and Swagger calls, per project, never persisted", async () => {
  const received: string[] = [];
  const server = createServer((req, res) => {
    received.push(req.headers.cookie ?? "");
    res.setHeader("content-type", "application/json");
    if (req.url === "/login") res.setHeader("set-cookie", "SESSION=cookie-secret; Path=/; HttpOnly");
    res.end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-cookie-jar-"));
  try {
    const workspace = new ApiWorkspace(dir);
    const serverId = randomUUID(), dev = randomUUID();
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const project = { id: randomUUID(), name: "쿠키", servers: [{ id: serverId, name: "회원" }], environments: [{ id: dev, name: "dev", baseUrls: { [serverId]: url } }] };
    const other = { ...project, id: randomUUID() };
    await workspace.saveProject(project);
    await workspace.saveProject(other);
    const spec = JSON.stringify({ openapi: "3.0.3", info: { title: "쿠키", version: "1" }, paths: { "/login": { post: { responses: { "200": { description: "성공" } } } }, "/me": { get: { responses: { "200": { description: "성공" } } } } } });
    const scope = { projectId: project.id, serverId, environmentId: dev };
    const otherScope = { ...scope, projectId: other.id };
    await workspace.importSpec(scope, spec);
    await workspace.importSpec(otherScope, spec);

    const login = "id: login\nname: 로그인\nserver: 회원\nsteps:\n  - api: POST /login\n";
    assert.equal((await workspace.runScenario({ projectId: project.id, environmentId: dev }, login, {}, {})).status, "passed");
    const me = "id: me\nname: 내 정보\nserver: 회원\nsteps:\n  - api: GET /me\n";
    await workspace.runScenario({ projectId: project.id, environmentId: dev }, me, {}, {});
    assert.equal(received.at(-1), "SESSION=cookie-secret");
    await workspace.execute(scope, "GET /me", {});
    assert.equal(received.at(-1), "SESSION=cookie-secret");
    await workspace.execute(otherScope, "GET /me", {});
    assert.equal(received.at(-1), "");

    assert.deepEqual(await workspace.listCookies({ projectId: project.id }), [{ name: "SESSION", domain: "127.0.0.1", path: "/" }]);
    for (const file of await readdir(dir)) assert.equal((await readFile(path.join(dir, file), "utf8")).includes("cookie-secret"), false);
    await workspace.clearCookies({ projectId: project.id });
    await workspace.execute(scope, "GET /me", {});
    assert.equal(received.at(-1), "");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
