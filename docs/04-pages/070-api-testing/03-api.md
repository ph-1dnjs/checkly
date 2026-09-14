# [IPC 연동] API 테스트

앱은 `window.electronAPI.apiTesting`을 사용합니다. 타입은 `src/app/api-testing/shared/workspace.ts`, 등록은 `main/register.ts`, 연결은 `src/app/preload.ts`에 있습니다.

아래 모든 채널에는 `api-testing:` 접두사가 붙습니다.

| 채널 | 주요 입력 → 출력 |
| --- | --- |
| list-projects / save-project / delete-project | 프로젝트 목록·설정·ID → 목록/저장 결과/완료 |
| catalog / delete-catalog | projectId, environmentId, serverId → 명세/완료 |
| import | scope, 파일 또는 URL·Basic 인증 → 명세 또는 취소 시 null |
| spec-sync / delete-spec-account | scope → 동기화·계정 저장 여부/완료 |
| get-request-auth / set-request-auth | scope, 변수 이름 또는 null → 연결 이름/완료 |
| list-globals / set-global / delete-global | 프로젝트·환경, 이름·JSON 값 → 마스킹된 목록/완료 |
| execute / execute-live | scope, operation key, request → ApiResponse |
| cancel | scope → 현재 환경 실행 취소 |
| list-scenarios / read-scenario-file | 프로젝트 ID/파일 선택 → 목록/YAML 또는 null |
| preview-scenario | 프로젝트·환경, YAML, 서버 매핑 → scenario, issues |
| save-scenario / save-scenario-draft | 동일 입력 + expectedUpdatedAt → 저장 항목 |
| delete-scenario | 프로젝트 ID, 시나리오 ID, expectedUpdatedAt → 완료 |
| run-scenario | 프로젝트·환경, YAML, 서버 매핑, inputs → ApiScenarioResult |
| get-pending-input | 프로젝트·환경 → 현재 실행 입력 요청 또는 null |
| submit-input | 프로젝트·환경, requestId·runId·stepId·name·JSON value → 대기 해제 |
| ai-context / copy-ai-context | scope, 선택 API, goal → 텍스트/클립보드 복사 |

`ApiResponse`는 status, httpStatus, durationMs, headers, body, error를 제공합니다. `ApiScenarioResult`는 전체 status, 단계별 결과, variables를 제공합니다. 브리지 오류는 Promise rejection으로, 실행 중 검증·요청 실패는 결과 상태로 반환합니다. API 시나리오 단계별 progress 이벤트는 아직 없으며, renderer는 대기 중인 입력 요청을 조회해 모달을 표시합니다.

`get-pending-input`은 값이 아니라 `requestId`, `runId`, `stepId`, 입력 이름·라벨·타입·필수/민감 여부와 현재 단계 번호만 반환합니다. `submit-input`은 이 식별자들이 현재 실행과 일치하는지와 JSON 타입을 확인한 뒤 실행을 재개합니다. 입력값은 실행 요청의 메모리와 마스킹 계층에만 존재하며 YAML에는 기록하지 않습니다. Electron은 IPC 채널로, 웹 개발 모드는 같은-origin 개발 RPC로 제공합니다.

## 실행 계약

실행 직전에 현재 환경의 명세와 서버 연결을 재검증합니다. 시나리오 YAML은 `operationId` 또는 method/path로 명세의 엔드포인트를 가리키며, summary·description·파라미터·요청/응답 스키마는 저장된 OpenAPI 카탈로그에서 다시 읽습니다. JSON 본문과 단일 값 경로·쿼리·헤더·쿠키를 구성하며 기본 요청 시간 제한은 30초입니다. 쿠키는 `request.cookies`의 단순 문자열·숫자·불리언 값을 `Cookie` 헤더로 조합합니다. 리다이렉트·자동 재시도를 하지 않습니다.

기본 실패 정책은 stop이며 이후 단계는 skipped입니다. continue이면 후속 단계를 시도하고 필요한 변수가 없으면 blocked입니다. 취소는 진행 요청을 중단하고 후속 호출을 막습니다.

API 단계에 `input`이 있고 같은 이름의 값이 없으면 `run-scenario`는 입력 공급자 Promise를 기다립니다. 제출된 값은 현재 요청을 resolve하기 전에 `vars`에 들어가며 이후 단계에서도 참조할 수 있습니다. 취소·renderer 종료·5분 만료는 대기를 `undefined`로 끝내고, 필수 입력이면 해당 단계가 blocked가 됩니다.

요청을 resolve한 뒤 요청 출처 스냅샷을 저장하고, 응답을 받은 뒤 응답 출처 스냅샷을 저장합니다. 이전 단계에서 만들어진 `valueBindings`만 다음 요청을 resolve하기 전에 `vars`에 반영합니다. 검증은 사용자가 명시한 `expect`와 기본 HTTP 2xx만 수행하며 중간 업무 검증을 자동으로 끼워 넣지 않습니다. 모든 추출이 성공한 후 해당 단계의 vars/globals 변경을 반영합니다. 실패한 단계는 일부 변수만 저장하지 않습니다. 앞 단계에서 성공한 전역변수 변경은 이후 실패로 되돌리지 않습니다. 같은 프로젝트·환경 중복 실행은 대기열에 넣지 않고 차단합니다.

`valueBindings`는 `{name, step, source, area, pointer|header}` 구조입니다. `source: request`는 출처 단계의 실제 해석된 요청값을, `source: response`는 응답 본문 또는 헤더를 가리킵니다. 미리보기는 `{{vars.name}}` 사용 위치와 출처 단계의 순서를 검사하며, 출처가 이후이거나 같은 단계면 값 순서 오류를 반환합니다. 실행 결과에는 출처 원문을 별도 필드로 노출하지 않습니다.

Bearer 연결은 프로젝트·환경·서버·기본 URL에 묶이며 요청 직전에 최신 변수값을 읽습니다. 수동 Authorization과 중복되거나 값이 없고 형식이 잘못되면 호출을 차단합니다. 문서용 Basic 인증은 API 호출에 재사용하지 않습니다.

## 개발과 검증

- `npm run dev:api:web`: 127.0.0.1:5174에서 동일 API 화면과 서버 코어 사용.
- `npm run dev`: Electron 개발 앱. renderer는 HMR, main/preload 변경은 앱 재시작 필요.
- `npm run test:api`: 코어·변수·저장·인증·삭제·AI·시나리오 편집 검증.
- `npm run typecheck:api`: API 코어 타입 검사.
- `npm run test:api:desktop`: Electron 통합 검증.
- `npm run build`: Vite 및 Electron 빌드.

웹 개발 RPC는 loopback 전용이며 Host·Origin·JSON·전용 헤더를 검사합니다. 문서 Basic 인증은 가능하지만 계정 기억은 제공하지 않습니다. native 파일 대화상자·OS 암호화·패키징은 앱에서 별도로 검증합니다.

로컬 샘플은 `npx tsx tests/api-testing/web-fixture.ts`로 실행합니다. 기본 URL은 `http://127.0.0.1:5175`, 명세는 `/openapi.json`, 문서 Basic 계정은 demo/demo, API 토큰은 demo-token입니다. 모두 테스트용 값입니다.
