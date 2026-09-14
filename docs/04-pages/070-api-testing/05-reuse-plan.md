# 기존 프로젝트 재사용 검토

2026-09-13 코드 열람 및 2026-09-14 Checkly 구현 기준. 이 문서는 외부 구현과의 비교, 현재 적용 범위와 후속 작업 계획을 기록한다. 외부 프로젝트 실행·실제 인증번호 발송은 하지 않았다.

## 확인한 구현

| 기능 | api-scenario | openapi-k6-runner | Checkly 현재 / 재사용 방향 |
| --- | --- | --- | --- |
| 사용자 입력 | `ApiScenarioRuntime.input()`이 실행에 제공된 Map을 조회하고 타입 변환. 누락 시 차단 예외 | 별도 `input` 단계. 제공된 vars가 없으면 `inputProvider`를 await | API 단계의 `input` 설정을 조회하고 `vars`·`inputs`·`globals`에 값이 없으면 UI 입력 공급자를 await. 제출값은 YAML에 저장하지 않음 |
| 토큰·헤더 | `ScenarioHeaders.bearer()`와 타입 있는 값의 binding | `buildHeaders()`에서 템플릿 평가 후 헤더 생성 | 기존 요청 헤더/변수 계약 유지. Swagger 인증 상태를 단계 값과 동기화하는 어댑터 필요 |
| 값 재사용 | JSON Pointer로 타입 있는 `ScenarioValue`를 추출하고 capture 기록 | 추출 결과와 템플릿으로 실행 context 사용 | 기존 `extract`와 `vars.*`/`globals.*`는 유지하고, `valueBindings`로 현재 시나리오의 요청·응답 출처를 추가 연결. 타 프로젝트 문법을 직접 복사하지 않음 |
| 실행 중 입력 UI | 확인한 core input 함수는 사전 입력 조회. UI 전체의 동등한 대기 기능은 미확인 | `requestUiRunInput()`이 Promise를 만들고 input-request 전송. `submitUiRunInput()`이 이름 검증 후 resolve | Electron IPC와 웹 RPC의 pending 조회·제출로 모달을 표시하고 실행을 재개 |
| 입력 취소·만료 | 이번 검토에서 확정하지 않음 | 확인한 대기 함수 자체에는 abort/timeout 해제 경로가 없음. 외부 종료 처리까지 추가 확인 필요 | 취소·renderer 종료 시 대기 해제, 5분 만료, 타입·run/step/request 일치 및 늦은/중복 제출 거절 |

## 근거 코드

외부 경로는 참조용이며 의존성으로 추가하지 않는다.

- `/Users/slogup/project/test/api-scenario/src/main/java/dev/apiscenario/core/ApiScenarioRuntime.java`: `input`, `ScenarioHeaders.bearer`, `extract`.
- `/Users/slogup/project/test/openapi-k6-runner/src/executor/scenario.executor.ts`: 입력 단계 실행, `inputProvider`, `buildHeaders`.
- `/Users/slogup/project/test/openapi-k6-runner/src/cli/ui/run-state.ts`: `requestUiRunInput`, `submitUiRunInput`.
- `/Users/slogup/project/test/openapi-k6-runner/test/scenario.executor.test.ts`: 인증번호 공급자 값을 다음 요청에 전달하는 테스트. 존재 확인만 했으며 이 프로젝트 테스트를 실행한 것은 아니다.
- Checkly `src/app/api-testing/shared/scenario.ts`: 모든 단계에 server/api가 필요한 현재 strict 계약.
- Checkly `src/app/api-testing/main/execution.ts`: 시작 전 입력 타입 검증 및 HTTP 단계 실행.

## 계약 차이

1. Checkly의 최상위 `inputs`는 실행 중 `input` 단계가 아니다. k6의 입력 단계를 그대로 가져오면 현재 schema에서 거절된다.
2. 입력 단계 도입 시 모델뿐 아니라 미리보기·저장·실행 결과·취소·웹 브리지·Electron IPC·Mermaid의 HTTP 전용 가정을 함께 수정해야 한다. 기존 YAML은 그대로 읽혀야 한다.
3. k6는 공급자 입력을 context에 넣으며 민감값이면 secretValues에 추가한다. Checkly는 입력 타입과 inputs/vars/globals 범위를 명시한다. 범위를 암묵적으로 통합하지 않는다.
4. k6 헤더 값은 평가 후 문자열로 변환한다. Checkly의 현재 문자열 헤더 및 타입 보존 규칙을 유지하고, 포맷 변환이 필요하면 명시한다.
5. OTP 실제 값은 시나리오 YAML에 자동 저장하지 않는다. k6의 저장값 재사용 경로가 있다고 해서 Checkly에도 자동 도입하지 않는다.

## 구현 순서와 완료 조건

### 진행 상태

