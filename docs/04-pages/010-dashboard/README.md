# 대시보드

실행 묶음의 누적 요약과 최근 5개 기록을 보여 주고 상세·재실행으로 연결합니다.

> 실행 기록과 요약은 renderer 메모리 상태이며 앱 재시작 시 복원되지 않습니다.

## 문서 목록

1. [개요](01-overview.md)
2. [사용자 흐름](02-userflow.md)
3. [상태 연동](03-api.md)
4. [엣지 케이스](04-edge-cases.md)

| 구분 | 위치 | 책임 |
| --- | --- | --- |
| 화면 | `src/renderer/pages/dashboard/DashboardPage.tsx` | 요약·최근 행 |
| 상세 | `src/renderer/widgets/RunReportDrawer.tsx` | 결과·실패 메시지·재실행 |
| 상태 | `src/renderer/app/App.tsx` | history, summary, drawer |

