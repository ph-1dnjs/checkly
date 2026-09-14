# API 테스트

Swagger/OpenAPI 명세를 가져와 개별 API를 호출하고, 프로젝트별 시나리오를 작성·검토·저장·실행합니다.

> 범위: 하단 `{ }` 메뉴의 API 테스트 페이지. 기존 Playwright 시나리오 실행(040)과 별도 모델·실행기를 사용합니다.

## 문서 목록

1. [개요·구조·저장](01-overview.md)
2. [사용자 흐름·시나리오 문법](02-userflow.md)
3. [IPC·실행 계약](03-api.md)
4. [엣지 케이스·검증·미구현 범위](04-edge-cases.md)
5. [기존 프로젝트 재사용 검토·구현 순서](05-reuse-plan.md)

API 테스트 기능 문서는 이 디렉터리에서 관리합니다. 디자인 기준은 별도 담당자가 관리하는 루트 `DESIGN.md`를 따르며, 이 문서에서는 기능과 현재 구현을 설명합니다.

| 구분 | 위치 | 책임 |
| --- | --- | --- |
| 페이지 | `src/renderer/pages/api-testing/ApiTestingPage.tsx` | 프로젝트·환경·탭·명세 |
| API 문서 | `src/renderer/pages/api-testing/ApiDocumentation.tsx` | Swagger UI·검색·인증·개별 호출 |
| 시나리오 | `src/renderer/pages/api-testing/ScenarioPanel.tsx`, `ScenarioBuilder.tsx` | YAML·시각 편집·결과 |
| 설명 | `src/renderer/pages/api-testing/DescriptionMarkdown.tsx` | 설명 토글·Mermaid 모달 |
| 웹 개발 진입점 | `src/renderer/app/api-web/` | 개발용 앱 조립·웹 브리지 |
| 공통 UI | `src/renderer/shared/ui/` | Popover·ProgressBar·LoadingSpinner |
| 서비스 | `src/app/api-testing/main/` | 저장·명세·HTTP 실행·변수·인증 |
| 계약 | `src/app/api-testing/shared/` | YAML 모델·검증·브리지 타입 |
| 연결 | `src/app/preload.ts`, `src/renderer/app/App.tsx` | IPC·페이지 조립 |
| 검증 | `tests/api-testing/` | 코어·저장·웹 샘플·Electron |
