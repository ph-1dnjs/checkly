# [IPC 연동] API 테스트

앱은 `window.electronAPI.apiTesting`을 사용합니다. 타입은 `src/app/api-testing/shared/workspace.ts`, 등록은 `main/register.ts`, 연결은 `src/app/preload.ts`에 있습니다.

아래 모든 채널에는 `api-testing:` 접두사가 붙습니다.

`scope`는 `{ projectId, environmentId, serverId }`입니다. 프로젝트 단위 입력은 `{ projectId }`, 프로젝트·환경 단위 입력은 `{ projectId, environmentId }`를 사용합니다.

| 채널 | 주요 입력 → 출력 |
| --- | --- |
| list-projects / save-project / delete-project | 프로젝트 목록·설정·ID → 목록/저장 결과/완료 |
| catalog / delete-catalog | projectId, environmentId, serverId → 명세/완료 |
| import | scope, 파일 또는 URL·Basic 인증 → 명세 또는 취소 시 null |
| spec-sync / delete-spec-account | scope → 동기화·계정 저장 여부/완료 |
| get-request-auth / set-request-auth | scope, 변수 이름 또는 null → 연결 이름/완료 |
| list-globals / set-global / delete-global | 프로젝트, 이름·JSON 값 → 원문 값 목록/완료 |
| copy-ai-prompt / get-ai-prompt | `{ scope: 프로젝트·환경, tags?, operations? }` → 스키마 파일을 쓰고 가이드를 클립보드로 / 같은 가이드 텍스트. operations는 `["<serverId> <METHOD path>"]` 형식 |
| read-ai-result | 프로젝트·환경 → 결과 파일의 경로·내용·수정 시각, 없으면 null(2MB 이하) |
| check-ai-scenarios | 프로젝트·환경, AI 결과 텍스트 → 검사된 초안·스위트(저장하지 않음) |
| list-cookies / clear-cookies | 프로젝트 → 쿠키 이름·도메인·경로 목록(값 제외)/완료. 실행 중에는 비울 수 없음 |
| execute | scope, operation key, request → 원문 ApiResponse (Swagger Try it out). 요청 입력값은 민감값을 빼고 기억 |
| get-doc-inputs / forget-doc-input | scope(서버 기준)/operation key → 기억한 Try it out 입력값 목록/삭제. 프로젝트 단위(환경 공통), 서버 삭제·프로젝트 삭제 시 함께 삭제 |
| cancel | scope → 현재 환경 실행 취소 |
| list-scenarios / read-scenario-file | 프로젝트 ID/파일 선택 → 목록/YAML 또는 null |
| check-scenario-specs | 프로젝트·환경 → `{ missing, renamed }`: 명세에서 사라진 API를 쓰는 단계, 이전 제목을 이름으로 쓰는 단계 (서버별 명세를 한 번만 읽음) |
| apply-title-renames | 프로젝트·환경 → `{ updated, skipped }`: 이전 제목 그대로인 단계 이름만 새 제목으로 저장, 먼저 바뀐 시나리오는 건너뜀 |
| keep-titles | 프로젝트·환경, 시나리오 ID → 완료. 현재 제목 변경 제안을 `keptTitles`에 기록해 숨기며 `updatedAt`은 유지 |
| list-suites / save-suite / delete-suite / save-suite-report | 프로젝트, 스위트, expectedUpdatedAt / 파일명·HTML → 목록·저장 결과/완료/저장 경로 |
| preview-scenario | 프로젝트·환경, YAML, 서버 매핑 → `{ scenario, issues, executionIssues }` |
| save-scenario / save-scenario-draft | 동일 입력 + expectedUpdatedAt?, metadata? → 저장 항목. metadata는 `{ groupPath?: string[], tags?: string[] }` |
| delete-scenario | 프로젝트 ID, 시나리오 ID, expectedUpdatedAt → 완료 |
| run-scenario | 프로젝트·환경, YAML, 서버 매핑, inputs → ApiScenarioResult |
| get-pending-input | 프로젝트·환경 → 현재 실행 입력 요청 또는 null |
| submit-input | 프로젝트·환경, requestId·runId·stepId·name·JSON value → 대기 해제 |

`ApiResponse` 공통 타입에는 status, httpStatus, durationMs, request, headers, body, error와 선택적인 checks·failure·input·inputs가 있습니다. `execute`는 상태·시간·오류와 수집된 요청/응답 원문을 반환하며 checks·failure·입력 결과는 반환하지 않습니다. `ApiScenarioResult`는 전체 status, 단계별 결과, 실행 중 값 변수인 variables를 반환합니다. 단계별 `checks`는 `{ expect?: 인덱스, passed, actual? }`이며 `expect`가 없으면 자동 2xx 확인, `actual`은 실패 시에만 80자까지 담습니다. request는 `{ method, url, headers, body? }`, 응답은 headers와 body로 반환됩니다. 전역변수 목록과 실행 결과는 민감값이 포함된 원문이며 화면의 숨기기 토글이 표시만 가립니다. 자동으로 저장하거나 AI 데이터에 포함하지 않습니다.

