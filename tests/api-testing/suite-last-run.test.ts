import test from "node:test";
import assert from "node:assert/strict";
import { readLastSuiteRun, writeLastSuiteRun, type SuiteLastRun } from "../../src/renderer/entities/api-testing/model/suite-last-run";

const report: SuiteLastRun["report"] = {
  suiteName: "로그인 점검",
  projectName: "쇼핑몰",
  environmentName: "dev",
  startedAt: "2026-11-03T01:00:00.000Z",
  completedAt: "2026-11-03T01:00:01.000Z",
  status: "passed",
  scenarios: [{ id: "scenario-1", name: "로그인", status: "passed", durationMs: 1000, steps: [] }],
};

test("latest suite run is restored for the same project, environment and unchanged suite", () => {
  const value: SuiteLastRun = { suiteUpdatedAt: "suite-v1", report, blocked: {}, results: {} };
  writeLastSuiteRun("project-1", "dev", "suite-1", value);
  assert.deepEqual(readLastSuiteRun("project-1", "dev", "suite-1", "suite-v1"), value);
  assert.equal(readLastSuiteRun("project-1", "stage", "suite-1", "suite-v1"), null);
  assert.equal(readLastSuiteRun("project-1", "dev", "suite-1", "suite-v2"), null);
});

test("restored suite results are copied so later UI edits cannot mutate the cached record", () => {
  const restored = readLastSuiteRun("project-1", "dev", "suite-1", "suite-v1")!;
  restored.report.scenarios[0].name = "바뀐 이름";
  assert.equal(readLastSuiteRun("project-1", "dev", "suite-1", "suite-v1")?.report.scenarios[0].name, "로그인");
});
