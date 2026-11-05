import { test } from "node:test";
import assert from "node:assert/strict";
import { aiFixFailures, aiFixPrompt, aiFixResponse } from "../../src/renderer/features/api-testing/author-scenarios/model/ai-fix";
import type { ApiScenarioResult } from "../../src/app/api-testing/shared/workspace";

const result: ApiScenarioResult = { status: "failed", variables: {}, steps: [
  { id: "a", name: "로그인", status: "passed", httpStatus: 200, durationMs: 1, body: { token: "t" } },
  { id: "b", name: "수정 신청", status: "failed", httpStatus: 400, durationMs: 1, error: "HTTP 400: 주소 abc", failure: { kind: "http" }, body: { message: "주소 필수", data: [{ accessToken: "t1", refresh_token: "t2" }] } },
  { id: "c", name: "거절", status: "skipped", durationMs: 0 },
] };

test("AI로 고치기 tells only where the run failed: step, kind and HTTP status, never the message", () => {
  assert.deepEqual(aiFixFailures(result), ["2단계 '수정 신청' 실패 · HTTP 오류 상태 · HTTP 400"]);
  assert.deepEqual(aiFixFailures({ ...result, status: "passed", steps: [result.steps[0]!] }), []);
});

test("the response sent on request is the failed step's body with secret-looking keys masked, cut to a limit", () => {
  const expected = JSON.stringify({ message: "주소 필수", data: [{ accessToken: "***", refresh_token: "***" }] }, null, 1);
  assert.equal(aiFixResponse(result), expected);
  assert.equal(aiFixResponse(result, 5), `${expected.slice(0, 5)}…`);
  assert.equal(aiFixResponse({ ...result, steps: [{ ...result.steps[1]!, body: undefined }] }), undefined);
});

test("external repair prompt includes failure context and only the masked response the user opted to include", () => {
  const prompt = aiFixPrompt({ scenarioName: "상품 등록", request: "주소 검증을 봐줘", failures: aiFixFailures(result), response: aiFixResponse(result) });
  assert.match(prompt, /상품 등록/);
  assert.match(prompt, /주소 검증을 봐줘/);
  assert.match(prompt, /2단계 '수정 신청' 실패 · HTTP 오류 상태 · HTTP 400/);
  assert.match(prompt, /accessToken.*\*\*\*/);
  assert.match(prompt, /## 목표[\s\S]*실패 원인을 시나리오 설정 관점에서 확인하고, 설정 오류라면 바로잡아 주세요/);
  assert.match(prompt, /## 확인/);
  assert.match(prompt, /앞 단계에서 준비하는 데이터와 시나리오 실행 순서/);
  assert.match(prompt, /기대 상태 코드와 응답 검증/);
  assert.match(prompt, /## 수정 범위[\s\S]*MCP로 수정할 수 있으면 YAML을 검증한 뒤 Checkly에 저장/);
  assert.match(prompt, /백엔드 소스 코드와 테스트는 수정하지 말고,? 시나리오도 실행하지 마세요/);
  assert.match(prompt, /## 결과/);
  assert.doesNotMatch(prompt, /백엔드 저장소의 API 계약|회귀 테스트를 추가/);
  assert.doesNotMatch(prompt, /주소 abc|refresh_token": "t2/);
});
