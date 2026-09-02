# 대시보드

실행 기록을 요약하고 선택한 기록을 다시 실행하는 화면입니다.

## 문서 목록

1. [개요](01-overview.md)
2. [사용자 흐름](02-userflow.md)
3. [API 연동](03-api.md)
4. [엣지 케이스](04-edge-cases.md)

| 구분 | 위치 | 책임 |
| --- | --- | --- |
| 화면 | `src/renderer/pages/dashboard/DashboardPage.tsx` | 요약·기록 표시 |
| 상세 | `src/renderer/widgets/RunReportDrawer.tsx` | 결과 상세·재실행 |
| 상태 | `src/renderer/app/App.tsx` | `runHistory`, `runSummary` |

