import assert from "node:assert/strict";
import test from "node:test";
import { readLastRun, writeLastRun, type ScenarioLastRun } from "../../src/renderer/pages/api-testing/scenario-last-run";

test("last run is isolated by project, environment and scenario and snapshots its input", () => {
  const snapshot = { result: { status: "passed", steps: [], variables: { id: 1 } }, preview: { scenario: { id: "s" } }, bindings: {}, completedAt: "2026-09-21T00:00:00Z" } as ScenarioLastRun;
  writeLastRun("p", "dev", "s", snapshot);
  snapshot.result.variables.id = 2;
  assert.equal(readLastRun("p", "dev", "s")?.result.variables.id, 1);
  assert.equal(readLastRun("p", "local", "s"), null);
  assert.equal(readLastRun("other", "dev", "s"), null);
  assert.equal(readLastRun("p", "dev", "other"), null);
});

test("keeps raw results in memory without reading or writing browser storage", () => {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("localStorage must not be used"); } });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => { throw new Error("sessionStorage must not be used"); } });
  try {
    const snapshot = { result: { status: "passed", steps: [{ id: "one", name: "one", status: "passed", durationMs: 1, request: { method: "POST", url: "https://example.test", headers: { Authorization: "Bearer private-token" }, body: { password: "private-password" } } }], variables: {} }, preview: { scenario: { id: "s", steps: [] } }, bindings: {}, completedAt: "2026-09-23T00:00:00Z" } as unknown as ScenarioLastRun;
    writeLastRun("memory-only", "dev", "s", snapshot);
    assert.deepEqual(readLastRun("memory-only", "dev", "s")?.result.steps[0].request?.body, { password: "private-password" });
    assert.equal(readLastRun("memory-only", "dev", "other"), null);
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
