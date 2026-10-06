import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { RunRecord } from "../src/renderer/shared/model/scenario";
import {
  buildRunReportMarkdown,
  runReportFileName,
  stepOutcomes,
} from "../src/renderer/shared/report/run-report";

const template = readFileSync(
  new URL("../src/renderer/shared/report/run-report.template.md", import.meta.url),
  "utf8",
);

const login = {
  id: "a::scenario-0",
  title: "로그인",
  url: "https://example.com/login",
  tag: "smoke",
  steps: [
    { id: "1", action: "goto" as const, target: "/login" },
    { id: "2", action: "fill" as const, target: "이메일", value: "qa@example.com" },
    { id: "3", action: "click" as const, target: "로그인" },
  ],
};
const order = {
  id: "a::scenario-1",
  title: "주문 | 결제",
  url: "https://example.com/order",
  steps: [
    { id: "1", action: "goto" as const, target: "/order" },
    { id: "2", action: "click" as const, target: "결제하기" },
    { id: "3", action: "expectText" as const, target: "결제 완료" },
  ],
};

const record: RunRecord = {
  id: "1700000000000",
  scenarios: [login, order],
  status: "failed",
  passed: 1,
  failed: 1,
  startedAt: "2026-10-06T01:00:00.000Z",
  ranAt: "2026-10-06T01:01:05.000Z",
  results: [
    { scenario: login, status: "passed", elapsedSeconds: 12, log: ["단계 1: /login goto — 완료"] },
    {
      scenario: order,
      status: "failed",
      failedStepIndex: 1,
      message: "결제하기 요소를 찾지 못했습니다.",
      elapsedSeconds: 30,
      log: ["단계 1: /order goto — 완료", "단계 2: 결제하기 click — 실패"],
    },
  ],
};

test("실패 시나리오의 단계 결과는 실패 지점 기준으로 나뉜다", () => {
  assert.deepEqual(stepOutcomes(record.results[1]), ["passed", "failed", "skipped"]);
  assert.deepEqual(
    stepOutcomes({ ...record.results[1], failedStepIndex: 99 }),
    ["passed", "passed", "failed"],
  );
});

test("템플릿의 모든 자리 표시자를 채운 Markdown 리포트를 만든다", () => {
  const markdown = buildRunReportMarkdown(record, template, new Date("2026-10-06T02:00:00Z"));
  assert.doesNotMatch(markdown, /\{\{\w+\}\}/);
  assert.match(markdown, /^# ❌ 전체 회귀 · 2개 시나리오 — 실행 리포트/);
  assert.match(markdown, /\| 통과율 \| 50% \|/);
  assert.match(markdown, /총 6 \(통과 4 · 실패 1 · 미실행 1\)/);
  assert.match(markdown, /\| 소요 시간 \| 1분 05초 \|/);
  assert.match(markdown, /주문 \\\| 결제/);
  assert.match(markdown, /\*\*실패 단계\*\*: STEP 2 · 클릭/);
  assert.match(markdown, /- \[ \] \*\*주문 \| 결제\*\* STEP 2 실패 원인 확인/);
  assert.match(markdown, /```text\n단계 1: \/order goto — 완료/);
});

test("모두 통과하면 실패 분석 대신 안내 문구를 넣는다", () => {
  const passed: RunRecord = {
    ...record,
    scenarios: [login],
    status: "passed",
    passed: 1,
    failed: 0,
    results: [record.results[0]],
  };
  const markdown = buildRunReportMarkdown(passed, template);
  assert.match(markdown, /^# ✅ 로그인 — 실행 리포트/);
  assert.match(markdown, /실패한 시나리오가 없습니다/);
});

test("리포트 파일 이름은 파일 시스템에 안전한 문자만 쓴다", () => {
  const name = runReportFileName({ ...record, scenarios: [order] });
  assert.match(name, /^checkly-report_주문_결제_\d{8}-\d{6}\.md$/);
});
