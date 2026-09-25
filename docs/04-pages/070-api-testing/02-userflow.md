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

탭은 URL의 `tab=api|scenarios|scenario-editor|ai`로 구분합니다. `project`·`server`·`environment` 식별자도 포함하며 새로고침과 뒤로/앞으로 이동 시 복원합니다. 없는 식별자는 기본 항목으로 대체합니다. Swagger 태그·엔드포인트의 해시는 유지합니다. 작성·실행 중에는 URL 이력 이동으로 탭을 전환하지 않고 안내합니다. URL은 설정·명세·계정 데이터를 공유하지 않으며 동일한 로컬 데이터가 있어야 같은 항목이 열립니다.

1. 시나리오 탭의 **+ 새 시나리오** 또는 API 문서의 **시나리오 작성**으로 작성 화면을 엽니다. YAML을 직접 붙여넣거나 파일로 가져오는 경로도 유지합니다.
2. API 문서에서 작성할 때는 왼쪽 Swagger 목록에서 엔드포인트의 별도 체인 아이콘을 눌러 오른쪽 선택 목록에 추가합니다. 일반 행 클릭은 Swagger처럼 상세 열기·닫기만 수행합니다.
3. 검사·미리보기에서 API 존재 여부, 필수 요청값, 변수 정의 순서를 확인하고 YAML의 서버 이름을 실제 프로젝트 서버에 연결합니다.
4. 화면 편집에서 단계 추가·이동·삭제, 요청 JSON, 검증과 응답 추출을 편집합니다.
5. 값 설정에서 다른 단계의 요청값·응답 본문·응답 헤더를 출처로 선택합니다. 선택하면 `valueBindings`와 대상 요청의 `{{vars.name}}` 참조가 함께 생성됩니다. 실행 가능한 순서인지는 시나리오 검사에서 안내합니다.
6. 정상 시나리오는 저장하고, 명세 연결 등이 미완료이면 문법이 유효한 초안으로 저장합니다.
7. 이번 실행의 최상위 입력값을 제공하고 실행합니다. 결과 영역에 로딩바를 표시하고 완료 후 단계별 결과·시나리오 변수를 표시합니다.
8. 결과가 있으면 실행 버튼이 다시 실행으로 표시됩니다. 저장된 항목을 다시 열어 수정하거나 삭제할 수 있습니다.

시각 편집 적용은 YAML 생성과 검사이며 저장은 별도입니다. 주석과 YAML 서식은 재생성합니다. 중첩 필드·배열·본문 전체 연결은 요청 JSON/YAML에서 직접 편집합니다.

각 단계의 값 설정 메뉴에서 **전역변수** 또는 **시나리오 값**을 선택합니다. 시나리오 값은 다른 단계의 요청 영역(`pathParams`, `query`, `headers`, `cookies`, `body`)과 응답 본문·헤더를 출처로 사용할 수 있습니다. 요청값은 실제로 저장된 요청 JSON, 응답 본문은 명세 구조의 JSON Pointer, 응답 헤더는 헤더 이름으로 지정합니다. 실제 값은 실행 중에만 전달하며 메뉴는 원문을 미리 노출하지 않습니다. 적용은 요청 필드에 `{{vars.name}}`를 넣고 `valueBindings`를 기록합니다. 현재 단계와의 순서가 맞는지는 시나리오 검사에서 확인합니다.

### API 문서에서 바로 작성

API 선택 중에는 선택한 단계 목록에서 순서 변경·선택 취소를 할 수 있습니다. 좁은 화면에서는 목록이 위에 표시됩니다. **흐름 보기**는 기존 Mermaid 확대 창을 사용하며 호출 순서는 실선, `extract`와 `valueBindings`로 연결한 요청·응답 출처는 점선으로 표시합니다. 전역변수는 실행 전 기존 값의 출처를 확정할 수 없어 연결선으로 추정하지 않습니다. 읽기 전용이며 목록이나 편집 화면에서 변경한 뒤 다시 열면 갱신됩니다.

단계 기본 화면은 명세의 필수 요청 항목만 표시합니다. 선택 항목은 펼쳐 입력하며 단계 이름과 원본 JSON은 고급 설정에서 수정합니다. 엔드포인트 summary·description·파라미터 설명·응답 구조는 OpenAPI 명세에서 매핑해 표시하며 단계 YAML에 복사하지 않습니다. 각 요청 필드의 값 설정 메뉴에서 등록된 전역변수 또는 다른 단계의 요청·응답 값을 선택할 수 있습니다. 선택 결과는 시나리오 변수 연결과 참조를 자동 생성합니다. 응답 선택기는 실제 실행 결과가 아닌 DTO/명세 구조이며 배열 원소를 임의의 인덱스로 만들지 않고 배열 필드만 표시합니다. 특정 원소의 JSON Pointer가 필요하면 고급 설정을 사용합니다.

