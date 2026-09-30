# 기존 프로젝트 재사용 검토

Checkly의 현재 구현은 2026-09-29 커밋 `3b62f9f` 기준이다. 외부 프로젝트 비교는 2026-09-13 코드 열람 기록이며, 현재 버전을 다시 실행하거나 검증한 결과가 아니다. 당시 브라우저 검증은 아래 역사 기록에 별도로 보존한다. 외부 프로젝트 실행·실제 인증번호 발송은 하지 않았다.

## 외부 조사와 현재 적용 범위

외부 두 프로젝트 열은 2026-09-13 조사 결과이고, Checkly 열은 2026-09-29 현재 구현이다.

| 기능 | api-scenario | openapi-k6-runner | Checkly 현재 / 재사용 방향 |
| --- | --- | --- | --- |
| 사용자 입력 | `ApiScenarioRuntime.input()`이 실행에 제공된 Map을 조회하고 타입 변환. 누락 시 차단 예외 | 별도 `input` 단계. 제공된 vars가 없으면 `inputProvider`를 await | YAML은 해당 API 단계의 `inputs` 목록과 `{{inputs.이름}}`을 사용한다. 실행기는 기존 값이 없으면 UI 입력 공급자를 기다린다. 제출값은 YAML에 저장하지 않음 |
| 토큰·헤더 | `ScenarioHeaders.bearer()`와 타입 있는 값의 binding | `buildHeaders()`에서 템플릿 평가 후 헤더 생성 | 일반 Swagger의 Authorize 상태를 시나리오에 자동 전달하지 않는다. 시나리오는 공통·단계별 `auth: globals.이름`, 단계별 `auth: none` 또는 명시적인 헤더로 인증 범위를 정한다 |
| 값 재사용 | JSON Pointer로 타입 있는 `ScenarioValue`를 추출하고 capture 기록 | 추출 결과와 템플릿으로 실행 context 사용 | YAML은 `{{steps.N.request.…}}`·`{{steps.N.response.…}}`로 앞 단계 값을 참조하고, `extract`는 `globals.이름`에 저장한다. 파서는 단계 번호 참조를 내부 `valueBindings`·`vars`로 변환한다 |
| 실행 중 입력 UI | 확인한 core input 함수는 사전 입력 조회. UI 전체의 동등한 대기 기능은 미확인 | `requestUiRunInput()`이 Promise를 만들고 input-request 전송. `submitUiRunInput()`이 이름 검증 후 resolve | Electron IPC와 웹 RPC의 pending 조회·제출로 모달을 표시하고 실행을 재개 |
| 입력 취소·만료 | 이번 검토에서 확정하지 않음 | 확인한 대기 함수 자체에는 abort/timeout 해제 경로가 없음. 외부 종료 처리까지 추가 확인 필요 | 취소·renderer 종료 시 대기 해제, 5분 만료, 타입·run/step/request 일치 및 늦은/중복 제출 거절 |

## 근거 코드

외부 경로는 참조용이며 의존성으로 추가하지 않는다.

- `/Users/slogup/project/test/api-scenario/src/main/java/dev/apiscenario/core/ApiScenarioRuntime.java`: `input`, `ScenarioHeaders.bearer`, `extract`.
- `/Users/slogup/project/test/openapi-k6-runner/src/executor/scenario.executor.ts`: 입력 단계 실행, `inputProvider`, `buildHeaders`.
- `/Users/slogup/project/test/openapi-k6-runner/src/cli/ui/run-state.ts`: `requestUiRunInput`, `submitUiRunInput`.
- `/Users/slogup/project/test/openapi-k6-runner/test/scenario.executor.test.ts`: 인증번호 공급자 값을 다음 요청에 전달하는 테스트. 존재 확인만 했으며 이 프로젝트 테스트를 실행한 것은 아니다.
- Checkly `src/app/api-testing/shared/scenario.ts`: 단일 YAML 작성 문법 검사·직렬화, 폐기 문법 거절, 내부 실행 모델 변환.
- Checkly `src/app/api-testing/main/execution.ts`: 실행 전 검사, 단계 입력 공급자 대기, HTTP 단계 실행.
- Checkly `src/renderer/pages/api-testing/ui/ApiDocumentation.tsx`, `src/renderer/features/api-testing/edit-scenario/ui/ScenarioBuilder.tsx`: API 선택과 별도 값 설정 화면.
- Checkly `src/app/api-testing/main/register.ts`, `web-dev.ts`: Electron IPC·웹 RPC의 입력 조회와 제출.

