# [상태 연동] 대시보드

`useRunOrchestration`이 로그인한 프로젝트의 DB 기록을 복원하고 실행 완료 후 저장하며, 대시보드는 props로 전달받습니다. 취소된 묶음도 기록으로 남습니다.

| 상태            | 생성               | 보관                     | 초기화             |
| --------------- | ------------------ | ------------------------ | ------------------ |
| `runHistory`    | `recordRun`        | 최신 50개                 | 로그인 시 DB에서 복원 |
| `runSummary`    | 실행 묶음 완료     | 누적 total/passed/failed | 로그인 시 DB에서 복원 |
| `openRunRecord` | 행 선택            | 선택 record 또는 null    | 서랍 닫기          |
| `results`       | 각 `qa:start` 응답 | record 내부              | 기록과 동일        |

리포트 디렉터리의 JSON/HTML과 dashboard 기록은 연결되지 않습니다. 앱 시작 시 파일에서 과거 기록을 읽지 않습니다.
