import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";
import { ApiMcpService } from "../../src/app/api-testing/main/mcp/server";
const exec = promisify(execFile);
const { defaultConnectionFile } = createRequire(import.meta.url)("../../packages/checkly-mcp/bin/checkly-mcp.cjs");

test("discovery paths follow OS settings and allow an explicit profile", () => {
  assert.equal(defaultConnectionFile("darwin", {}, "/users/me"), "/users/me/Library/Application Support/checkly-mcp/connection.json");
  assert.equal(defaultConnectionFile("linux", { XDG_CONFIG_HOME: "/custom" }, "/users/me"), "/custom/checkly-mcp/connection.json");
  assert.equal(defaultConnectionFile("win32", { APPDATA: "/roaming" }, "/users/me"), "/roaming/checkly-mcp/connection.json");
  assert.equal(defaultConnectionFile("linux", { CHECKLY_MCP_CONNECTION_FILE: "/profile/mcp.json" }), "/profile/mcp.json");
  assert.throws(() => defaultConnectionFile("linux", { CHECKLY_MCP_CONNECTION_FILE: "relative.json" }));
});

test("packed npm package installs independently, discovers the app and reconnects without configuration changes", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "checkly-package-"));
  const home = path.join(directory, "home");
  const config = path.join(home, "config");
  const env = { HOME: home, USERPROFILE: home, APPDATA: config, XDG_CONFIG_HOME: config, CHECKLY_MCP_CONNECTION_FILE: "" };
  const discovery = defaultConnectionFile(process.platform, env, home);
  const workspace = new ApiWorkspace(path.join(directory, "workspace"));
  const service = new ApiMcpService(workspace, discovery);
  const other = new ApiMcpService(workspace, discovery);
  const client = new Client({ name: "installed-package-test", version: "1" });
  try {
    await mkdir(home, { recursive: true });
    const packed = await exec("npm", ["pack", "./packages/checkly-mcp", "--json", "--pack-destination", directory, "--cache", path.join(directory, "cache")]);
    const packages = JSON.parse(packed.stdout);
    const pack = Array.isArray(packages) ? packages[0] : packages["@checkly-local/api-testing-mcp"];
    assert.deepEqual(pack.files.map((file: { path: string }) => file.path).sort(), ["README.md", "bin/checkly-mcp.cjs", "package.json"]);
    const prefix = path.join(directory, "install");
    await exec("npm", ["install", "--global", "--prefix", prefix, "--cache", path.join(directory, "cache"), "--offline", "--ignore-scripts", "--no-audit", "--no-fund", path.join(directory, pack.filename)]);
    const command = process.platform === "win32" ? process.execPath : path.join(prefix, "bin", "checkly-mcp");
    const args = process.platform === "win32" ? [path.join(prefix, "node_modules/@checkly-local/api-testing-mcp/bin/checkly-mcp.cjs")] : [];
    assert.match((await exec(command, [...args, "--help"], { cwd: home })).stdout, /Usage: checkly-mcp/);
    const projectId = randomUUID(), environmentId = randomUUID(), serverId = randomUUID();
    await workspace.saveProject({ id: projectId, name: "패키지 연결", servers: [{ id: serverId, name: "API" }], environments: [{ id: environmentId, name: "dev", baseUrls: { [serverId]: "http://127.0.0.1:1" } }] });
    await service.start({ projectId, environmentId });
    await assert.rejects(other.start({ projectId, environmentId }), /다른 Checkly/);
    await other.stop(); // A different instance cannot remove the owner's discovery record.
    await client.connect(new StdioClientTransport({ command, args, cwd: home, env, stderr: "pipe" }));
    const first = await client.callTool({ name: "get_context", arguments: {} });
    assert.equal(first.isError, undefined);
    assert.match(JSON.stringify(first), new RegExp(projectId));
    await service.stop();
    await assert.rejects(client.callTool({ name: "get_context", arguments: {} }), /Checkly 앱/);
    await service.start({ projectId, environmentId });
    const second = await client.callTool({ name: "get_context", arguments: {} });
    assert.equal(second.isError, undefined);
    assert.match(JSON.stringify(second), new RegExp(projectId));
  } finally { await client.close(); await other.stop(); await service.stop(); await rm(directory, { recursive: true, force: true }); }
});
