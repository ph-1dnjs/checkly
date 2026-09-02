# [상태 연동] 대시보드

외부 API와 IPC를 직접 호출하지 않습니다. `App`이 실행 완료 후 상태를 만들고 props로 전달합니다.

| 상태 | 생성 | 보관 | 초기화 |
| --- | --- | --- | --- |
| `runHistory` | `recordRun` | 최신 5개 | 앱 새로고침·재시작 |
| `runSummary` | 실행 묶음 완료 | 누적 total/passed/failed | 앱 새로고침·재시작 |
| `openRunRecord` | 행 선택 | 선택 record 또는 null | 서랍 닫기 |
| `results` | 각 `qa:start` 응답 | record 내부 | 기록과 동일 |

리포트 디렉터리의 JSON/HTML과 dashboard 기록은 연결되지 않습니다. 앱 시작 시 파일에서 과거 기록을 읽지 않습니다.

