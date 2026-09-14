# [사용자 흐름] API 테스트

## 프로젝트와 명세

1. 하단 API 테스트 메뉴에서 프로젝트를 만들고 서버·환경별 기본 URL을 저장합니다.
2. 서버와 환경을 선택하고 직접 OpenAPI JSON/YAML URL 또는 파일을 가져옵니다.
3. 문서 인증이 필요하면 Basic 아이디·비밀번호를 입력합니다. 앱에서 계정 기억을 선택할 수 있습니다.
4. 저장된 URL의 명세 새로고침으로 최신 명세를 가져옵니다. 실패하면 마지막 정상 문서를 유지합니다.
5. 프로젝트 설정에서 프로젝트·서버·환경을 관리하고 삭제합니다. 명세 삭제는 선택한 서버·환경에 적용됩니다.

문서 다운로드 URL과 실제 API 기본 URL은 독립적입니다. URL 변경 시 문서 인증 입력은 초기화되며 비밀번호는 가져오기 후 비웁니다.

## 개별 요청

1. 태그나 검색으로 API를 찾고 펼칩니다.
2. Authorize에서 기존 문자열 전역변수를 Bearer 토큰으로 연결하거나 새 토큰을 등록합니다.
3. 요청 파라미터·JSON 본문을 편집하고 Execute 또는 Dock의 API 실행을 누릅니다.
4. HTTP 상태·소요 시간·헤더·응답을 확인합니다.

Authorize의 연결은 선택한 서버의 개별 요청에 적용됩니다. 시나리오는 YAML의 Authorization 헤더로 변수를 명시합니다. 인증 해제는 연결만 해제하며 변수 삭제는 전역변수에서 수행합니다.

일반 설명의 details/summary는 접고 펼칠 수 있습니다. Mermaid 설명은 버튼으로 전체 화면 모달을 열어 확대·축소·스크롤합니다. 모달을 열면 배경 페이지 스크롤을 잠급니다.

## 시나리오 작성·검토·실행

탭은 URL의 `tab=api|scenarios|ai`로 구분합니다. `project`·`server`·`environment` 식별자도 포함하며 새로고침과 뒤로/앞으로 이동 시 복원합니다. 없는 식별자는 기본 항목으로 대체합니다. Swagger 태그·엔드포인트의 해시는 유지합니다. 작성·실행 중에는 URL 이력 이동으로 탭을 전환하지 않고 안내합니다. URL은 설정·명세·계정 데이터를 공유하지 않으며 동일한 로컬 데이터가 있어야 같은 항목이 열립니다.

1. 새 시나리오에서 YAML을 붙여넣거나 파일로 가져옵니다.
2. 검사·미리보기에서 API 존재 여부, 필수 요청값, 변수 정의 순서를 확인하고 YAML의 서버 이름을 실제 프로젝트 서버에 연결합니다.
3. 화면으로 만들기·편집에서 단계 추가·이동·삭제, 요청 JSON, 검증과 응답 추출을 편집합니다.
4. 값 설정에서 현재 시나리오의 어느 단계든 요청값·응답 본문·응답 헤더를 출처로 선택합니다. 선택하면 `valueBindings`와 대상 요청의 `{{vars.name}}` 참조가 함께 생성됩니다. 출처가 사용 단계보다 뒤면 저장 검사에서 순서 오류로 안내합니다.
5. 정상 시나리오는 저장하고, 명세 연결 등이 미완료이면 문법이 유효한 초안으로 저장합니다.
6. 이번 실행의 최상위 입력값을 제공하고 실행합니다. 결과 영역에 로딩바를 표시하고 완료 후 단계별 결과·시나리오 변수를 표시합니다.
7. 결과가 있으면 실행 버튼이 다시 실행으로 표시됩니다. 저장된 항목을 다시 열어 수정하거나 삭제할 수 있습니다.

시각 편집 적용은 YAML 생성과 검사이며 저장은 별도입니다. 주석과 YAML 서식은 재생성합니다. 중첩 필드·배열·본문 전체 연결은 요청 JSON/YAML에서 직접 편집합니다.

각 단계의 값 설정 메뉴에서 **전역변수** 또는 **시나리오 값**을 선택합니다. 시나리오 값은 현재 시나리오 전체 단계의 요청 영역(`pathParams`, `query`, `headers`, `cookies`, `body`)과 응답 본문·헤더를 출처로 사용할 수 있습니다. 요청값은 실제로 저장된 요청 JSON, 응답 본문은 명세 구조의 JSON Pointer, 응답 헤더는 헤더 이름으로 지정합니다. 실제 값은 실행 중에만 전달하며 메뉴는 원문을 미리 노출하지 않습니다. 적용은 요청 필드에 `{{vars.name}}`를 넣고 `valueBindings`를 기록합니다. 출처 단계가 사용 단계보다 뒤이거나 같은 단계면 자동 검증을 추가하지 않고 순서 오류로만 표시합니다.