응답 필드를 선택해 존재 검증 또는 전역변수 추출을 추가합니다. 전역변수는 편집 시가 아니라 실행 시 저장합니다. 값 비교는 고급 검증에서 편집합니다. 고급 `expect`를 직접 추가하지 않으면 중간 응답의 업무 규칙을 자동 검증하지 않고 HTTP 2xx만 확인합니다. 명시한 상태 검증은 기본값을 대체하므로 오류 응답 테스트도 가능합니다.

### 실행 중 사용자 입력

API 단계의 실행 입력 설정에서 이름·라벨·타입·필수 여부·민감 여부를 지정할 수 있습니다. 요청 본문·경로·쿼리·헤더 등에는 `{{inputs.입력 이름}}`을 사용합니다. 실행기가 해당 단계에 도달했을 때 값이 없으면 실행을 멈추고 입력 모달을 표시합니다. 제출한 값은 같은 요청과 이후 단계에서 사용할 수 있습니다.

입력 모달의 실제 값은 시나리오 YAML에 저장하지 않습니다. 실행 결과와 변수는 원문으로 반환됩니다. `sensitive: true`인 입력값은 **민감값 숨기기** 토글이 켜져 있으면 입력칸과 실행 결과의 모든 위치에서 가립니다. 실행 취소·창 종료·5분 만료 시 대기를 해제합니다. 필수값이 만료되거나 비대화형 실행에 입력 공급자가 없으면 해당 단계는 차단됩니다.

1. **시나리오 작성**을 누르면 시나리오 탭의 작성 화면으로 이동해 Swagger API 선택을 시작합니다. 선택 목록의 단계 수와 흐름 보기를 같은 화면에서 확인합니다.
2. 왼쪽 Swagger의 엔드포인트 체인 아이콘으로 API를 추가합니다. 오른쪽 선택 목록에서 동일 API를 여러 번 추가하고 드래그 또는 키보드 방향키로 순서를 바꾸거나 삭제할 수 있습니다. 선택 목록의 경로·설명을 클릭하면 왼쪽 Swagger의 해당 태그·엔드포인트를 열고 URL hash와 스크롤 위치를 갱신합니다. 선택 중 API를 실행하지 않습니다.
3. **선택 완료 · 시나리오 편집** 후에도 왼쪽 Swagger는 확인용으로 유지되고, 오른쪽에는 선택한 API만 실행 순서대로 Swagger형 아코디언으로 표시됩니다. 메서드 색상·경로·OpenAPI summary/description으로 구분하며 여러 API를 동시에 펼칠 수 있습니다. 각 API는 요청 입력과 응답 명세 구조를 위아래로 표시합니다. 값 설정은 오른쪽 단계 편집기의 요청 필드에서 전역변수, 실행 입력, 다른 단계의 요청·응답 출처를 선택해 현재 요청 항목에 연결합니다. 순서 변경·삭제 및 고급 검증은 펼친 영역에서 설정합니다. YAML에는 시나리오 이름·단계 이름·실행 설정만 저장하고 엔드포인트 설명은 저장하지 않습니다. Swagger에 입력했던 요청·인증값을 자동 복사하지 않습니다.
4. **시나리오 검사·저장**으로 현재 프로젝트에 저장합니다. 명세 검증 문제가 있으면 초안으로 저장하고 보완 항목을 표시합니다. 저장해도 실행하거나 시나리오 탭으로 이동하지 않으며 같은 패널에서 계속 수정할 수 있습니다.
5. 저장 후 **새 시나리오**로 다음 작성을 시작합니다. 미저장 변경사항이 있으면 먼저 저장해야 합니다. 여러 서버를 사용하는 경우 왼쪽 Swagger의 서버 선택에서 같은 프로젝트·환경의 다른 서버 명세를 열고 체인 아이콘으로 단계를 추가합니다. 오른쪽은 선택된 단계의 순서와 값 설정만 담당합니다.
6. 시나리오는 프로젝트 단위로 한 번만 저장하며, 상단에서 선택한 환경은 전체 API 호출에 사용할 base URL로 적용됩니다. 환경 이름 제한을 YAML에 지정하지 않으면 local·dev 등 모든 프로젝트 환경에서 재사용할 수 있습니다. 작성 중 프로젝트·서버·문서 전환은 비활성화하지만 환경 전환은 허용하고, 전환해도 작성 중인 초안은 유지합니다. 미저장 상태에서 닫기를 누르면 **계속 작성** 또는 **변경사항 버리고 닫기**를 선택합니다. 잘못된 JSON 입력도 변경사항으로 취급하며, 계속 작성하면 입력을 유지합니다. 영구 보관하려면 저장해야 합니다. 우클릭 메뉴는 아직 제공하지 않습니다.