`preview-scenario`의 `issues`는 API 연결·필수 요청값 등 시나리오 구성 문제이고, `executionIssues`는 전역변수·서버 기본 URL 등 실행 전 준비 문제입니다. 일반 저장은 issues가 없어야 하며 executionIssues만 있으면 저장할 수 있습니다. 초안 저장은 issues를 허용하지만 YAML 파싱과 저장 충돌 검사는 통과해야 합니다. 실행은 두 종류의 문제를 모두 해결해야 합니다. 브리지 오류와 실행 전 검사 실패는 Promise rejection으로, 실행을 시작한 뒤 검증·요청 실패는 결과 상태로 반환합니다. 단계별 progress 이벤트는 아직 없으며, renderer는 대기 중인 입력 요청을 조회해 모달을 표시합니다.

`get-pending-input`은 값이 아니라 `requestId`, `runId`, `stepId`, 입력 이름·라벨·타입·필수/민감 여부, 0부터 시작하는 index와 totalSteps를 반환합니다. `submit-input`은 이 식별자들이 현재 실행과 일치하는지와 JSON 타입을 확인한 뒤 실행을 재개합니다. 입력값은 실행 중 메모리와 renderer에 전달되는 원문 결과에 포함될 수 있지만 YAML에는 기록하지 않습니다. Electron은 IPC 채널로, 웹 개발 모드는 같은-origin 개발 RPC로 제공합니다.

## 실행 계약

실행 직전에 현재 환경의 명세와 서버 연결을 재검증합니다. 저장·입력 YAML의 API 표기는 `api: GET /items`처럼 METHOD와 경로를 합친 문자열 하나입니다. 요청의 body·pathParams·query·headers·cookies는 단계 바로 아래에 둡니다. `operationId` 객체, `request:`, 단수 `input`, 최상위 inputs·vars·valueBindings는 작성 문법에서 허용하지 않습니다. 내부 실행 모델의 api 객체·request·vars·valueBindings와 사용자가 작성하는 YAML을 구분해야 합니다. API 설명·요청/응답 필드 표시는 현재 OpenAPI 카탈로그를 사용합니다.

