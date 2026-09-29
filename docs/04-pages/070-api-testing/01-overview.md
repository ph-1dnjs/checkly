# [개요] API 테스트

## 구현 범위

프로젝트마다 여러 서버와 환경을 설정합니다. API 문서, 시나리오, AI 작성 도우미 탭을 제공하며 전역변수와 세션 쿠키는 프로젝트 단위로 공유합니다. `local`·`dev` 같은 환경마다 서버 기본 URL과 명세를 관리하며, 개별 API 요청과 시나리오 실행은 동일한 HTTP 실행 코어를 사용합니다.

API 문서는 공식 Swagger UI에 저장된 명세를 전달합니다. 태그 접기·펼치기, 요청 편집, 응답 명세 및 실시간 응답 표시를 지원합니다. 검색은 태그·메서드·경로·전체 URL·operationId·summary·description을 대상으로 합니다. 하단 전체 Schemas 목록은 숨기고 개별 요청·응답의 스키마는 표시합니다.

현재 Swagger 화면에는 별도 tagsSorter/operationsSorter를 지정하지 않고 명세 순서를 따릅니다.

태그·엔드포인트 펼침 상태는 URL hash와 연결합니다. hash에는 프로젝트·환경이 포함되지 않으므로 해당 명세가 선택되어 있어야 위치를 찾을 수 있습니다. 앱 내부 hash 이동과 외부에서 앱을 여는 OS 딥링크는 별개이며 후자는 미구현입니다.

## 코드 경계

화면 진입점·URL 상태·화면 전체 조합은 `src/renderer/pages/api-testing/`에 둡니다. 사용자 행동은 `src/renderer/features/api-testing/`의 기능별 slice로, 시나리오 데이터 표시·계산·최근 실행 상태는 `src/renderer/entities/api-testing/`으로 나눕니다. 웹 개발 진입점과 웹 브리지는 `src/renderer/app/api-web/`, 범용 입력·정렬 UI는 `src/renderer/shared/ui/`, 공통 실행 버튼 훅은 `src/renderer/shared/hooks/`에 둡니다. entity·feature의 외부 사용은 필요한 항목만 공개하는 `index.ts`를 통합니다. 실행·저장 서비스와 계약은 `src/app/api-testing/main/`, `shared/`에 유지합니다. 별도 npm 패키지는 없습니다. renderer는 main을 직접 import하지 않고 브리지를 사용합니다. shared 모델은 Node.js·Electron·DOM에 의존하지 않습니다. Electron 빌드는 main/shared를, Vite는 renderer를 처리합니다.

전역변수 관리 기능은 편집 메뉴의 상태를 소유합니다. 페이지의 `ApiTestingProviders`가 저장 revision을 민감값 Context에 전달하고, 편집·요약·실행 흐름에는 `onConfigureGlobal` 콜백을 전달합니다. entity가 변수 편집 feature를 직접 참조하지 않습니다. 클래스와 스타일 적용 순서는 기존 화면을 유지하며, API 테스트 전용 CSS는 페이지의 `ui/api-testing.css`에서 관리합니다.

기존 공통 Dock과 Popover를 사용합니다. `useRunAction`은 현재 API 또는 시나리오 실행을 Dock에 연결합니다. 공통 `ProgressBar`는 API 시나리오 결과 영역의 실행 중 상태에, `LoadingSpinner`는 명세 조회에 사용합니다. 단계별 진행 이벤트가 없으므로 시나리오 로딩바는 퍼센트를 표시하지 않습니다. 실행 중 입력이 필요한 API 단계는 실행을 잠시 멈추고 결과 영역 위에 입력 모달을 표시하며, 제출하면 같은 실행을 이어갑니다.

YAML의 `{{steps.N.…}}` 참조는 파싱할 때 내부 실행 모델의 `valueBindings`와 `vars`로 변환합니다. 실행기는 앞 단계에서 확보한 요청·응답 스냅샷을 사용합니다. `valueBindings`·`vars`는 사용자 YAML에 쓰는 문법이 아니며, 저장 시 다시 단계 번호를 사용하는 참조로 직렬화합니다.

## 저장과 수명