## YAML 문법

사람이 보는 YAML, AI 작성 규칙, 저장 파일이 모두 아래 한 가지 문법을 씁니다. 화면에서 값을 연결해도 저장하면 이 형태가 됩니다.

| 하려는 것 | 문법 |
| --- | --- |
| API | `api: POST /bos/login` (명세의 메서드·경로) |
| 요청 값 | 단계 바로 아래 `body` · `query` · `pathParams` · `headers` · `cookies` |
| 앞 단계 값 | `{{steps.1.response.body./data/challengeToken}}`, 응답 헤더 `{{steps.1.response.header.X-Request-Id}}`, 앞 단계 요청값 `{{steps.1.request.body./loginId}}` (1부터 시작하는 단계 번호 + JSON Pointer, 앞선 단계만) |
| 다른 시나리오와 공유 | 저장 `extract: [{ pointer: /data/accessToken, target: globals.accessToken, sensitive: true }]`, 사용 `{{globals.accessToken}}` |
| 실행 중 입력 | 단계에 `inputs: [{ name: code, label: 인증번호, sensitive: true }]`, 사용 `{{inputs.code}}` |
| 인증 | 시나리오 또는 단계에 `auth: globals.accessToken`, 인증 없는 단계는 `auth: none` |
| 검증 | `expect: [{ source: status, operator: equals, value: 200 }]`, 본문 `{ source: body, pointer: /data/id, operator: exists }` |

- 시나리오 최상위: `id`(저장 식별자), `name`, `description`, `server`(모든 단계 공통일 때), `auth`, `onFailure`(`stop` 기본·`continue`), `steps`.
- 단계 번호는 저장 시점의 순서입니다. 편집기에서 순서를 바꿔도 연결은 유지되고, 저장하면 번호가 새 순서로 다시 매겨집니다. 출처 단계가 사용 단계보다 뒤로 가거나 삭제되면 시나리오 검사에서 알려 줍니다.
- 단계 id·내부 변수 이름은 파일에 쓰지 않습니다. 단계의 엔드포인트 설명은 명세에서 읽으므로 쓰지 않습니다.
- `extract`의 `source: body`와 `sensitive: false`는 기본값이라 생략합니다.

```yaml
id: items/read-again
name: 상품 목록에서 선택한 상품 재조회
description: 첫 응답의 상품 ID로 상세를 다시 조회합니다.
server: backend
auth: globals.accessToken
steps:
  - name: 상품 목록 조회
    api: GET /items
  - name: 선택 상품 조회
    api: 'GET /items/{id}'
    pathParams:
      id: "{{steps.1.response.body./items/0/id}}"
    expect:
      - { source: status, operator: equals, value: 200 }
```

값 전체가 참조이면 JSON 타입을 유지합니다. 문자열 안의 참조는 문자열로 조합하며 객체·배열을 문자열에 넣으면 오류입니다. 검증 연산자는 equals, exists, contains이며 암묵적 타입 변환이 없습니다. `expect`를 생략하면 HTTP 2xx만 확인하고 중간 업무 검증을 자동으로 넣지 않습니다.

**다른 표기는 받지 않습니다.** `version`, 단계 `id`, `request:` 감싸기, `api: { method, path }`·`operationId`, `vars`, `valueBindings`, 단계 `input`(단수), 최상위 `inputs`, `{{vars.…}}`를 쓰면 해당 줄을 어떻게 고칠지 알려 주는 오류가 납니다.

## AI 작성 도우미

시나리오는 사용자가 백엔드 프로젝트 폴더에서 연 AI(Claude Code, Codex 등)와 대화하며 만듭니다. Checkly는 작성 가이드를 주고, AI가 저장한 결과를 검사해 저장합니다. 앱이 AI를 직접 실행하지 않습니다.

