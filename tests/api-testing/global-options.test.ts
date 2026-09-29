import { test } from "node:test";
import assert from "node:assert/strict";
import { stringify } from "yaml";
import { parseScenario, stringifyScenario } from "../../src/app/api-testing/shared/scenario";
import { globalOptions, globalProducerScenarios } from "../../src/renderer/pages/api-testing/global-options";

test("global options separate values, prior extraction, future extraction and unresolved references", () => {
  const scenario = parseScenario(stringify({ id: "current", name: "현재", server: "backend", steps: [
    { name: "로그인", api: "GET /login", extract: [{ pointer: "/token", target: "globals.token" }] },
    { name: "조회", api: "GET /read", headers: { A: "{{globals.missing}}" }, extract: [{ pointer: "/id", target: "globals.later" }] },
  ] }));
  const options = globalOptions(scenario, 1, [{ name: "existing", type: "string", displayValue: "SECRET" }], [], "dev");
  assert.equal(options.find(o => o.name === "token")?.status, "이전 단계에서 생성 예정");
  assert.equal(options.find(o => o.name === "later")?.status, "값 없음 · 선행 실행 필요");
  assert.equal(options.find(o => o.name === "missing")?.status, "미등록");
  assert.equal(options.find(o => o.name === "existing")?.status, "사용 가능");
  assert.ok(!JSON.stringify(options).includes("SECRET"));
  const saved = { id: scenario.id, name: scenario.name, source: stringifyScenario(scenario, true), bindings: {}, updatedAt: "now" };
  const changed = { ...scenario, steps: scenario.steps.map(s => ({ ...s, extract: [] })) };
  assert.ok(!globalOptions(changed, 1, [], [saved], "dev").some(o => o.name === "token"));
  const external = { ...saved, id: "external", source: stringifyScenario({ ...scenario, id: "external", environments: ["prod"] }, true) };
  assert.ok(!globalOptions(changed, 1, [], [external], "dev").some(o => o.name === "token"));
  assert.equal(globalOptions(changed, 1, [], [external], "prod").find(o => o.name === "token")?.status, "값 없음 · 선행 실행 필요");
});

test("missing global lists every runnable producer but excludes current, draft and other environments", () => {
  const item = (id: string, name: string, environment?: string, draft = false) => ({
    id, name, draft, bindings: {}, updatedAt: "now",
    source: stringify({ id, name, server: "backend", ...(environment ? { environments: [environment] } : {}), steps: [
      { api: "GET /login", extract: [{ pointer: "/token", target: "globals.token" }] },
    ] }),
  });
  const saved = [item("a", "관리자 로그인"), item("b", "사용자 로그인"), item("current", "현재"), item("draft", "초안", undefined, true), item("prod", "운영 로그인", "prod")];
  assert.deepEqual(globalProducerScenarios("token", saved, "current", "dev"), ["관리자 로그인", "사용자 로그인"]);
  assert.deepEqual(globalProducerScenarios("other", saved, "current", "dev"), []);
});