| 데이터 | 앱 | 웹 개발 모드 |
| --- | --- | --- |
| 저장 루트 | Electron userData의 `api-testing/` | 저장소의 `.local/api-testing-web/` |
| 프로젝트·서버·환경 | `projects.json` | 동일 형식 |
| 명세 | `catalog-{projectId}-{environmentId}-{serverId}.json` | 동일 형식 |
| 명세 URL·동기화·계정 정보 | `spec-source-…json` | 계정 기억 제외 |
| 시나리오 | `scenarios-{projectId}.json` | 동일 형식 |
| 시나리오 묶음 | `suites-{projectId}.json` | 동일 형식 |
| API 문서 Try it out 입력값 | `doc-inputs-{projectId}.json` (키 `{serverId} {METHOD path}`, 민감 이름 값 제외) | 동일 형식 |
| AI 가이드용 명세·외부 AI 결과 | `ai/{projectId}/api-catalog.json`, `scenarios.yaml` | 동일 형식 |
| 전역변수·API 인증 연결 | 프로세스 메모리 | 개발 서버 메모리 |
| 세션 쿠키(프로젝트별) | 프로세스 메모리 | 개발 서버 메모리 |
| 실행 입력·결과 | 일시적 화면/실행 상태. 최근 시나리오 결과는 renderer 세션 메모리 | 동일 방식 |

프로젝트·명세·시나리오·스위트는 재시작 후 복원됩니다. 앱과 웹 데이터는 자동 동기화하지 않습니다. 프로젝트 데이터 JSON은 임시 파일 기록 후 rename으로 교체합니다. 시나리오에는 정규화한 YAML·서버 매핑·수정 시각·초안 여부·그룹·태그·유지하기로 한 제목 변경 정보가 저장됩니다. 태그는 저장 계약에 남아 있지만 현재 화면에는 태그 편집 기능이 없습니다.

AI 가이드를 만들 때 명세 파일을 기록하고, 결과 YAML은 외부 AI가 작성합니다. 프로젝트를 삭제하면 해당 AI 폴더도 제거합니다. 최근 시나리오 실행 결과는 프로젝트·환경·시나리오별로 보관하며 화면을 다시 열면 표시하지만, renderer를 새로고침하거나 앱을 재시작하면 사라집니다.

문서 계정 기억은 사용자가 선택하고 OS 보안 저장을 사용할 수 있을 때만 비밀번호를 암호화해 저장합니다. 실제 API용 토큰과 전역변수는 재시작하면 사라집니다.

## 응답과 외부 전달

개별 API 호출(`execute`)과 시나리오 실행 결과는 요청·응답 원문을, 시나리오 실행은 변수 원문도 반환하며 디스크에 자동 저장하지 않습니다. 예외로 개별 호출의 **요청 입력값**은 다음에 다시 채우려고 저장하되, 민감 패턴 이름(아래 ①)의 파라미터·헤더·쿠키는 빼고 본문의 해당 키는 빈 값으로 남깁니다. 화면 표시 여부는 상단의 **민감값 숨기기** 토글(기본 켬)이 결정합니다. 토글은 민감한 값만 CSS로 가리는 표시 전용 기능이며 DOM의 값은 바꾸지 않습니다. 판단 기준(`shared/sensitive.ts`)은 두 가지입니다. ① 키·헤더·쿼리·변수 이름이 `authorization|cookie|password|passwd|token|secret|api key|otp|credential|session` 패턴이면 그 값, ② 이름이 민감한 문자열 전역변수 값과 `sensitive: true` 입력값이 나타나는 모든 위치. 키 이름·구조·일반 값은 그대로 보입니다. API 문서(Swagger)의 Try it out은 Swagger처럼 입력값과 응답·Request URL·curl을 원문 그대로 보여 주며, 가리는 곳은 Authorize 창의 새 토큰 입력칸뿐입니다.

묶음 실행은 저장된 시나리오를 순차 실행하며 각 시나리오 직전에 설정을 다시 확인합니다. 묶음 실행 결과는 화면 메모리에만 남고, 사용자가 선택하면 요청·응답 원문과 변수 값을 제외한 독립 HTML 리포트를 저장할 수 있습니다. 실행 이력 영구 저장은 제공하지 않습니다. 연결한 값과 실행 입력의 실제 값은 YAML에 자동 기록하지 않으며, `{{steps.N.…}}`·`{{globals.name}}`·`{{inputs.name}}` 참조로 저장합니다. 사용자가 직접 입력한 요청값은 YAML에 저장됩니다.
