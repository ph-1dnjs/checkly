import test from "node:test";
import assert from "node:assert/strict";
import { readWorkspaceUrl, workspaceUrl } from "../../src/renderer/pages/api-testing/lib/workspace-url";

test("workspace URL restores tabs and scope without replacing Swagger links", () => {
  const state = { tab: "scenarios" as const, projectId: "한글 project", serverId: "backend", environmentId: "dev", scenarioId: "" };
  for (const base of ["http://127.0.0.1:5174/?other=1#/tag/getItem", "file:///app/index.html?other=1#/tag/getItem"]) {
    const href = workspaceUrl(base, state);
    assert.deepEqual(readWorkspaceUrl(href), state);
    assert.equal(new URL(href).hash, "#/tag/getItem");
    assert.equal(new URL(href).searchParams.get("other"), "1");
    assert.equal(readWorkspaceUrl(workspaceUrl(href, { ...state, tab: "api" })).tab, "api");
    assert.equal(readWorkspaceUrl(workspaceUrl(href, { ...state, tab: "ai" })).tab, "ai");
    assert.equal(readWorkspaceUrl(workspaceUrl(href, { ...state, tab: "scenario-editor", scenarioId: "scenario-1" })).scenarioId, "scenario-1");
  }
});
test("invalid tabs fall back and empty scope removes stale identifiers", () => {
  assert.equal(readWorkspaceUrl("http://localhost/?tab=unknown").tab, "api");
  const state = { tab: "api" as const, projectId: "", serverId: "", environmentId: "", scenarioId: "" };
  assert.deepEqual(readWorkspaceUrl(workspaceUrl("http://localhost/?project=old&server=old&environment=old", state)), state);
});
test("starting a new scenario clears the previous Swagger endpoint only when requested", () => {
  const base = "http://127.0.0.1:5174/?tab=scenarios&scenarioId=old#/customers/getCustomerInquiries";
  const state = { tab: "scenario-editor" as const, projectId: "project", serverId: "server", environmentId: "dev", scenarioId: "" };
  const fresh = new URL(workspaceUrl(base, state, true));
  assert.equal(fresh.hash, "");
  assert.equal(fresh.searchParams.has("scenarioId"), false);
  assert.equal(new URL(workspaceUrl(base, { ...state, scenarioId: "existing" })).hash, "#/customers/getCustomerInquiries");
});

test("another project or server drops the Swagger hash; a tab change keeps it", () => {
  const base = "http://127.0.0.1:5174/?tab=api&project=p1&server=s1&environment=dev#/진단/serverError";
  const state = { tab: "scenarios" as const, projectId: "p1", serverId: "s1", environmentId: "dev", scenarioId: "" };
  const hash = new URL(base).hash;
  assert.equal(new URL(workspaceUrl(base, state)).hash, hash);
  assert.equal(new URL(workspaceUrl(base, { ...state, environmentId: "prod" })).hash, hash);
  assert.equal(new URL(workspaceUrl(base, { ...state, projectId: "p2" })).hash, "");
  assert.equal(new URL(workspaceUrl(base, { ...state, tab: "api", serverId: "s2" })).hash, "");
});
