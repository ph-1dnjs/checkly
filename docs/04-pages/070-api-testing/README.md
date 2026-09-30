# API 테스트

Swagger/OpenAPI 명세를 가져와 개별 API를 호출하고, 프로젝트별 시나리오를 작성·검토·저장·실행합니다.

> 범위: 하단 `{ }` 메뉴의 API 테스트 페이지. 기존 Playwright 시나리오 실행(040)과 별도 모델·실행기를 사용합니다.

문서 점검 기준: 2026-09-29. 커밋 `3b62f9f1a2bdea864cb069bd5181e0d0c249d8c7`의 API 테스트 기능 변경과 이후 인증 사전 검사·환경 전환 시 초안 유지·실행 명세 전달·필수 쿠키 검사 수정과 renderer 책임별 폴더 분리를 반영합니다.

## 문서 목록

1. [개요·구조·저장](01-overview.md)
2. [사용자 흐름·시나리오 문법](02-userflow.md)
3. [IPC·실행 계약](03-api.md)
4. [엣지 케이스·검증·미구현 범위](04-edge-cases.md)
5. [기존 프로젝트 재사용 검토·구현 순서](05-reuse-plan.md)
6. [폴더·파일 분리 기준](06-folder-file-separation.md)

API 테스트 기능 문서는 이 디렉터리에서 관리합니다. 디자인 기준은 별도 담당자가 관리하는 루트 `DESIGN.md`를 따르며, 이 문서에서는 기능과 현재 구현을 설명합니다.

| 구분 | 위치 (`src/renderer/` 기준) | 책임 |
| --- | --- | --- |
| 페이지 진입점 | `pages/api-testing/ApiTestingPage.tsx` | 프로젝트·환경·탭·URL 상태 |
| 화면 조합 | `pages/api-testing/ui/` | API 문서·시나리오 편집/실행·스위트 패널, Swagger 연결·화면 스타일 |
| 페이지 모델·보조 로직 | `pages/api-testing/model/`, `lib/` | Swagger 타입·선언, URL·deep-link·요청 어댑터 |
| 시나리오 편집 | `features/api-testing/edit-scenario/` | 단계·값·연결·입력·추출·검증 편집 |
| AI 작성 | `features/api-testing/author-scenarios/` | 가이드·결과 가져오기·검사·선택 저장 |
| 설정 | `features/api-testing/configure-project/`, `configure-spec/`, `configure-globals/`, `configure-request-auth/` | 프로젝트·명세·변수·인증 설정 |
| 실행 중 입력 | `features/api-testing/submit-run-input/` | 입력 모달·제출 |
| 데이터 표현·계산 | `entities/api-testing/` | 실행 흐름/결과·설정 요약·JSON/YAML·트리·전역변수 후보 |
| 공통 UI·실행 버튼 | `shared/ui/`, `shared/hooks/useRunAction.ts`, `shared/model/run-action.ts` | Popover·정렬·임시 입력값·Dock 연결 |
| 웹 개발 진입점 | `app/api-web/` | 개발용 앱 조립·웹 브리지 |

| 프로세스·검증 | 위치 | 책임 |
| --- | --- | --- |
| 서비스 | `src/app/api-testing/main/` | 저장·명세·HTTP 실행·변수·인증 |
| 계약 | `src/app/api-testing/shared/` | YAML 모델·검증·브리지 타입 |
| 연결 | `src/app/preload.ts`, `src/renderer/app/App.tsx` | IPC·페이지 조립 |
| 검증 | `tests/api-testing/`, `tests/api-testing-editor-environment.spec.ts` | 코어·저장·모듈 경계·환경 전환·변수 상태 연결·웹·Electron |

새 파일의 배치와 공개 범위는 [폴더·파일 분리 가이드](06-folder-file-separation.md)를 참고하세요.
