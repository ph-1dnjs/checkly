import test from "node:test";
import assert from "node:assert/strict";
import { readWorkspaceUrl, workspaceUrl } from "../../src/renderer/pages/api-testing/workspace-url";

test("workspace URL restores tabs and scope without replacing Swagger links", () => {
  const state = { tab: "scenarios" as const, projectId: "한글 project", serverId: "backend", environmentId: "dev" };
  for (const base of ["http://127.0.0.1:5174/?other=1#/tag/getItem", "file:///app/index.html?other=1#/tag/getItem"]) {
    const href = workspaceUrl(base, state);
    assert.deepEqual(readWorkspaceUrl(href), state);
    assert.equal(new URL(href).hash, "#/tag/getItem");
    assert.equal(new URL(href).searchParams.get("other"), "1");
    assert.equal(readWorkspaceUrl(workspaceUrl(href, { ...state, tab: "api" })).tab, "api");
    assert.equal(readWorkspaceUrl(workspaceUrl(href, { ...state, tab: "ai" })).tab, "ai");
  }
});
test("invalid tabs fall back and empty scope removes stale identifiers", () => {
  assert.equal(readWorkspaceUrl("http://localhost/?tab=unknown").tab, "api");
  const state = { tab: "api" as const, projectId: "", serverId: "", environmentId: "" };
  assert.deepEqual(readWorkspaceUrl(workspaceUrl("http://localhost/?project=old&server=old&environment=old", state)), state);
});
