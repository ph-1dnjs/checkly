# 설정

현재 시나리오의 기본 URL, 앱 업데이트 확인·설치, 실행·알림 관련 표시용 설정을 보여 줍니다.

> **IMPORTANT**: UPDATE 그룹만 실제 main 프로세스(`electron-updater`, userData 파일)에 연결됩니다. PROJECT·RUN DEFAULTS·NOTIFICATIONS는 여전히 표시용이며 파일 저장이나 알림·Slack 시스템에 연결되지 않습니다.

## 문서 목록

1. [개요](01-overview.md)
2. [사용자 흐름](02-userflow.md)
3. [상태 연동](03-api.md)
4. [엣지 케이스](04-edge-cases.md)

| 구분 | 위치 | 책임 |
| --- | --- | --- |
| 화면 | `src/renderer/pages/settings/SettingsPage.tsx` | 설정 표시와 임시 토글 |
| 입력 | `src/renderer/app/App.tsx` | 현재 scenario 전달 |

