import { test } from "node:test";
import assert from "node:assert/strict";
import { stringify } from "yaml";
import { parseScenario } from "../../src/app/api-testing/shared/scenario";
import { globalOptions } from "../../src/renderer/pages/api-testing/global-options";

test("global options separate values, prior extraction, future extraction and unresolved references", () => {
  const scenario = parseScenario(stringify({ version: 1, id: "current", name: "현재", steps: [
    { id: "login", name: "로그인", server: "backend", api: { method: "GET", path: "/login" }, extract: [{ source: "body", pointer: "/token", target: "globals.token" }] },
    { id: "read", name: "조회", server: "backend", api: { method: "GET", path: "/read" }, request: { headers: { A: "{{globals.missing}}" } }, extract: [{ source: "body", pointer: "/id", target: "globals.later" }] },
  ] }));
  const options = globalOptions(scenario, 1, [{ name: "existing", type: "string", displayValue: "SECRET" }], [], "dev");
  assert.equal(options.find(o => o.name === "token")?.status, "이전 단계에서 생성 예정");
  assert.equal(options.find(o => o.name === "later")?.status, "값 없음 · 선행 실행 필요");
  assert.equal(options.find(o => o.name === "missing")?.status, "미등록");
  assert.equal(options.find(o => o.name === "existing")?.status, "사용 가능");
  assert.ok(!JSON.stringify(options).includes("SECRET"));
  const saved = { id: scenario.id, name: scenario.name, source: stringify(scenario), bindings: {}, updatedAt: "now" };
  const changed = { ...scenario, steps: scenario.steps.map(s => ({ ...s, extract: [] })) };
  assert.ok(!globalOptions(changed, 1, [], [saved], "dev").some(o => o.name === "token"));
  const external = { ...saved, id: "external", source: stringify({ ...scenario, id: "external", environments: ["prod"] }) };
  assert.ok(!globalOptions(changed, 1, [], [external], "dev").some(o => o.name === "token"));
  assert.equal(globalOptions(changed, 1, [], [external], "prod").find(o => o.name === "token")?.status, "값 없음 · 선행 실행 필요");
});