### API 문서에서 바로 작성

API 선택 중에는 선택한 단계 목록에서 순서 변경·선택 취소를 할 수 있습니다. 좁은 화면에서는 목록이 위에 표시됩니다. **흐름 보기**는 기존 Mermaid 확대 창을 사용하며 호출 순서는 실선, `extract`와 `valueBindings`로 연결한 요청·응답 출처는 점선으로 표시합니다. 전역변수는 실행 전 기존 값의 출처를 확정할 수 없어 연결선으로 추정하지 않습니다. 읽기 전용이며 목록이나 편집 화면에서 변경한 뒤 다시 열면 갱신됩니다.

단계 기본 화면은 명세의 필수 요청 항목만 표시합니다. 선택 항목은 펼쳐 입력하며 단계 이름과 원본 JSON은 고급 설정에서 수정합니다. 엔드포인트 summary·description·파라미터 설명·응답 구조는 OpenAPI 명세에서 매핑해 표시하며 단계 YAML에 복사하지 않습니다. 각 요청 필드의 값 설정 메뉴에서 등록된 전역변수 또는 현재 시나리오의 어느 단계든 요청·응답 값을 선택할 수 있습니다. 선택 결과는 시나리오 변수 연결과 참조를 자동 생성합니다. 응답 선택기는 실제 실행 결과가 아닌 명세 구조이며 배열의 `/0`은 첫 항목입니다. 명세가 없거나 복잡한 본문·조건부 배열 선택은 고급 설정을 사용합니다.

응답 필드를 선택해 존재 검증 또는 전역변수 추출을 추가합니다. 전역변수는 편집 시가 아니라 실행 시 저장합니다. 값 비교는 고급 검증에서 편집합니다. 고급 `expect`를 직접 추가하지 않으면 중간 응답의 업무 규칙을 자동 검증하지 않고 HTTP 2xx만 확인합니다. 명시한 상태 검증은 기본값을 대체하므로 오류 응답 테스트도 가능합니다.

### 실행 중 사용자 입력

API 단계의 실행 입력 설정에서 이름·라벨·타입·필수 여부·민감 여부를 지정할 수 있습니다. 요청 본문·경로·쿼리·헤더 등에는 `{{vars.입력 이름}}`을 사용합니다. 실행기가 해당 단계에 도달했을 때 같은 이름의 `vars`, 최상위 `inputs`, `globals` 값이 없으면 실행을 멈추고 입력 모달을 표시합니다. 사용자가 입력을 제출하면 값은 해당 실행의 `vars`에 들어가 같은 요청과 이후 단계에서 사용할 수 있습니다.

입력 모달의 실제 값은 시나리오 YAML에 저장하지 않습니다. `sensitive: true`인 값은 실행 결과와 변수 표시에서 마스킹하며, 실행 취소·창 종료·5분 만료 시 대기를 해제합니다. 필수값이 만료되거나 비대화형 실행에 입력 공급자가 없으면 해당 단계는 차단됩니다.

1. **시나리오 작성**을 누르면 Swagger에서 API 선택을 시작합니다. **선택한 API N개 · 시나리오 작성**을 누르면 전체 Swagger 목록을 숨기고 선택한 API만 편집합니다. **API 추가**로 돌아가도 작성 중인 입력은 유지됩니다.
2. 엔드포인트 행을 클릭한 순서대로 단계를 추가합니다. 동일 API를 여러 번 추가하고 단계 순서를 바꾸거나 삭제할 수 있습니다. 선택 중 API를 실행하지 않습니다.
3. 편집 화면은 선택한 API만 실행 순서대로 나열한 Swagger형 아코디언입니다. 메서드 색상·경로·OpenAPI summary/description으로 구분하며 여러 API를 동시에 펼칠 수 있습니다. 각 API는 요청 입력과 응답 명세 구조를 위아래로 표시합니다. 값 설정은 오른쪽 단계 편집기의 요청 필드에서 전역변수, 실행 입력, 시나리오 전체의 요청·응답 출처를 선택해 현재 요청 항목에 연결합니다. 왼쪽 Swagger는 원본 API 문서와 엔드포인트 선택·확인만 담당합니다. 순서 변경·삭제 및 고급 검증은 펼친 영역에서 설정합니다. YAML에는 시나리오 이름·단계 이름·실행 설정만 저장하고 엔드포인트 설명은 저장하지 않습니다. Swagger에 입력했던 요청·인증값을 자동 복사하지 않습니다.
4. **시나리오 검사·저장**으로 현재 프로젝트에 저장합니다. 명세 검증 문제가 있으면 초안으로 저장하고 보완 항목을 표시합니다. 저장해도 실행하거나 시나리오 탭으로 이동하지 않으며 같은 패널에서 계속 수정할 수 있습니다.
5. 저장 후 **새 시나리오**로 다음 작성을 시작합니다. 미저장 변경사항이 있으면 먼저 저장해야 합니다. **다른 서버 API 추가**를 펼치면 같은 프로젝트·환경의 다른 서버 명세에서 단계를 추가할 수 있습니다.
6. 작성 중 프로젝트·환경·문서 전환은 비활성화합니다. 미저장 상태에서 닫기를 누르면 **계속 작성** 또는 **변경사항 버리고 닫기**를 선택합니다. 잘못된 JSON 입력도 변경사항으로 취급하며, 계속 작성하면 입력을 유지합니다. 영구 보관하려면 저장해야 합니다. 우클릭 메뉴는 아직 제공하지 않습니다.

