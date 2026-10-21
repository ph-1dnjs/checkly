import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { releaseStaleDiscovery } from "../../src/app/api-testing/main/mcp/discovery";

test("corrupt discovery is preserved and removed from the active path", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mcp-corrupt-"));
  const file = path.join(dir, "connection.json");
  try {
    await writeFile(file, '{"broken":');
    await releaseStaleDiscovery(file, () => {});
    await assert.rejects(readFile(file), { code: "ENOENT" });
    const backup = (await readdir(dir)).find(name => name.startsWith("connection.json.corrupt-"));
    assert.ok(backup);
    assert.equal(await readFile(path.join(dir, backup), "utf8"), '{"broken":');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a reused live PID does not block recovery; authenticated Checkly identity does", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mcp-identity-"));
  const file = path.join(dir, "connection.json");
  let name = "unrelated-service";
  let auth = "";
  const server = createServer(async (req, res) => {
    auth = req.headers.authorization ?? "";
    let text = ""; for await (const chunk of req) text += chunk;
    const message = JSON.parse(text);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { serverInfo: { name } } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const record = { pid: process.pid, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, token: "a".repeat(64) };
  try {
    await writeFile(file, JSON.stringify(record));
    await releaseStaleDiscovery(file, () => {});
    await assert.rejects(readFile(file), { code: "ENOENT" });
    assert.equal(auth, `Bearer ${record.token}`);
    name = "checkly-api-testing";
    await writeFile(file, JSON.stringify(record));
    await assert.rejects(releaseStaleDiscovery(file, () => {}), /다른 Checkly/);
    assert.equal(JSON.parse(await readFile(file, "utf8")).token, record.token);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});

test("a discovery record replaced during the probe is preserved", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mcp-race-"));
  const file = path.join(dir, "connection.json");
  const replacement = '{"replacement":true}';
  const server = createServer(async (_req, res) => { await writeFile(file, replacement); res.end('{}'); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await writeFile(file, JSON.stringify({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, token: "a".repeat(64) }));
    await assert.rejects(releaseStaleDiscovery(file, () => {}), /접속 정보가 변경/);
    assert.equal(await readFile(file, "utf8"), replacement);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});

test("a port reused by a service that rejects the token is treated as stale", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "mcp-reused-port-"));
  const file = path.join(dir, "connection.json");
  const server = createServer((req, res) => { req.resume(); res.writeHead(401); res.end(); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await writeFile(file, JSON.stringify({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, token: "b".repeat(64) }));
    await releaseStaleDiscovery(file, () => {});
    await assert.rejects(readFile(file), { code: "ENOENT" });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});
