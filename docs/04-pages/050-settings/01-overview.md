# [개요] 설정

> **범위**: 하단 설정 진입부터 로컬 토글 변경까지입니다.

## 표시 항목

| 그룹 | 항목 | 현재 값·동작 |
| --- | --- | --- |
| UPDATE | 현재 버전 | `app:version` 조회, 상태 문구는 `electron-updater` 이벤트 반영 |
| UPDATE | 지금 확인 / 재시작하여 설치 | `update:check` 수동 호출, 다운로드 완료 시 `update:install`로 교체 |
| UPDATE | 자동 업데이트 확인 | userData의 `update-settings.json`에 저장되는 실제 토글 |
| UPDATE | 다운로드 | GitHub Releases 최신 페이지로 외부 링크 |
| PROJECT | 기본 URL | 현재 `scenario.url` 읽기 전용 |
| PROJECT | 환경 | 고정 문자열 `dev` |
| RUN DEFAULTS | 기본 브라우저 | 고정 `Chromium`, 변경 버튼 미동작 |
| RUN DEFAULTS | 실행 영상 보관 | 로컬 boolean 토글, 초기 true |
| NOTIFICATIONS | 실패 시 알림 | 로컬 boolean 토글, 초기 true |
| NOTIFICATIONS | Slack 연동 | 로컬 boolean 토글, 초기 false |

RUN DEFAULTS·NOTIFICATIONS의 보관 기간·전송 시점·채널 안내는 UI 문구이며 main 서비스나 외부 연동 근거가 없습니다.

