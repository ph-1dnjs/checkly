import test from "node:test";
import assert from "node:assert/strict";
import { parseScenario } from "../../src/app/api-testing/shared/scenario";
import { configuredFields, isArrayIndexSegment } from "../../src/renderer/entities/api-testing/lib/settings-summary-model";

test("summary classifies configured values and detects broken links without mutating draft", () => {
  const scenario = parseScenario(`name: test\nserver: backend\nsteps:\n  - api: POST /login\n    body:\n      login: '{{globals.login}}'\n      enabled: false\n  - api: POST /verify\n    inputs: [{name: code}]\n    body:\n      token: '{{steps.1.response.body./data/token}}'\n      code: '{{inputs.code}}'\n`);
  const before = JSON.stringify(scenario);
  const first = configuredFields(scenario, 0);
  assert.equal(first[0].global, "login");
  assert.equal(first[1].label, "false");
  assert.equal(first[1].direct, true);
  const second = configuredFields(scenario, 1);
  assert.equal(second[0].label, "1단계 응답 /data/token");
  assert.equal(second[1].label, "실행 중 입력");
  assert.equal(JSON.stringify(scenario), before);
  scenario.valueBindings[0].step = "missing";
  assert.equal(configuredFields(scenario, 1)[0].warning, "출처 삭제됨");
});

test("array values keep their positions as array segments", () => {
  const scenario = parseScenario(`name: test\nserver: backend\nsteps:\n  - api: POST /items\n    body:\n      tags: [demo, sale]\n`);
  const fields = configuredFields(scenario, 0);
  assert.deepEqual(fields.map(field => field.field), ["body.tags[0]", "body.tags[1]"]);
  assert.ok(fields.every(field => isArrayIndexSegment(field.path[2])));
});
