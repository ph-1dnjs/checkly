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
| 페이지 | `src/renderer/pages/api-testing/ApiTestingPage.tsx` | 프로젝트·환경·탭 |
| 명세 가져오기 | `SpecSourcePanel.tsx` | 명세 요약 한 줄·설정 폼·동기화 후 시나리오 영향(사라진 API·바뀐 제목) |
| API 문서 | `ApiDocumentation.tsx` | Swagger UI·검색·인증·개별 호출, 시나리오 작성 1단계(보기·API 추가) |
| 시나리오 | `ScenarioPanel.tsx`, `ScenarioBuilder.tsx`, `SimpleStep.tsx` | 목록·상세·실행, 작성 2단계(값·연결·검증) |
| 실행 결과 | `ScenarioRunViews.tsx`, `SummaryJson.tsx`, `YamlCode.tsx` | 실행 흐름·설정 요약·검증별 결과·YAML 보기 |
| 공용 조각 | `SortableList.tsx`, `ApiPicker.tsx`, `ApiReplaceModal.tsx`, `RunInputModal.tsx` | 드래그 정렬·API 선택·API 바꾸기·실행 중 입력 |
| 설명 | `src/renderer/pages/api-testing/DescriptionMarkdown.tsx` | 설명 토글·Mermaid 모달 |
| 웹 개발 진입점 | `src/renderer/app/api-web/` | 개발용 앱 조립·웹 브리지 |
| 공통 UI | `src/renderer/shared/ui/` | Popover·ProgressBar·LoadingSpinner |
| 서비스 | `src/app/api-testing/main/` | 저장·명세·HTTP 실행·변수·인증 |
| 계약 | `src/app/api-testing/shared/` | YAML 모델·검증·브리지 타입 |
| 연결 | `src/app/preload.ts`, `src/renderer/app/App.tsx` | IPC·페이지 조립 |
| 검증 | `tests/api-testing/` | 코어·저장·웹 샘플·Electron |
