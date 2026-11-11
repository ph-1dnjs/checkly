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

## 하단 배너

설정 맨 아래 배너는 두 장을 5초마다 가로로 밀어 넘깁니다.

| 순서 | 내용 |
| --- | --- |
| 1 | Checkly Recorder 홍보(파란 배경): 제목·한 줄 소개, 기능 3개(오류 순간 자동 기록·개인정보는 가림·팀에 바로 공유), 프로젝트 코드 로그인 안내. **바로가기**는 Chrome 웹 스토어 페이지(`RECORDER_STORE_URL`)를 외부 브라우저로 엽니다 |
| 2 | 앱 소개: Checkly 마크·태그라인·현재 버전 |

- 마우스·터치로 끌어 넘길 수 있습니다. 카드 너비의 18%를 넘게 끌면 다음·이전 장으로 넘어가고, 짧게 끌면 제자리로 돌아갑니다. 끌고 놓았을 때는 안의 링크가 열리지 않습니다.
- 마우스를 올리거나 키보드 포커스가 배너 안에 있으면 멈춥니다. 동작 줄이기(`prefers-reduced-motion`) 설정에서는 자동으로 넘기지 않습니다.
- 아래 점 버튼으로 원하는 장으로 이동합니다. 보이지 않는 장은 `inert`라서 포커스가 가지 않습니다.
- 확장 설치 여부는 앱에서 확인할 수 없어 표시하지 않습니다.
