# [개요] API 테스트

## 구현 범위

프로젝트마다 여러 서버와 환경을 설정합니다. API 문서, 시나리오, AI 작성 도우미 탭을 제공하며 전역변수와 세션 쿠키는 프로젝트 단위로 공유합니다. `local`·`dev` 같은 환경마다 서버 기본 URL과 명세를 관리하며, 개별 API 요청과 시나리오 실행은 동일한 HTTP 실행 코어를 사용합니다.

API 문서는 공식 Swagger UI에 저장된 명세를 전달합니다. 태그 접기·펼치기, 요청 편집, 응답 명세 및 실시간 응답 표시를 지원합니다. 검색은 태그·메서드·경로·전체 URL·operationId·summary·description을 대상으로 합니다. 하단 전체 Schemas 목록은 숨기고 개별 요청·응답의 스키마는 표시합니다.

현재 Swagger 화면에는 별도 tagsSorter/operationsSorter를 지정하지 않고 명세 순서를 따릅니다.

태그·엔드포인트 펼침 상태는 URL hash와 연결합니다. hash에는 프로젝트·환경이 포함되지 않으므로 해당 명세가 선택되어 있어야 위치를 찾을 수 있습니다. 앱 내부 hash 이동과 외부에서 앱을 여는 OS 딥링크는 별개이며 후자는 미구현입니다.

## 코드 경계

화면 진입점·URL 상태·화면 전체 조합은 `src/renderer/pages/api-testing/`에 둡니다. 사용자 행동은 `src/renderer/features/api-testing/`의 기능별 slice로, 시나리오 데이터 표시·계산·최근 실행 상태는 `src/renderer/entities/api-testing/`으로 나눕니다. 범용 입력·정렬 UI는 `src/renderer/shared/ui/`, 공통 실행 버튼 훅은 `src/renderer/shared/hooks/`에 둡니다. entity·feature의 외부 사용은 필요한 항목만 공개하는 `index.ts`를 통합니다. 실행·저장 서비스와 계약은 `src/app/api-testing/main/`, `shared/`에 유지합니다. 별도 npm 패키지는 없습니다. renderer는 main을 직접 import하지 않고 브리지를 사용합니다. shared 모델은 Node.js·Electron·DOM에 의존하지 않습니다. Electron 빌드는 main/shared를, Vite는 renderer를 처리합니다.

전역변수 관리 기능은 편집 메뉴의 상태를 소유합니다. 페이지의 `ApiTestingProviders`가 전역변수 편집 요청을 페이지 전체에 연결하고, 편집·요약·실행 흐름에는 `onConfigureGlobal` 콜백을 전달합니다. entity가 변수 편집 feature를 직접 참조하지 않습니다. 클래스와 스타일 적용 순서는 기존 화면을 유지하며, API 테스트 전용 CSS는 페이지의 `ui/api-testing.css`에서 관리합니다.

기존 공통 Dock과 Popover를 사용합니다. `useRunAction`은 현재 API 또는 시나리오 실행을 Dock에 연결합니다. 공통 `ProgressBar`는 API 시나리오 결과 영역의 실행 중 상태에, `LoadingSpinner`는 명세 조회에 사용합니다. 단계별 진행 이벤트가 없으므로 시나리오 로딩바는 퍼센트를 표시하지 않습니다. 실행 중 입력이 필요한 API 단계는 실행을 잠시 멈추고 결과 영역 위에 입력 모달을 표시하며, 제출하면 같은 실행을 이어갑니다.

YAML의 `{{steps.N.…}}` 참조는 파싱할 때 내부 실행 모델의 `valueBindings`와 `vars`로 변환합니다. 실행기는 앞 단계에서 확보한 요청·응답 스냅샷을 사용합니다. `valueBindings`·`vars`는 사용자 YAML에 쓰는 문법이 아니며, 저장 시 다시 단계 번호를 사용하는 참조로 직렬화합니다.

## 저장과 수명

| 데이터 | 저장 위치 |
| --- | --- |
| 저장 루트 | Electron userData의 `api-testing/` |
| 프로젝트·서버·환경 | `projects.json` |
| 명세 | `catalog-{projectId}-{environmentId}-{serverId}.json` |
| 명세 URL·동기화·계정 정보 | `spec-source-…json` |
| 시나리오 | `scenarios-{projectId}.json` |
| 시나리오 묶음 | `suites-{projectId}.json` |
| API 문서 Try it out 입력값 | `doc-inputs-{projectId}.json` (키 `{serverId} {METHOD path}`, 민감 이름 값 제외) |
| AI 가이드용 명세·프로젝트 상태·외부 AI 결과 | `ai/{projectId}/api-catalog.json`, `project-state.json`, `scenarios.yaml` (앱 안 터미널은 `ai/{projectId}/chat/`, 바로 만들기는 `ai/{projectId}/quick/`에 같은 파일과 `guide.md`) |
| AI 대화 설정·터미널 세션 | `ai-chat-settings.json`(백엔드 폴더·AI), `ai-terminal-{projectId}.json`(이어갈 세션 정보만) |
| 전역변수·API 인증 연결 | 프로세스 메모리 |
| 세션 쿠키(프로젝트별) | 프로세스 메모리 |
| 실행 입력·결과 | 일시적 화면/실행 상태. 최근 시나리오 결과는 renderer 세션 메모리 |

