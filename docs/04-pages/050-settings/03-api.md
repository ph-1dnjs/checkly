# [상태 연동] 설정

UPDATE 그룹은 IPC와 userData 파일에 연결됩니다. 나머지 그룹은 여전히 IPC, 파일 저장, HTTP API 호출이 없습니다.

| 값 | 출처 | 저장 |
| --- | --- | --- |
| appVersion | `update:check`/`app:version` mount 시 조회 | 없음 (조회만) |
| autoCheck | `update:get-settings` mount 시 조회, `update:set-auto-check`로 변경 | `userData/update-settings.json` |
| updateStatus | mount 시 `update:get-status`, 이후 `update:status` 구독으로 갱신 | main 프로세스 메모리(`latestUpdateStatus`), 재시작 시 초기화 |
| 기본 URL | App의 현재 `Scenario` prop | scenario 저장 흐름에 종속 |
| 환경 | 컴포넌트 상수 `dev` | 없음 |
| keepVideo | `useState(true)` | 없음 |
| notifyFail | `useState(true)` | 없음 |
| notifySlack | `useState(false)` | 없음 |

PROJECT·RUN DEFAULTS·NOTIFICATIONS를 실제 설정 기능으로 만들려면 schema, userData 저장 IPC, 앱 시작 복원, 실행 엔진·알림 소비 지점을 함께 설계해야 합니다.