1. 명세가 없거나, 예전 방식으로 저장돼 원본 문서가 없거나, 30일 이상 지났으면 서버별로 **명세를 다시 가져오세요** 경고가 표시됩니다. 필요하면 **AI가 쓸 API**에서 태그로 범위를 좁힙니다.
2. **AI 가이드 복사**를 누르면 현재 환경의 상세 스키마를 앱 데이터의 `ai/<프로젝트 id>/api-catalog.json`에 저장하고, 가이드를 클립보드에 복사합니다.
3. 백엔드 프로젝트 폴더에서 AI를 열고 가이드를 붙여넣습니다. AI는 먼저 무엇을 테스트할지 묻고, 답을 받으면 백엔드 코드와 스키마 파일을 읽어 작성합니다.
4. AI는 결과를 앱 데이터의 `ai/<프로젝트 id>/scenarios.yaml`에 저장(덮어쓰기)합니다. 시나리오마다 `---`로 구분하고, 2개 이상이면 마지막 문서에 `suite: { name, scenarios: [id…] }`로 실행 순서를 씁니다. 파일에 쓸 수 없으면 ```yaml 코드 블록으로 출력합니다.
5. **AI 결과 불러오기**를 누르면 그 파일을 읽어 바로 검사합니다. 대화에 출력된 경우 **AI 답을 직접 붙여넣기**에 그대로(설명 글 포함) 붙여넣거나 **YAML 파일 가져오기** 후 **검사**를 누릅니다.
6. 시나리오별 검사 결과·실행 전 설정 필요 항목·YAML이 표시됩니다. 문제가 있으면 **문제 복사**로 AI에 붙여넣고, AI가 다시 저장하면 다시 불러옵니다.
7. **선택한 것 저장**을 누르면 검사를 통과한 시나리오는 일반 시나리오로, 문제가 남은 시나리오는 초안으로 저장합니다. 스위트가 있으면 저장이 기본으로 켜져 있으며, 스위트에는 통과한 시나리오만 순서대로 넣습니다. 저장 후 시나리오 탭으로 이동해 실행합니다.

가이드 내용: 진행 순서(먼저 질문), 결과 파일·API 파일 경로, 작성 규칙, 서버 이름, 전역변수 이름·타입, 기존 시나리오 id·이름. API 목록과 스키마는 API 파일에만 넣습니다(요청·응답 필드는 백엔드 코드를 먼저 보도록 안내). 서버 URL·전역변수 값·실행 이력·명세 example/default/enum은 가이드와 스키마 파일 모두에 넣지 않으며, 6자 이상 문자열 전역변수 값이 설명에 있으면 `***`로 바꿉니다. 프로젝트를 삭제하면 이 폴더도 지웁니다.

## 두 서버의 6단계 실행 예제

회원 문의 생성 후 관리자가 답변하고 회원이 조회합니다. 2단계의 inquiryId를 5·6단계에서 재사용합니다. 아래 가상 API 예제는 실행 코어 테스트에서도 읽어 검증합니다.

```yaml
id: inquiry/create-and-answer
name: 회원 문의 등록부터 관리자 답변 확인
description: |
  회원이 문의를 등록하고 관리자가 답변한 뒤,
  회원이 조회한 문의에 작성한 답변이 표시되는지 검증합니다.
steps:
  - name: 회원 로그인
    server: member
    api: POST /auth/login
    inputs:
      - { name: memberLoginId, label: 회원 아이디, sensitive: false }
      - { name: memberPassword, label: 회원 비밀번호 }
    body:
      loginId: "{{inputs.memberLoginId}}"
      password: "{{inputs.memberPassword}}"
    expect:
      - { source: status, operator: equals, value: 200 }
    extract:
      - { pointer: /accessToken, target: globals.memberAccessToken, sensitive: true }

  - name: 회원 문의 등록
    server: member
    api: POST /inquiries
    auth: globals.memberAccessToken
    body: { title: 테스트 문의, content: 배송 일정 문의 }
    expect:
      - { source: status, operator: equals, value: 201 }

  - name: 관리자 로그인
    server: admin
    api: POST /auth/login
    inputs:
      - { name: adminLoginId, label: 관리자 아이디, sensitive: false }
      - { name: adminPassword, label: 관리자 비밀번호 }
    body:
      loginId: "{{inputs.adminLoginId}}"
      password: "{{inputs.adminPassword}}"
    expect:
      - { source: status, operator: equals, value: 200 }
    extract:
      - { pointer: /accessToken, target: globals.adminAccessToken, sensitive: true }

  - name: 관리자 문의 목록 조회
    server: admin
    api: GET /inquiries
    auth: globals.adminAccessToken
    expect:
      - { source: status, operator: equals, value: 200 }

  - name: 관리자 답변 등록
    server: admin
    api: 'POST /inquiries/{id}/answers'
    auth: globals.adminAccessToken
    pathParams: { id: "{{steps.2.response.body./id}}" }
    body: { content: 테스트 답변입니다 }
    expect:
      - { source: status, operator: equals, value: 201 }

  - name: 회원 문의 답변 확인
    server: member
    api: 'GET /inquiries/{id}'
    auth: globals.memberAccessToken
    pathParams: { id: "{{steps.2.response.body./id}}" }
    expect:
      - { source: status, operator: equals, value: 200 }
      - { source: body, pointer: /answer/content, operator: equals, value: 테스트 답변입니다 }
```
