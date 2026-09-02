# 설정

현재 시나리오의 기본 URL과 실행·알림 관련 표시용 설정을 보여 줍니다.

> **IMPORTANT**: 현재 설정은 실제 실행 정책, 파일 저장, 알림·Slack 시스템에 연결되지 않습니다.

## 문서 목록

1. [개요](01-overview.md)
2. [사용자 흐름](02-userflow.md)
3. [상태 연동](03-api.md)
4. [엣지 케이스](04-edge-cases.md)

| 구분 | 위치 | 책임 |
| --- | --- | --- |
| 화면 | `src/renderer/pages/settings/SettingsPage.tsx` | 설정 표시와 임시 토글 |
| 입력 | `src/renderer/app/App.tsx` | 현재 scenario 전달 |

