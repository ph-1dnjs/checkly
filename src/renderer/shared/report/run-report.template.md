# {{statusIcon}} {{title}} — 실행 리포트

> **{{statusLabel}}** · 시나리오 {{scenarioCount}}개 · 통과율 {{passRate}} · 소요 {{duration}}
>
> 생성 {{generatedAt}} · Checkly

## 1. 요약

| 항목 | 값 |
| --- | --- |
| 전체 결과 | {{statusIcon}} {{statusLabel}} |
| 시나리오 | {{scenarioCount}}개 (통과 {{passedCount}} · 실패 {{failedCount}}) |
| 단계 | 총 {{stepTotal}} (통과 {{stepPassed}} · 실패 {{stepFailed}} · 미실행 {{stepSkipped}}) |
| 통과율 | {{passRate}} |
| 실행 시작 | {{startedAt}} |
| 실행 종료 | {{finishedAt}} |
| 소요 시간 | {{duration}} |

## 2. 시나리오 결과

{{scenarioTable}}

## 3. 실패 분석

{{failureSection}}

## 4. 시나리오별 상세

{{detailSection}}

## 5. 후속 조치

{{actionItems}}

## 6. 실행 환경

| 항목 | 값 |
| --- | --- |
| 브라우저 | Chromium (Playwright) |
| 리포트 ID | `{{reportId}}` |

---

_이 리포트는 Checkly가 시나리오 실행 결과로 자동 생성했습니다. 실행 로그는 각 시나리오 상세에 포함되어 있습니다._
