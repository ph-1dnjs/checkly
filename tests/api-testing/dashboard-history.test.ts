import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiWorkspace } from "../../src/app/api-testing/main/workspace";

const projectId = "f2f1fe24-8aca-47b6-8dd6-6ff41098bd33";
const environmentId = "4ff88cd1-c85b-4986-a0d7-b6c5bc44a4ac";

test("blocked suite scenarios store only dashboard metadata in the signed-in project", async () => {
  const inserted: Array<Record<string, unknown>> = [];
  const client = { from: (table: string) => {
    assert.equal(table, "api_scenario_runs");
    return { insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null }; } };
  } } as unknown as SupabaseClient;
  const workspace = new ApiWorkspace("/unused", () => ({ client, projectId, userId: "user-id", projectCode: "team" }), false);
  await workspace.recordBlockedScenario({ projectId, environmentId }, "scenario-1", "결제 확인");
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].project_id, projectId);
  assert.equal(inserted[0].status, "blocked");
  assert.equal(inserted[0].environment_id, environmentId);
  assert.deepEqual(Object.keys(inserted[0]).sort(), ["created_by", "ended_at", "environment_id", "id", "project_id", "scenario_id", "scenario_name", "started_at", "status"].sort());
  await assert.rejects(workspace.recordBlockedScenario({ projectId: environmentId, environmentId }, "scenario-1", "결제 확인"), /프로젝트/);
  assert.equal(inserted.length, 1);
});

test("blocked history does not write to Supabase when signed out", async () => {
  const workspace = new ApiWorkspace("/unused", () => null, false);
  await assert.rejects(workspace.recordBlockedScenario({ projectId, environmentId }, "scenario-1", "결제 확인"), /로그인/);
});