## YAML 계약과 예제

`version: 1`, 시나리오의 `id`·`name`과 단계의 `id`·시나리오용 `name`을 사용합니다. 최상위 `description`은 시나리오 설명으로 저장합니다. 단계의 엔드포인트 summary·description은 OpenAPI에서 읽으므로 YAML에 작성하지 않습니다. 기존 YAML의 단계 `description`은 호환을 위해 읽을 수 있지만 시각 편집기로 다시 저장할 때 제거합니다. `operationId`가 있으면 `api: { operationId: ... }`로 매핑하고, 없으면 method/path를 사용합니다.

```yaml
version: 1
id: items/read-again
name: 상품 목록에서 선택한 상품 재조회
description: 첫 응답에서 저장한 상품 ID를 후속 요청에 사용합니다.
onFailure: stop
inputs:
  token: { type: string, required: true, sensitive: true }
steps:
  - id: list
    name: 상품 목록 조회
    server: backend
    api: { method: GET, path: /items }
    request:
      headers:
        Authorization: "Bearer {{inputs.token}}"
    extract:
      - { source: body, pointer: /items/0/id, target: vars.itemId }
  - id: read
    name: 선택 상품 조회
    server: backend
    api: { method: GET, path: "/items/{id}" }
    request:
      pathParams: { id: "{{vars.itemId}}" }
      headers:
        Authorization: "Bearer {{inputs.token}}"
    expect:
      - { source: status, operator: equals, value: 200 }
```

API 단계에서 인증번호처럼 실행 중 받아야 하는 값을 요청에 사용하는 예시는 다음과 같습니다. `input`은 별도 호출 단계가 아니라 해당 API 단계에 붙는 입력 요청 설정입니다.

```yaml
steps:
  - id: verify
    name: SMS 인증번호 확인
    server: backend
    api: { method: POST, path: /phone/verify }
    input:
      name: phoneCode
      label: SMS 인증번호
      type: string
      required: true
      sensitive: true
    request:
      body: { code: "{{vars.phoneCode}}" }
```

예제는 가상 API 계약입니다. backend를 실제 서버에 연결하고 응답 구조를 확인해야 합니다. 2단계에서 추출한 변수도 이후 덮어쓰지 않으면 6단계에서 참조할 수 있습니다.

응답뿐 아니라 앞 단계에서 실제로 사용한 요청값도 연결할 수 있습니다. 출처 단계가 먼저 실행된 뒤 `vars`로 전달되며, 아래처럼 요청 본문·응답 본문·응답 헤더를 각각 지정합니다.

```yaml
version: 1
id: request-response-reuse
name: 요청·응답 값 재사용
valueBindings:
  - { name: loginId, step: login, source: request, area: body, pointer: /loginId }
  - { name: accessToken, step: login, source: response, area: body, pointer: /accessToken, sensitive: true }
  - { name: traceId, step: login, source: response, area: header, header: X-Request-Id }
steps:
  - id: login
    name: 로그인
    server: backend
    api: { method: POST, path: /login }
    request:
      body: { loginId: "demo" }
  - id: audit
    name: 감사 로그 조회
    server: backend
    api: { method: GET, path: /audit }
    request:
      query: { loginId: "{{vars.loginId}}" }
      headers:
        Authorization: "Bearer {{vars.accessToken}}"
        X-Request-Id: "{{vars.traceId}}"
```

