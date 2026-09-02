# Checkly 개발 문서

본 디렉터리는 Checkly의 개발과 인수인계를 위한 코드 기반 문서입니다. Checkly는 Markdown 시나리오를 편집하고 Playwright Chromium으로 실행하는 Electron 데스크톱 QA 도구입니다.

> **문서 기준**: 2026-09-02 현재 저장소의 코드와 설정을 기준으로 합니다. 구현에서 확인되지 않은 운영 정책이나 UI에만 존재하는 기능은 `미확인`, `미구현`, `표시 전용`으로 명시합니다.

## 문서 목적

- Electron main/preload/renderer의 책임과 데이터 흐름을 빠르게 파악합니다.
- Markdown 시나리오의 문법과 9개 실행 액션을 이해합니다.
- 편집·선택·실행·기록·설정 화면의 정상 흐름과 예외를 확인합니다.
- 파일 시스템, Playwright, IPC, 영상·리포트 처리의 보안 경계를 공유합니다.
- 기능 변경 시 함께 갱신할 코드와 문서를 찾을 수 있게 합니다.

## Documentation

| 순서 | 문서 | 설명 |
| --- | --- | --- |
| 01 | [Quick Start](01-quick-start/README.md) | 요구 도구, 설치, 실행, 검증 |
| 02 | [Architecture](02-architecture/README.md) | 프로세스·레이어·상태·저장·실행 구조 |
| 03 | [Conventions](03-conventions/README.md) | 현재 코드와 문서 작성 관례 |
| 04 | [Pages](04-pages/README.md) | 화면·기능별 사용자 흐름과 IPC |
| 05 | [Components](05-components/README.md) | 페이지·위젯의 책임과 주요 props |
| 06 | [Functions](06-functions/README.md) | Markdown 파서와 main 서비스 로직 |
| 07 | [API](07-api/README.md) | Electron IPC 전체 계약과 오류 경계 |
| 08 | [Development Guide](08-development-guide/README.md) | 액션·화면·IPC 변경 절차 |
| 09 | [Deployment](09-deployment/README.md) | 빌드, 패키징, 업데이트와 미확인 절차 |

## 권장 읽기 순서

1. [Quick Start](01-quick-start/README.md)에서 로컬 실행과 검증 명령을 확인합니다.
2. [Architecture](02-architecture/README.md)에서 세 프로세스와 실행 흐름을 이해합니다.
3. [Pages](04-pages/README.md)에서 수정 대상 화면의 실제 동작을 찾습니다.
4. 액션이나 native 기능을 수정한다면 [Functions](06-functions/README.md)와 [API](07-api/README.md)를 함께 확인합니다.
5. 작업 전 [Conventions](03-conventions/README.md)과 [Development Guide](08-development-guide/README.md)를 확인합니다.

## 기능 지도

```text
Markdown 작성·가져오기
  → parseMarkdown
    → Scenario[]
      ├─ 편집기: 원문·마커 수정
      ├─ 선택기: 폴더 파일에서 실행 대상 구성
      └─ 실행기: IPC qa:start
           → Playwright Chromium
           → 진행·수동 단계·미리보기 이벤트
           → 결과 기록·리포트·영상
```

| 기능 | 핵심 문서 | 주 코드 |
| --- | --- | --- |
| 실행 기록과 재실행 | [대시보드](04-pages/010-dashboard/README.md) | `DashboardPage`, `RunReportDrawer` |
| Markdown·마커 편집 | [시나리오 편집](04-pages/020-scenario-editor/README.md) | `ScenarioEditorPage`, `scenario.ts` |
| 폴더·다중 선택 | [시나리오 선택](04-pages/030-scenario-picker/README.md) | `ScenarioPickerPage` |
| Playwright 실행 | [시나리오 실행](04-pages/040-scenario-run/README.md) | `App`, `RunPage`, `main.ts` |
| 표시용 환경 설정 | [설정](04-pages/050-settings/README.md) | `SettingsPage` |

## 문서 관리 규칙

- 각 카테고리의 `README.md`는 인덱스 역할을 합니다.
- 기능 문서는 `README` → `01-overview` → `02-userflow` → `03-api` → `04-edge-cases` 순서로 탐색합니다.
- 코드에서 확인되지 않은 정책을 사실처럼 추가하지 않습니다.
- 페이지 흐름, Markdown 문법, IPC, 저장 경로, 실행·오류 정책이 변경되면 관련 문서를 코드와 함께 갱신합니다.
- 문서의 코드 경로와 채널명은 실제 구현을 기준으로 검증합니다.