## 현재 계약과 재사용 시 주의점

1. Checkly의 입력 대기는 독립적인 `input` 단계가 아니라 API 단계의 `inputs` 목록이다. 최상위 `inputs`와 단계 `input`(단수)은 YAML에서 거절된다. k6의 입력 단계를 그대로 복사하지 않는다.
2. YAML은 한 가지 작성 문법만 허용한다. `api: 'METHOD /path'`와 단계 바로 아래의 요청값을 사용하며, `server`는 시나리오 공통값 또는 단계별 값으로 지정한다. 이전 문법의 읽기 호환은 제거됐다. `version`, 단계 `id`, `request:` 감싸기, API 객체·`operationId`, `vars`, `valueBindings`, `{{vars.…}}`도 허용하지 않는다. 자세한 형식은 [YAML 문법](02-userflow.md)을 따른다.
3. 작성 문법과 실행기 내부 모델을 구분한다. 파서는 단계 ID를 만들고 `steps.N` 참조를 `valueBindings`·`vars`로, 단계 입력 참조를 내부 변수 참조로 변환한다. 내부 모델에 남은 `inputs`·`input`·`vars` 필드는 사용자 YAML의 호환 지원을 뜻하지 않는다.
4. k6 헤더 값은 평가 후 문자열로 변환한다. Checkly의 현재 문자열 헤더 및 타입 보존 규칙을 유지하고, 포맷 변환이 필요하면 명시한다.
5. OTP 실제 값은 시나리오 YAML에 자동 저장하지 않는다. k6의 저장값 재사용 경로가 있다고 해서 Checkly에도 자동 도입하지 않는다.

## 현재 구현 상태

### API 선택과 값 설정

시나리오 작성은 **API 선택 → 값 설정 → 검사·저장** 순서다. API 선택에서는 Swagger 문서를 읽고 오른쪽 목록에서 호출 순서를 정한다. 작성 중에는 Swagger의 Try it out을 비활성화한다. 값 설정으로 넘어가면 Swagger 문서를 숨기고 `ScenarioBuilder`·`SimpleStep`에서 단계별 요청값, 인증, 입력, 값 연결, 추출, 검증을 편집한다. 같은 API를 여러 번 추가해도 각 단계의 설정은 독립적으로 보관한다.

이전 Swagger 요청 편집기의 변경 이벤트를 단계에 반영하거나 단계 선택 시 요청값을 Swagger에 복원하던 어댑터는 제거됐다. 일반 API 문서의 Try it out은 개별 요청 실행에 계속 사용한다. 시나리오 편집·YAML 가져오기·AI 작성은 같은 단일 YAML 문법을 따르며, YAML 편집이 이전 형식의 호환 경로를 제공하지 않는다.

### 사용자 입력 대기

- k6의 provider/event/submit 개념을 참고하되 Checkly 실행기와 브리지에 맞춘다.
- 해당 API 단계의 `inputs` 목록을 순서대로 처리한다. 입력값이 실행 context에 없으면 HTTP 호출 직전에 모달 응답을 기다린다. YAML에는 입력 정의와 `{{inputs.이름}}` 참조만 저장한다.
- 입력 요청은 runId, stepId, 고유 requestId, 이름, 타입, 라벨, 필수/민감 여부를 포함한다.
- 제출 시 실행·단계·요청 일치와 타입을 검증한다. 대기 중 이후 API는 호출하지 않는다.
- 취소·renderer 종료·5분 만료 시 대기를 해제하고, 이전 실행의 늦은 제출 및 이중 제출을 거절한다.
- Electron IPC와 웹 개발 RPC에서 동일한 요청 계약을 사용한다. 비대화형 실행에서 공급자가 없으면 필수 입력을 blocked로 처리한다.

