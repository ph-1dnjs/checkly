import { test } from "node:test";
import assert from "node:assert/strict";
import { problemReport } from "../../src/renderer/features/api-testing/author-scenarios/model/problem-report";
import type { ApiAiDraft } from "../../src/app/api-testing/shared/workspace";

const draft = (patch: Partial<ApiAiDraft>): ApiAiDraft => ({ id: "scenario-0b6c7e1a-0000-4000-8000-000000000001", name: "로그인", yaml: "", stepCount: 1, issues: [], notices: [], executionIssues: [], ...patch });

test("nothing to fix, nothing to copy (notes and pre-run settings alone are not problems)", () => {
  assert.equal(problemReport({ drafts: [draft({ notices: ["같은 이름의 시나리오가 이미 있습니다."], executionIssues: ["1단계: 전역변수 'token' 값이 없습니다. 전역변수에서 설정하세요"] })], suite: null }), "");
  assert.equal(problemReport({ drafts: [], suite: { name: "흐름", scenarioIds: [], problems: [] } }), "");
});

test("the report names scenarios as the AI wrote them, with notes marked, and never Checkly's ids", () => {
  const report = problemReport({
    drafts: [
      draft({ name: "토큰 발급" }),
      draft({ id: "scenario-2", name: "상품 리뷰", issues: ["상품 리뷰 조회: GET /products/{itemId}/reviews는 명세에 없는 API입니다"], notices: ["같은 이름의 시나리오가 이미 있습니다. 저장하면 같은 이름이 하나 더 생깁니다"], executionIssues: ["1·2단계: 전역변수 'token' 값이 없습니다. '토큰 발급'을(를) 먼저 실행하면 만들어집니다"] }),
    ],
    suite: { name: "흐름", scenarioIds: [], problems: ["스위트의 '없는 시나리오'가 이번 결과와 기존 시나리오 이름에 없습니다"] },
  });
  assert.equal(report, [
    "Checkly 검사에서 아래 문제가 나왔습니다. 문제를 고친 전체 결과(모든 시나리오와 스위트)를 같은 결과 파일에 다시 저장하세요. id는 쓰지 마세요.",
    "### 2번째 시나리오 · 상품 리뷰\n- 상품 리뷰 조회: GET /products/{itemId}/reviews는 명세에 없는 API입니다\n- (참고) 같은 이름의 시나리오가 이미 있습니다. 저장하면 같은 이름이 하나 더 생깁니다\n- (실행 전 확인, YAML 문제가 아닐 수 있음) 1·2단계: 전역변수 'token' 값이 없습니다. '토큰 발급'을(를) 먼저 실행하면 만들어집니다",
    "### 스위트\n- 스위트의 '없는 시나리오'가 이번 결과와 기존 시나리오 이름에 없습니다",
    "명세에 없는 API는 API 파일(api-catalog.json)에 있는 api 값을 그대로 쓰세요. 파일에 없는 API는 쓸 수 없습니다.",
  ].join("\n\n"));
  assert.doesNotMatch(report, /scenario-/);
});

test("a same-name note is not sent back: the AI would rename and leave duplicates", () => {
  const sameName = "같은 이름의 시나리오가 이미 있습니다. 저장하면 같은 이름이 하나 더 생깁니다";
  const report = problemReport({ drafts: [draft({ name: "로그인", issues: ["YAML 오류: 3단계 연결은 앞선 단계만 참조할 수 있습니다 (5단계)"], notices: [sameName], sameName: true })], suite: null });
  assert.match(report, /### 1번째 시나리오 · 로그인\n- YAML 오류/);
  assert.doesNotMatch(report, /같은 이름의 시나리오/);
});
