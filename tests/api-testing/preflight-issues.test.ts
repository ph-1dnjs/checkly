import { test } from "node:test";
import assert from "node:assert/strict";
import { groupMissingGlobals, issueGlobal, missingGlobalIssue, stepNumbersText } from "../../src/app/api-testing/shared/preflight-issues";

const missing = (step: number, name: string, global: string, auth = false) => `${step}단계 · ${name}: ${auth ? "인증 " : ""}전역변수 '${global}' 값이 없습니다. 전역변수에서 설정하세요`;

test("a missing global is read with its step, for value and auth uses alike", () => {
  assert.deepEqual(missingGlobalIssue(missing(2, "상품 조회", "itemId")), { name: "itemId", step: 2 });
  assert.deepEqual(missingGlobalIssue(missing(1, "로그인", "accessToken", true)), { name: "accessToken", step: 1 });
  // Step names may contain ": " themselves.
  assert.deepEqual(missingGlobalIssue(missing(3, "GET /a: 상세", "token")), { name: "token", step: 3 });
  // Without a step prefix (already grouped text) the name is still read.
  assert.deepEqual(missingGlobalIssue("전역변수 'token' 값이 없습니다. 전역변수에서 설정하세요"), { name: "token" });
});

test("a malformed token or any other issue is not a missing global, but still names its global", () => {
  const malformed = "1단계 · 로그인: 인증 전역변수 'accessToken'는 Bearer 접두사 없는 토큰 문자열이어야 합니다";
  assert.equal(missingGlobalIssue(malformed), undefined);
  assert.equal(issueGlobal(malformed), "accessToken");
  assert.equal(missingGlobalIssue("1단계 · 로그인: 서버 기본 URL을 환경 설정에서 지정하세요"), undefined);
  assert.equal(issueGlobal("1단계 · 로그인: 서버 기본 URL을 환경 설정에서 지정하세요"), undefined);
});

test("missing globals group into one entry per global with their steps, others stay once and in order", () => {
  const other = "2단계 · 상세: 서버 기본 URL을 환경 설정에서 지정하세요";
  const malformed = "3단계 · 수정: 인증 전역변수 'adminToken'는 Bearer 접두사 없는 토큰 문자열이어야 합니다";
  const grouped = groupMissingGlobals([
    missing(1, "등록", "accessToken", true), other, missing(2, "상세", "accessToken", true),
    missing(2, "상세", "itemId"), missing(2, "상세", "accessToken"), malformed, other,
  ]);
  assert.deepEqual(grouped, {
    globals: [{ name: "accessToken", steps: [1, 2] }, { name: "itemId", steps: [2] }],
    others: [other, malformed],
  });
  assert.deepEqual(groupMissingGlobals([]), { globals: [], others: [] });
});

test("step numbers read short: three or more in a row become a range", () => {
  assert.equal(stepNumbersText([1, 2, 3, 4, 5, 6]), "1~6");
  assert.equal(stepNumbersText([1, 2]), "1·2");
  assert.equal(stepNumbersText([5, 1, 2, 3, 7, 8]), "1~3·5·7·8");
  assert.equal(stepNumbersText([3, 3]), "3");
  assert.equal(stepNumbersText([]), "");
});