## 검증 범위와 후속 확인

현재 회귀 검증은 다음 항목을 대상으로 한다. 이 목록은 전 항목의 수동 검증 완료 선언이 아니다.

- 로컬 mock의 로그인 → 입력 요청 → 인증 확인 → 토큰 추출 → 조회.
- API 선택과 별도 값 설정 전환, 중복 API의 단계별 값 분리, 앞 단계 요청·응답 연결, 순서 변경 후 잘못된 참조 감지.
- 단일 YAML의 저장·읽기·재저장, 폐기 문법 거절, 여러 단계 입력, 명시하지 않은 업무 검증 미생성.
- 대기 중 취소, 필수 입력 누락, 잘못된 타입, 늦은/중복 제출과 프로젝트 단위 전역변수 공유·중복 실행 차단.
- `tests/api-testing/scenario-simple.test.ts`, `scenario-builder.test.ts`, `execution.test.ts`, `project-lock.test.ts`와 `desktop.e2e.ts`가 관련 자동화 검증을 제공한다.

2026-09-29 문서 정리는 현행 코드와 커밋 차이 대조를 기준으로 했다. 자동화 테스트 통과와 실제 서비스의 수동 검증은 구분한다. 실제 인증번호 발송·로그인 요청과 아래 기존 초안의 실행 가능 상태는 별도 확인 대상이다.

## 역사 기록

### 2026-09-13 브라우저 검증

아래는 당시 Swagger 단계 편집 어댑터에 대한 기록이다. 당시 UI, YAML 형식과 완료 판정을 보존하며, 2026-09-29 현재 UI의 검증 결과로 보지 않는다.

- `POST /bos/login`을 두 번 선택하고 각 단계에 서로 다른 더미 JSON 본문을 입력했다. 우측 단계 전환 시 각 입력값이 독립적으로 복원됐다.
- 불완전한 JSON을 입력한 뒤 다른 단계로 이동하고 돌아와도 원문이 유지됐다. 검사·저장 시 JSON 문법 오류로 저장이 차단됐다.
- 정상 JSON으로 `검증용 · Swagger 단계 분리 0913`을 저장한 뒤 시나리오 탭에서 재열었다. YAML의 두 단계에 각각 `ui-step-one`, `ui-step-two`가 보존됐다. 실제 인증정보는 사용하지 않았다.
- 해당 명세의 `cookie deviceId`는 당시 쿠키 파라미터 미지원 경고가 있어 초안으로 저장됐다. 이후 단순 쿠키 파라미터 지원은 보완됐지만, 이 기존 초안의 실행 가능 상태는 실제 쿠키 값을 입력한 뒤 별도로 재검증해야 한다.
- 저장된 초안에서 `Swagger에서 편집`을 눌러 작성 화면으로 돌아온 뒤에도 같은 엔드포인트의 1·2단계 본문이 각각 `ui-step-one`, `ui-step-two`로 Swagger 편집기에 복원되는 것을 확인했다. 첫 펼침에서 Swagger 기본 예시가 값을 덮어쓰는 문제는 요청 편집기 마운트 뒤에 복원하도록 수정했다.
- 실제 API 요청은 실행하지 않았다. 쿼리·헤더·인증 상태 복원, Electron, 순서 변경 후 연결 검증은 당시 검증 범위에 포함되지 않았다. 당시 1단계 전체 완료로 판정하지 않았다.

### 이전 문서의 자동화 검증 기록

이전 문서에는 `npm run test:api` 32개 통과가 기록돼 있었다. 단계 입력 공급자 전달, 요청·응답 값 출처 연결, 순서 오류, 취소·타임아웃과 기존 API 테스트에 대한 과거 기록이며, 현재 테스트 수나 2026-09-29 문서 수정 시의 재실행 결과를 뜻하지 않는다.
