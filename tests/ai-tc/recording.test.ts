import { strict as assert } from "node:assert";
import { test } from "node:test";
import { recordStep } from "../../src/app/ipc/ai-tc/recording";

test("준비 데이터로 입력을 연결하고 모호한 값은 저장하지 않는다", () => {
  const action = { type: "fill" as const, target: { label: "이름" }, value: "민감한 값" };
  assert.deepEqual(recordStep(action, [{ label: "이름", value: "민감한 값" }]), { type: "fill", target: { label: "이름" }, dataLabel: "이름" });
  assert.equal(recordStep(action, []).type, "manual");
  assert.equal(recordStep(action, [{ label: "A", value: "민감한 값" }, { label: "B", value: "민감한 값" }]).type, "manual");
});

test("이전 판정과 근거는 재실행 후보에 포함하지 않는다", () => {
  const step = recordStep({ type: "judge", expected: "E1", verdict: "pass", observation: "이전 결과", basis: [] }, []);
  assert.deepEqual(step, { type: "verify", expected: "E1", approved: false });
});

test("모델이 제안한 검증 조건은 승인 전 후보로 남는다", () => {
  const step = recordStep({ type: "judge", expected: "E1", verdict: "pass", observation: "완료", basis: [], assertion: { type: "visibleText", text: "완료" } }, []);
  assert.deepEqual(step, { type: "verify", expected: "E1", approved: false, candidate: { type: "visibleText", text: "완료" } });
});

test("입력값이 포함된 문구는 고정 자동 검증 조건으로 저장하지 않는다", () => {
  const step = recordStep({ type: "judge", expected: "E1", verdict: "pass", observation: "등록", basis: [], assertion: { type: "visibleText", text: "사과 등록 완료" } }, [{ label: "상품명", value: "사과" }]);
  assert.deepEqual(step, { type: "verify", expected: "E1", approved: false });
});

test("안전한 이동과 키·스크롤을 기록하고 민감한 URL은 수동 처리한다", () => {
  assert.deepEqual(recordStep({ type: "goto", url: "https://example.com/path" }, []), { type: "goto", url: "https://example.com/path" });
  assert.equal(recordStep({ type: "goto", url: "https://example.com/path?token=secret" }, []).type, "manual");
  assert.deepEqual(recordStep({ type: "press", key: "Enter" }, []), { type: "press", key: "Enter" });
  assert.deepEqual(recordStep({ type: "scroll", direction: "down" }, []), { type: "scroll", direction: "down" });
});
