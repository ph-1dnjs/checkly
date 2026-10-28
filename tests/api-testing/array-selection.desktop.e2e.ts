import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { ApiTestingBridge } from "../../src/app/api-testing/shared/workspace";

async function main() {
  const directory = await mkdtemp(path.join(tmpdir(), "checkly-selection-desktop-"));
  const requests: string[] = [];
  let enough = true;
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/openapi.json") {
      res.end(JSON.stringify({ openapi: "3.0.3", info: { title: "선별", version: "1" }, paths: {
        "/items": { get: { responses: { "200": { description: "OK" } } } },
        "/use": { get: { parameters: [{ name: "X-Item", in: "header", schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
      } })); return;
    }
    requests.push(`${req.url}:${req.headers["x-item"] ?? ""}`);
    res.end(req.url === "/items" ? JSON.stringify({ items: enough ? [{ id: "first", active: true }, { id: "second", active: true }] : [{ id: "first", active: true }] }) : "{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const apiUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const env = { ...process.env, CHECKLY_SUPABASE_URL: "", CHECKLY_SUPABASE_ANON_KEY: "" }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [".", `--user-data-dir=${directory}`], env });
  try {
    const page = await app.firstWindow();
    const scope = { projectId: randomUUID(), environmentId: randomUUID(), serverId: randomUUID() };
    const source = "name: 선별\nserver: API\nsteps:\n  - name: 조회\n    api: GET /items\n    extract: [{pointer: /items, select: {where: {pointer: /active, equals: true}, minItems: 2, map: /id, index: 0}, target: vars.item}]\n  - name: 사용\n    api: GET /use\n    headers: {X-Item: '{{vars.item}}'}\n";
    const saved = await page.evaluate(async ({ scope, apiUrl, source }) => {
      const api = (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting;
      await api.saveProject({ id: scope.projectId, name: "선별", servers: [{ id: scope.serverId, name: "API" }], environments: [{ id: scope.environmentId, name: "dev", baseUrls: { [scope.serverId]: apiUrl } }] });
      await api.importSpec(scope, { kind: "url", url: `${apiUrl}/openapi.json` });
      return api.saveScenario(scope, source, {});
    }, { scope, apiUrl, source });
    const run = () => page.evaluate(async ({ scope, id }) => {
      const api = (window as unknown as { electronAPI: { apiTesting: ApiTestingBridge } }).electronAPI.apiTesting;
      const item = (await api.listScenarios(scope.projectId)).find(value => value.id === id)!;
      return api.runScenario({ projectId: scope.projectId, environmentId: scope.environmentId }, item.source, item.bindings, {});
    }, { scope, id: saved.id });
    expect((await run()).status).toBe("passed");
    expect(requests).toEqual(["/items:", "/use:first"]);
    enough = false; requests.length = 0;
    expect((await run()).status).toBe("failed");
    expect(requests).toEqual(["/items:"]);
    process.stdout.write("배열 선별 Electron E2E 통과\n");
  } finally { await app.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : error}\n`); process.exitCode = 1; });
