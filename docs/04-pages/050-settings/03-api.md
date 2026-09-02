# [상태 연동] 설정

IPC, 파일 저장, HTTP API 호출이 없습니다.

| 값 | 출처 | 저장 |
| --- | --- | --- |
| 기본 URL | App의 현재 `Scenario` prop | scenario 저장 흐름에 종속 |
| 환경 | 컴포넌트 상수 `dev` | 없음 |
| keepVideo | `useState(true)` | 없음 |
| notifyFail | `useState(true)` | 없음 |
| notifySlack | `useState(false)` | 없음 |

실제 설정 기능을 구현하려면 schema, userData 저장 IPC, 앱 시작 복원, 실행 엔진·알림 소비 지점을 함께 설계해야 합니다.

