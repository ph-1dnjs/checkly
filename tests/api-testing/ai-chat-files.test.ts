import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";

const spec = (paths: string[]) => JSON.stringify({
  openapi: "3.0.3", info: { title: "상점", version: "1" },
  paths: Object.fromEntries(paths.map(endpoint => [endpoint, { get: { responses: { "200": { description: "성공" } } } }])),
});

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "checkly-ai-files-"));
  const workspace = new ApiWorkspace(dir);
  const projectId = randomUUID(), serverId = randomUUID(), environmentId = randomUUID(), otherEnvironmentId = randomUUID();
  await workspace.saveProject({
    id: projectId, name: "상점", servers: [{ id: serverId, name: "상점" }],
    environments: [environmentId, otherEnvironmentId].map((id, index) => ({ id, name: `환경 ${index}`, baseUrls: { [serverId]: "https://shop.example.com" } })),
  });
  const backend = path.join(dir, "backend");
  await mkdir(backend);
  await workspace.saveAiChatSettings(projectId, { folders: { [serverId]: [backend] } });
  const scope = { projectId, environmentId };
  await workspace.importSpec({ ...scope, serverId }, spec(["/a", "/b"]));
  await workspace.importSpec({ projectId, environmentId: otherEnvironmentId, serverId }, spec(["/other"]));
  const aiDir = path.join(dir, "ai", projectId);
  const apis = async (file: string): Promise<string[]> => JSON.parse(await readFile(file, "utf8"))[0].apis.map((item: { api: string }) => item.api);
  return { dir, workspace, scope, serverId, otherEnvironmentId, aiDir, apis };
}

test("a filtered copy guide in another environment does not change the in-app chat's catalog or state", async () => {
  const { dir, workspace, scope, serverId, otherEnvironmentId, aiDir, apis } = await setup();
  try {
    const chat = await workspace.aiChatSetup({ scope });
    const catalog = path.join(aiDir, "chat", "api-catalog.json"), state = path.join(aiDir, "chat", "project-state.json");
    const originalState = await readFile(state, "utf8");
    const guide = await workspace.buildAiPrompt({ scope: { ...scope, environmentId: otherEnvironmentId }, operations: [`${serverId} GET /other`] });
    assert.ok(chat.prompt.includes(catalog) && chat.prompt.includes(state));
    assert.ok(guide.includes(path.join(aiDir, "api-catalog.json")) && guide.includes(path.join(aiDir, "scenarios.yaml")));
    assert.deepEqual(await apis(catalog), ["GET /a", "GET /b"]);
    assert.deepEqual(await apis(path.join(aiDir, "api-catalog.json")), ["GET /other"]);
    assert.equal(await readFile(state, "utf8"), originalState);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("refreshing the chat uses its own environment and includes spec and saved scenario changes", async () => {
  const { dir, workspace, scope, serverId, aiDir, apis } = await setup();
  try {
    await workspace.aiChatSetup({ scope });
    await workspace.importSpec({ ...scope, serverId }, spec(["/a", "/new"]));
    await workspace.saveScenario(scope, "name: 새 API 조회\nserver: 상점\nsteps:\n  - name: 조회\n    api: GET /new\n", {});
    await workspace.refreshAiChatFiles(scope);
    assert.deepEqual(await apis(path.join(aiDir, "chat", "api-catalog.json")), ["GET /a", "GET /new"]);
    const state = JSON.parse(await readFile(path.join(aiDir, "chat", "project-state.json"), "utf8"));
    assert.deepEqual(state.scenarios.map((item: { name: string }) => item.name), ["새 API 조회"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