| 참조 | 범위·수명 |
| --- | --- |
| `inputs.name` | 이번 실행의 입력 |
| `vars.name` | 시나리오 초기값·응답 추출·값 출처 연결값, 실행마다 초기화 |
| `valueBindings` | 현재 시나리오의 요청·응답 출처를 `vars.name`으로 연결. 출처 단계가 사용 단계보다 먼저 실행되어야 함 |
| `globals.name` | 프로젝트·환경별 세션 공유 값, 재시작 시 초기화 |
| `step.input.name` | 해당 단계에서 값이 없을 때 표시할 실행 중 입력 설정. 제출값은 실행 중 `vars.name`으로만 사용 |

값 전체가 변수 참조이면 JSON 타입을 유지합니다. 문자열 내부 참조는 문자열로 조합하며 객체·배열 삽입은 오류입니다. 추출과 값 출처는 JSON Pointer 또는 헤더 이름을 사용합니다. 검증 연산자는 equals, exists, contains이며 암묵적 타입 변환이 없습니다. expect 생략은 HTTP 2xx 성공이며 중간 업무 검증을 자동 추가하지 않습니다. 기존 openapi-k6 문법의 자동 호환·변환 기능은 없습니다.

## AI 작성 도우미

서버별 API와 업무 목표를 선택 → AI 전달 정보 미리보기 → 복사 → 외부 AI에서 YAML 생성 → 시나리오 탭으로 가져오기 순서입니다. 최대 100개 API, 출력 최대 500KB입니다. 서버 URL·실제 변수값·실행 이력·명세 example/default/enum·확장 필드는 제외합니다. 설명과 사용자가 작성한 목표는 포함됩니다. AI 모델을 직접 호출하지 않습니다.

## 두 서버의 6단계 실행 예제

회원 문의 생성 후 관리자가 답변하고 회원이 조회합니다. 2단계의 inquiryId를 5·6단계에서 재사용합니다. 아래 가상 API 예제는 실행 코어 테스트에서도 읽어 검증합니다.

```yaml
version: 1
id: inquiry/create-and-answer
name: 회원 문의 등록부터 관리자 답변 확인
description: |
  회원이 문의를 등록하고 관리자가 답변한 뒤,
  회원이 조회한 문의에 작성한 답변이 표시되는지 검증합니다.
onFailure: stop
inputs:
  memberLoginId: { type: string, required: true }
  memberPassword: { type: string, required: true, sensitive: true }
  adminLoginId: { type: string, required: true }
  adminPassword: { type: string, required: true, sensitive: true }
vars:
  answerText: 테스트 답변입니다
steps:
  - id: memberLogin
    name: 회원 로그인
    server: member
    api: { method: POST, path: /auth/login }
    request:
      body:
        loginId: "{{inputs.memberLoginId}}"
        password: "{{inputs.memberPassword}}"
    expect:
      - { source: status, operator: equals, value: 200 }
    extract:
      - source: body
        pointer: /accessToken
        target: globals.memberAccessToken
        sensitive: true

  - id: createInquiry
    name: 회원 문의 등록
    server: member
    api: { method: POST, path: /inquiries }
    request:
      headers:
        Authorization: "Bearer {{globals.memberAccessToken}}"
      body: { title: 테스트 문의, content: 배송 일정 문의 }
    expect:
      - { source: status, operator: equals, value: 201 }
    extract:
      - { source: body, pointer: /id, target: vars.inquiryId }

  - id: adminLogin
    name: 관리자 로그인
    server: admin
    api: { method: POST, path: /auth/login }
    request:
      body:
        loginId: "{{inputs.adminLoginId}}"
        password: "{{inputs.adminPassword}}"
    expect:
      - { source: status, operator: equals, value: 200 }
    extract:
      - source: body
        pointer: /accessToken
        target: globals.adminAccessToken
        sensitive: true

  - id: listInquiries
    name: 관리자 문의 목록 조회
    server: admin
    api: { method: GET, path: /inquiries }
    request:
      headers:
        Authorization: "Bearer {{globals.adminAccessToken}}"
    expect:
      - { source: status, operator: equals, value: 200 }

  - id: answerInquiry
    name: 관리자 답변 등록
    server: admin
    api: { method: POST, path: '/inquiries/{id}/answers' }
    request:
      pathParams: { id: "{{vars.inquiryId}}" }
      headers:
        Authorization: "Bearer {{globals.adminAccessToken}}"
      body: { content: "{{vars.answerText}}" }
    expect:
      - { source: status, operator: equals, value: 201 }

  - id: verifyInquiry
    name: 회원 문의 답변 확인
    server: member
    api: { method: GET, path: '/inquiries/{id}' }
    request:
      pathParams: { id: "{{vars.inquiryId}}" }
      headers:
        Authorization: "Bearer {{globals.memberAccessToken}}"
    expect:
      - { source: status, operator: equals, value: 200 }
      - source: body
        pointer: /answer/content
        operator: equals
        value: "{{vars.answerText}}"
```