시나리오 실행과 API 문서 직접 호출은 METHOD/path 또는 내부 operationId로 선택한 API의 parameters·bodySchema를 실행기에 전달합니다. 쿼리는 명세의 style·explode를 따르고, 본문은 변수 해석 후 지원되는 타입·필수 필드 검사를 거칩니다. 정수와 일반 숫자를 구분하고 nullable 값은 허용하며, readOnly 필드는 요청의 필수 입력에서 제외합니다. 선택적인 본문을 생략하면 본문 타입 검사를 건너뜁니다. 쿼리 직렬화와 본문 검증의 지원 범위는 [지원 제한](04-edge-cases.md#지원-제한)을 참고합니다.

기본 요청 시간 제한은 30초이며 리다이렉트·자동 재시도를 하지 않습니다. 단계의 `cookies`는 단순 문자열·숫자·불리언을 지원합니다. 프로젝트별 메모리 쿠키 저장소에서 URL에 맞는 쿠키를 자동으로 붙이고 명시한 cookies가 같은 이름의 저장 쿠키보다 우선합니다. API 문서 직접 호출의 필수 쿠키 검사도 경로 변수 해석·인코딩과 서버 기본 경로를 반영한 최종 URL에 전송 가능한 저장 쿠키를 포함합니다. 명시한 빈 쿠키는 저장 쿠키로 대체하지 않고 필수 입력 오류로 처리합니다. 응답 Set-Cookie는 후속 단계·시나리오·API 문서 호출에서 사용하도록 갱신합니다.

기본 실패 정책은 stop이며 이후 단계는 skipped입니다. continue이면 후속 단계를 시도하고 필요한 변수가 없으면 blocked입니다. 취소는 진행 요청을 중단하고 후속 호출을 막습니다.

단계의 `inputs` 목록에 정의한 값은 YAML에서 `{{inputs.name}}`으로 사용합니다. 실행기는 같은 이름을 내부 vars, 실행 입력, 전역변수 순서로 찾고 유효한 값이 없으면 입력 공급자 Promise를 기다립니다. 제출된 값은 요청을 해석하기 전에 내부 vars에 들어가며 이후 단계에서도 참조할 수 있습니다. 입력 창의 실행 취소는 진행 단계와 후속 단계를 cancelled로 끝내며 실패 정책과 관계없이 호출을 중단합니다. renderer 종료나 5분 만료로 값 없이 대기가 끝나면 필수 입력은 blocked가 되고 이후 단계에는 실패 정책을 적용합니다.

요청을 해석한 뒤 전송 전에 요청 출처 스냅샷을 저장하고, 응답 본문을 읽은 뒤 검증 전에 응답 출처 스냅샷을 저장합니다. 따라서 HTTP 오류나 검증 실패가 발생해도 이미 만들어진 스냅샷은 남으며 `onFailure: continue`의 후속 단계가 참조할 수 있습니다. 건너뛴 단계나 해당 스냅샷을 만들기 전에 실패한 단계의 값은 사용할 수 없습니다. 이전 단계의 내부 valueBindings는 다음 요청을 해석하기 전에 vars에 반영합니다.

검증은 사용자가 명시한 `expect`와 기본 HTTP 2xx(상태 검증이 없을 때)를 수행합니다. 각 검증의 판정을 checks로 반환하고 하나라도 실패하면 단계를 실패로 처리하며, 중간 업무 검증은 자동으로 추가하지 않습니다. 응답 검증과 모든 추출이 성공한 후 해당 단계의 extract 결과를 vars/globals에 함께 반영합니다. 추출 실패 시 일부 추출값만 저장하지 않으며, 앞 단계에서 성공한 전역변수 변경은 이후 실패로 되돌리지 않습니다. 실행 입력이나 앞 단계 값 연결로 이미 설정된 vars는 이 추출 처리와 별개입니다. 전역변수는 프로젝트의 모든 환경이 공유하므로, 같은 프로젝트의 중복 실행은 환경이 달라도 대기열에 넣지 않고 차단합니다.

작성 YAML의 `{{steps.1.response.body./id}}` 같은 참조는 내부에서 `{ name, step, source, area, pointer 또는 header }` 형태의 valueBindings로 변환됩니다. `source: request`는 해석된 명시적 요청값을, `source: response`는 응답 본문 또는 헤더를 가리킵니다. 같은 단계·뒤 단계 참조는 파싱 또는 미리보기에서 거부합니다. valueBindings를 YAML에 직접 쓰지 않습니다. 실행 결과에는 요청 원문을 request로, 응답 원문을 headers·body로 반환하므로 민감값이 포함될 수 있습니다.

API 문서의 공통 Bearer 연결은 프로젝트·환경·서버·기본 URL에 묶이며 요청 직전에 프로젝트 전역변수의 최신 값을 읽습니다. 수동 Authorization과 중복되거나 값이 없고 형식이 잘못되면 호출을 차단합니다. 문서용 Basic 인증은 API 호출에 재사용하지 않습니다.

시나리오 YAML의 최상위 `auth: globals.memberToken`은 모든 단계의 Bearer 기본값입니다. 각 단계는 `auth: globals.adminToken`으로 다른 계정을 선택하거나 `auth: none`으로 기본 인증을 제외할 수 있습니다. 지정하지 않은 단계는 기본값을 상속합니다. auth에는 변수 이름만 저장하며 실행기는 해당 요청 전에 프로젝트 전역변수를 읽습니다. 앞 단계에서 추출할 토큰은 사전 검사에서 기존 값의 유무·형식을 요구하지 않습니다. 따라서 인증 없는 로그인 단계에서 토큰을 저장한 뒤 후속 인증 요청을 실행할 수 있습니다. 추출 단계가 같은 단계이거나 뒤에 있으면 이 예외를 적용하지 않으며, 앞 단계에서 생성하지 않는 토큰은 기존 값을 검사합니다. 실제 토큰 형식은 모든 인증 요청 직전에 검사하므로 잘못된 추출값으로 인증 요청을 보내지 않습니다. 수동 Authorization과 중복 설정하면 사전 검사에서 계속 차단합니다.

## 개발과 검증

- `npm run dev:api:web`: 127.0.0.1:5174에서 동일 API 화면과 서버 코어 사용.
- `npm run dev`: Electron 개발 앱. renderer는 HMR, main/preload 변경은 앱 재시작 필요.
- `npm run test:api`: 코어·변수·저장·인증·삭제·AI·시나리오 편집 검증.
- `npm run typecheck:api`: API 코어 타입 검사.
- `npm run test:api:desktop`: Electron 통합 검증.
- `npm run build`: Vite 및 Electron 빌드.

웹 개발 RPC는 loopback 전용이며 Host·Origin·JSON·전용 헤더를 검사합니다. 문서 Basic 인증은 가능하지만 계정 기억은 제공하지 않습니다. native 파일 대화상자·OS 암호화·패키징은 앱에서 별도로 검증합니다.

로컬 샘플은 `npx tsx tests/api-testing/web-fixture.ts`로 실행합니다. 기본 URL은 `http://127.0.0.1:5175`, 명세는 `/openapi.json`, 문서 Basic 계정은 demo/demo, API 토큰은 demo-token입니다. 모두 테스트용 값입니다.