프로젝트·명세·시나리오·스위트는 재시작 후 복원됩니다. 프로젝트 데이터 JSON은 임시 파일 기록 후 rename으로 교체합니다. 시나리오에는 정규화한 YAML·서버 매핑·수정 시각·초안 여부·그룹·태그·유지하기로 한 제목 변경 정보가 저장됩니다. 태그는 저장 계약에 남아 있지만 현재 화면에는 태그 편집 기능이 없습니다.

AI 가이드를 만들 때 명세 파일을 기록하고, 결과 YAML은 외부 AI가 작성합니다. 프로젝트를 삭제하면 해당 AI 폴더도 제거합니다. 최근 시나리오 실행 결과는 프로젝트·환경·시나리오별로 보관하며 화면을 다시 열면 표시하지만, renderer를 새로고침하거나 앱을 재시작하면 사라집니다.

문서 계정 기억은 사용자가 선택하고 OS 보안 저장을 사용할 수 있을 때만 비밀번호를 암호화해 저장합니다. 실제 API용 토큰과 전역변수는 재시작하면 사라집니다.

### 팀 프로젝트(로그인)일 때

위 표는 로그인하지 않은 파일 모드 기준입니다. 로그인하면 서버·환경·주소는 공통 테이블, 시나리오·묶음·Try it out 입력값은 `api_*` 테이블에 둡니다([공통 설계](../../02-architecture/supabase-common.md)). 추가로:

- **명세**: 명세 본문은 팀에 올리지 않습니다. URL로 가져오면 그 주소가 팀의 명세 주소가 되고, 팀원은 같은 주소(비밀값 공유가 켜져 있으면 팀의 문서 계정도)로 각자 가져와 이 PC의 `catalog-*.json`에 둡니다. 명세 주소(예: 다른 사람 PC의 `localhost:8080`)에 접속할 수 없는 팀원은 가져올 수 없습니다. 파일로 가져온 명세는 이 PC에만 있습니다.
- **비밀값도 팀에 공유**(설정 → PROJECT, 팀 전체 설정, 기본 켬, `api_settings`): 켜져 있으면 Try it out 입력값의 토큰·비밀번호 같은 값도 그대로 저장하고, 문서(Basic) 계정을 기억하면 키체인 대신 `api_spec_accounts`에 저장해 팀원이 같이 씁니다(저장 당시 명세 주소에서만 사용). 끄면 팀에 저장된 문서 계정을 지우고 입력값의 비밀값을 빼며, 이후에는 파일 모드처럼 동작합니다(계정은 각 PC 키체인). DB도 꺼져 있을 때는 계정 저장을 거절합니다. 값은 DB에 평문이므로 개발용 계정만 쓰는 프로젝트를 전제로 합니다.
- **작성 정보**: 시나리오·스위트마다 만든 사람·시각과 마지막으로 고친 사람·시각을 DB가 기록합니다(`created_by`는 트리거가 정해 바꿀 수 없음). 목록 행에는 이름 아래 `hyewon · 3분 전`(마지막 수정자), 상세 제목 아래에는 `minsu 작성 · 10/09 14:20 · hyewon 수정 · 3분 전`(만든 뒤 고친 적 없으면 수정 부분 생략)을 보여 줍니다. 스위트도 같습니다. 파일 모드는 작성 정보를 저장하지도 보여 주지도 않습니다. 이름은 현재 닉네임이고, 프로젝트를 나간 멤버는 `(나간 멤버)`입니다.
- 전역변수·세션 쿠키·API 인증 연결은 팀 모드에서도 메모리에만 둡니다.

## 응답과 외부 전달

개별 API 호출(`execute`)과 시나리오 실행 결과는 요청·응답 원문을, 시나리오 실행은 변수 원문도 반환하며 디스크에 자동 저장하지 않습니다. 예외로 개별 호출의 **요청 입력값**은 다음에 다시 채우려고 저장하되, 민감 패턴 이름(아래 기준)의 파라미터·헤더·쿠키는 빼고 본문의 해당 키는 빈 값으로 남깁니다. 저장 제외 기준(`shared/sensitive.ts`)은 키·헤더·쿼리·변수 이름이 `authorization|cookie|password|passwd|token|secret|api key|otp|credential|session` 패턴인지입니다. 화면은 Swagger처럼 실행 결과·전역변수·입력값을 원문 그대로 보여 주고, 가리는 곳은 새 비밀값을 입력하는 칸(API 문서 인증 창의 새 토큰, 명세 문서 계정 비밀번호)과, 기본으로 숨긴 전역변수 패널의 값(`값 보기`로 표시)입니다.

묶음 실행은 저장된 시나리오를 순차 실행하며 각 시나리오 직전에 설정을 다시 확인합니다. 묶음 실행 결과는 화면 메모리에만 남고, 사용자가 선택하면 요청·응답 원문과 변수 값을 제외한 독립 HTML 리포트를 저장할 수 있습니다. 실행 이력 영구 저장은 제공하지 않습니다. 연결한 값과 실행 입력의 실제 값은 YAML에 자동 기록하지 않으며, `{{steps.N.…}}`·`{{globals.name}}`·`{{inputs.name}}` 참조로 저장합니다. 사용자가 직접 입력한 요청값은 YAML에 저장됩니다.
