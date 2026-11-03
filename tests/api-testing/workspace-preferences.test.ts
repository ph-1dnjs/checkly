import test from "node:test";
import assert from "node:assert/strict";
import type { ApiMcpStatus, ApiProject } from "../../src/app/api-testing/shared/workspace";
import { readWorkspacePreference, resolveWorkspacePreference, writeWorkspacePreference } from "../../src/renderer/pages/api-testing/lib/workspace-preferences";

const project = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "프로젝트",
  servers: [
    { id: "00000000-0000-4000-8000-000000000002", name: "개발 서버" },
    { id: "00000000-0000-4000-8000-000000000003", name: "운영 서버" },
  ],
  environments: [
    { id: "00000000-0000-4000-8000-000000000004", name: "개발", baseUrls: {} },
    { id: "00000000-0000-4000-8000-000000000005", name: "운영", baseUrls: {} },
  ],
} as ApiProject;
const none: ApiMcpStatus = { enabled: false };

test("workspace server and environment preference round-trip in local storage", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const saved = { serverId: project.servers[1].id, environmentId: project.environments[1].id };
  writeWorkspacePreference(project.id, saved, storage);
  assert.deepEqual(readWorkspacePreference(project.id, storage), saved);
  assert.equal(readWorkspacePreference("another-project", storage), null);
});

test("URL selection wins, then saved local selection, then the remembered MCP environment", () => {
  const saved = { serverId: project.servers[1].id, environmentId: project.environments[0].id };
  const mcp: ApiMcpStatus = { enabled: true, projectId: project.id, environmentId: project.environments[1].id, url: "", token: "" };
  assert.deepEqual(resolveWorkspacePreference(project, { serverId: project.servers[0].id, environmentId: "" }, saved, mcp), {
    serverId: project.servers[0].id,
    environmentId: project.environments[0].id,
  });
  assert.deepEqual(resolveWorkspacePreference(project, { serverId: "", environmentId: "" }, null, mcp), {
    serverId: project.servers[0].id,
    environmentId: project.environments[1].id,
  });
});

test("removed server or environment selections fall back to current project options", () => {
  assert.deepEqual(resolveWorkspacePreference(project, { serverId: "removed", environmentId: "removed" }, {
    serverId: "removed", environmentId: "removed",
  }, none), { serverId: project.servers[0].id, environmentId: project.environments[0].id });
});
