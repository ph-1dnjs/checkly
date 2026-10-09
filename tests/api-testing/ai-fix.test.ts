import { test } from "node:test";
import assert from "node:assert/strict";
import { aiFixFailures, aiFixResponse } from "../../src/renderer/features/api-testing/author-scenarios/model/ai-fix";
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
