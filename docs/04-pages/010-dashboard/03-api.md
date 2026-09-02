# [API 연동] 대시보드

외부 API 호출은 없습니다. `RunRecord`는 실행 완료 후 `App`에서 생성되어 `DashboardPage`와 `RunReportDrawer`에 전달됩니다.

| 상태 | 저장 위치 | 초기화 |
| --- | --- | --- |
| 실행 기록 | React `runHistory` | 앱 새로고침/재시작 |
| 실행 요약 | React `runSummary` | 앱 새로고침/재시작 |