Swagger 단계 입력 어댑터를 연결했다. 우측 단계 선택 시 저장된 파라미터·본문을 복원하고 Swagger 변경 이벤트를 활성 단계 ID에 반영한다. JSON 문법 오류 입력은 메모리에 유지하며 저장을 차단한다. 작성 모드의 execute는 차단한다. 현재 입력 활성화는 Swagger의 Try it out을 사용한다. `valueBindings`로 전체 시나리오의 요청·응답 출처를 `vars`에 연결하고, 검사에서는 출처 실행 순서만 확인한다. 별도 편집 진입은 아직 유지한다.

#### 2026-09-13 브라우저 검증

- `POST /bos/login`을 두 번 선택하고 각 단계에 서로 다른 더미 JSON 본문을 입력했다. 우측 단계 전환 시 각 입력값이 독립적으로 복원됐다.
- 불완전한 JSON을 입력한 뒤 다른 단계로 이동하고 돌아와도 원문이 유지됐다. 검사·저장 시 JSON 문법 오류로 저장이 차단됐다.
- 정상 JSON으로 `검증용 · Swagger 단계 분리 0913`을 저장한 뒤 시나리오 탭에서 재열었다. YAML의 두 단계에 각각 `ui-step-one`, `ui-step-two`가 보존됐다. 실제 인증정보는 사용하지 않았다.
- 해당 명세의 `cookie deviceId`는 당시 쿠키 파라미터 미지원 경고가 있어 초안으로 저장됐다. 현재는 단순 쿠키 파라미터를 지원하도록 보완했으며, 이 기존 초안의 실행 가능 상태는 실제 쿠키 값을 입력한 뒤 별도로 재검증해야 한다.
- 저장된 초안에서 `Swagger에서 편집`을 눌러 작성 화면으로 돌아온 뒤에도 같은 엔드포인트의 1·2단계 본문이 각각 `ui-step-one`, `ui-step-two`로 Swagger 편집기에 복원되는 것을 확인했다. 첫 펼침에서 Swagger 기본 예시가 값을 덮어쓰는 문제는 요청 편집기 마운트 뒤에 복원하도록 수정했다.
- 실제 API 요청은 실행하지 않았다. 쿼리·헤더·인증 상태 복원, Electron, 순서 변경 후 연결 검증은 이번 검증 범위에 포함되지 않는다. 따라서 1단계 전체 완료는 아니다.

### 1. 실제 Swagger UI와 단계 상태 연결

- 최초 전체 Swagger → 생성 시작 시 왼쪽 문서 / 오른쪽 순서 목록.
- 우측 단계 선택 시 좌측 Swagger를 열고 그 단계의 요청값을 복원한다.
- Swagger 입력 변경을 안정적인 단계 ID에 반영한다. 같은 endpoint를 두 번 추가한 경우 각각 독립 값을 보관한다.
- 읽기·복원 과정은 실제 API 호출이나 새 단계 추가를 유발하지 않는다.
- 토큰/공통 헤더의 적용 범위와 단계 override를 구분한다.
- 별도 편집 폼을 더 확장하지 않는다. 대체 흐름 검증 후에 기존 별도 편집 진입을 제거한다.

### 2. 사용자 입력 대기 연결 (현재 구현)

- k6의 provider/event/submit 개념을 참고하되 Checkly 실행기와 브리지에 맞춘다.
- 실행 시작 입력과 단계 중 입력을 구분한다. 최상위 `inputs`는 실행 시작값이고, 단계 `input`은 해당 API 직전의 대화형 입력이다.
- 입력 요청은 runId, stepId, 고유 requestId, 이름, 타입, 라벨, 필수/민감 여부를 포함한다.
- 제출 시 실행·단계·요청 일치와 타입을 검증한다. 대기 중 이후 API는 호출하지 않는다.
- 취소·renderer 종료·5분 만료 시 대기를 해제하고, 이전 실행의 늦은 제출 및 이중 제출을 거절한다.
- Electron IPC와 웹 개발 RPC에서 동일한 요청 계약을 사용한다. 비대화형 실행에서 공급자가 없으면 필수 입력을 blocked로 처리한다.

### 3. 검증

- 로컬 mock: 로그인 → 입력 요청 → 인증 확인 → 토큰 추출 → 조회.
- 다른 단계 전환 후 입력 복원, 중복 endpoint 값 분리, 비인접 응답 연결, 순서 변경 후 잘못된 참조 감지.
- 요청값·응답 본문·응답 헤더의 전체 시나리오 출처 연결, 이후 단계 출처의 값 순서 오류 감지, 명시하지 않은 중간 검증 미생성.
- 대기 중 취소, 필수 입력 누락, 잘못된 타입, 늦은/중복 제출, 프로젝트·환경 격리.
- `npm run test:api`: 단계 입력 공급자 전달, 요청·응답 값 출처 연결, 순서 오류, 취소·타임아웃과 기존 API 테스트를 포함해 29개 통과.
- 브라우저와 Electron에서 실제 UI 흐름을 확인한다. 기존 단위 테스트 통과만으로 UI 검증 완료라고 하지 않는다.
- 실제 서비스의 인증번호 발송·로그인 요청은 별도 확인 후 수행한다.
