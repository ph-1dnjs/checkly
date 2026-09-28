# [사용자 흐름] API 테스트

## 프로젝트와 명세

1. 하단 API 테스트 메뉴에서 프로젝트를 만들고 서버·환경별 기본 URL을 저장합니다. 프로젝트 설정은 서버 목록과 환경×서버 주소 표로 편집하며, 변경 중에 나가면 확인합니다.
2. API 문서 탭의 명세 영역에서 OpenAPI JSON/YAML URL을 가져오거나 파일을 가져옵니다. 명세는 서버·환경마다 따로 저장됩니다.
3. 문서 인증이 필요하면 Basic 아이디·비밀번호를 입력합니다. 앱에서 계정 기억을 선택할 수 있습니다(보안 저장소 안내는 체크박스 툴팁). `http://` 주소로 비밀번호를 보낼 때만 경고합니다.
4. 가져온 뒤에는 명세 영역이 `명세 · 서버·환경 · URL · 인증 · 최근 동기화 [새로고침] [설정]` 한 줄로 접힙니다. 동기화는 사용자가 누를 때만 하며, 실패하면 마지막 정상 문서를 유지하고 `다시 시도`를 보여줍니다.
5. 동기화 뒤(또는 API 문서 탭을 열 때) 저장된 시나리오를 대조합니다. 명세에서 사라진 API를 쓰는 단계는 경고로, 이전 제목을 이름으로 쓰는 단계는 `새 제목으로 바꾸기` 안내로 보여줍니다(시나리오별로 `이대로 두기` 가능). 시나리오 이름을 누르면 수정 화면이 열립니다.
6. 명세 삭제는 설정 폼 안의 작은 위험 버튼이며 선택한 서버·환경에 적용됩니다.

문서 다운로드 URL과 실제 API 기본 URL은 독립적입니다. URL을 고쳐도 인증 방식과 아이디는 유지하며, 저장된 계정은 URL이 같을 때만 씁니다. 비밀번호는 가져오기 후 비웁니다.

## 개별 요청

1. 태그나 검색으로 API를 찾고 펼칩니다.
2. Authorize에서 기존 문자열 전역변수를 Bearer 토큰으로 연결하거나, 새 토큰을 지정 이름(기본 `docsToken`, 같은 이름이면 덮어씀)의 전역변수로 저장해 연결합니다.
3. 요청 파라미터·JSON 본문을 편집하고 Execute 또는 Dock의 API 실행을 누릅니다.
4. HTTP 상태·소요 시간·헤더·응답을 확인합니다.

Authorize의 연결은 API 문서의 개별 호출에만 적용됩니다. 시나리오는 편집 화면의 기본 인증·단계 인증(`auth: globals.이름`)을 따릅니다. 같은 전역변수를 고르면 문서 호출과 시나리오가 같은 토큰을 씁니다. 인증 해제는 연결만 해제하며 변수 삭제는 전역변수에서 수행합니다.

일반 설명의 details/summary는 접고 펼칠 수 있습니다. Mermaid 설명은 버튼으로 전체 화면 모달을 열어 확대·축소·스크롤합니다. 모달을 열면 배경 페이지 스크롤을 잠급니다.

## 시나리오 작성·검토·실행

탭은 URL의 `tab=api|scenarios|scenario-editor|ai`로 구분합니다. `project`·`server`·`environment` 식별자도 포함하며 새로고침과 뒤로/앞으로 이동 시 복원합니다. 없는 식별자는 기본 항목으로 대체합니다. Swagger 태그·엔드포인트의 해시는 유지합니다. 작성·실행 중에는 URL 이력 이동으로 탭을 전환하지 않고 안내합니다. URL은 설정·명세·계정 데이터를 공유하지 않으며 동일한 로컬 데이터가 있어야 같은 항목이 열립니다.

1. 시나리오 탭 사이드바의 **+ 새 시나리오**로 작성 화면을 엽니다. 작성 중에는 탭·프로젝트·서버 영역을 숨기고, 툴바 한 줄(`← 목록 | 제목·상태 | ① API 선택 › ② 값 설정 | 환경·민감값·전역변수`)만 둡니다. 저장 후에는 상태 줄의 **+ 이어서 새 시나리오**로 다음 시나리오를 만듭니다. YAML 가져오기는 AI 작성 도우미의 **YAML 직접 붙여넣기·파일 가져오기**에서 합니다.
2. **① API 선택**: 왼쪽 Swagger에서 엔드포인트의 `+`로 오른쪽 목록에 추가하고, 행 전체를 드래그하거나 손잡이에서 ↑/↓로 순서를 정합니다. 목록 행을 누르면 Swagger의 해당 위치를 엽니다. 이 단계의 Swagger는 보기·추가 전용이라 Try it out·Execute가 없습니다.
3. **② 값 설정**: 이름(필수)·그룹·설명·기본 인증 다음에 단계 카드가 있습니다. 카드 윗줄은 `API 설명` 토글과 `API 바꾸기`·`단계 제거`, 그 아래 단계 인증·요청·응답·검증입니다. 다른 단계의 요청값·응답 본문·응답 헤더를 값으로 연결하면 YAML에는 `{{steps.N.…}}`으로 저장합니다. 왼쪽 설정 요약은 설정한 값만 프리티 JSON으로 보여주고, 누르면 해당 필드로 이동합니다.
4. **시나리오 검사·저장**에서 API 존재 여부, 필수 요청값, 참조 순서를 확인합니다. 정상 시나리오는 저장하고, 미완료이면 초안으로 저장합니다(상태 `초안 저장됨`). **저장 후 실행**은 문제가 없을 때만 저장하고 실행합니다.
5. 시나리오 상세에서 실행 입력을 넣고 실행합니다. 결과는 **최근 실행**(요청 `METHOD URL`, 응답 `HTTP 상태 · 시간`, 검증별 ✓/✗), 호출 순서는 **실행 흐름**에서 확인합니다. 하단 **YAML 보기**에서 간단한 형태를 보고 복사합니다(읽기 전용).
6. 상세의 **수정**·**복제**(`사본`, 겹치면 `사본 2`…)·**시나리오 삭제**. 명세에 없는 API를 쓰는 시나리오는 목록에 주황 점이 붙습니다.

주석과 YAML 서식은 저장 시 재생성합니다. 중첩 필드·배열·본문 전체는 요청 본문 JSON 편집에서 입력합니다.

각 단계의 값 설정 메뉴에서 **전역변수** 또는 **시나리오 값**을 선택합니다. 시나리오 값은 다른 단계의 요청 영역(`pathParams`, `query`, `headers`, `cookies`, `body`)과 응답 본문·헤더를 출처로 사용할 수 있습니다. 요청값은 실제로 저장된 요청 JSON, 응답 본문은 명세 구조의 JSON Pointer, 응답 헤더는 헤더 이름으로 지정합니다. 실제 값은 실행 중에만 전달하며 메뉴는 원문을 미리 노출하지 않습니다. 적용은 요청 필드에 `{{vars.name}}`를 넣고 `valueBindings`를 기록합니다. 현재 단계와의 순서가 맞는지는 시나리오 검사에서 확인합니다.

### API 문서에서 바로 작성

선택한 API 목록은 드래그(행 전체, 놓을 자리가 점선으로 미리 보임) 또는 ↑/↓로 순서를 바꾸고 `✕`로 제거합니다. 좁은 화면에서는 목록이 위에 표시됩니다. 같은 API를 여러 번 넣을 수 있습니다. 여러 서버를 쓰면 1단계 Swagger 위의 서버 선택에서 같은 프로젝트·환경의 다른 서버 명세를 엽니다.

단계 화면은 명세의 요청 항목을 필드별로 보여주고, 각 필드의 `값 연결`에서 직접 입력·이전 단계 값·전역변수·실행 중 사용자 입력을 고릅니다. 엔드포인트 summary·description·파라미터 설명·응답 구조는 명세에서 읽어 표시합니다. 단계 이름은 API를 추가할 때의 명세 제목을 저장하며, 명세 제목이 바뀌면 동기화 후 일괄 반영할 수 있습니다. 응답 선택기는 실제 실행 결과가 아닌 명세 구조이며 배열은 원소를 임의로 만들지 않고 배열 필드만 표시합니다.

응답 필드를 선택해 검증(존재하는지·기대값과 같은지·포함하는지) 또는 전역변수 저장을 추가합니다. 같은 필드를 다시 고르면 기존 검증을 수정·제거합니다. 기대값은 평문으로 넣고 숫자·true/false·JSON은 그 타입으로 비교합니다(문자열 "200"은 따옴표). 검증이 없으면 HTTP 2xx만 자동 확인하므로, 상태 검증(`+ HTTP 상태 검증`, 기본값 없이 빈 칸)은 201·404처럼 특정 코드를 기대할 때만 넣습니다. 상태 검증을 넣으면 그 단계의 2xx 자동 확인은 꺼집니다. 실행하면 한 단계의 검증을 모두 확인해 각각의 통과 여부를 보여줍니다.

경로가 바뀌어 API를 찾지 못하는 단계는 `API 바꾸기`로 새 API를 연결합니다. 요청값·연결·검증은 그대로 두고, 새 API에 없는 요청 값은 목록으로 보여줘 개별 제거할 수 있습니다.

### 실행 중 사용자 입력

API 단계의 실행 입력 설정에서 이름·라벨·타입·필수 여부·민감 여부를 지정할 수 있습니다. 요청 본문·경로·쿼리·헤더 등에는 `{{inputs.입력 이름}}`을 사용합니다. 실행기가 해당 단계에 도달했을 때 값이 없으면 실행을 멈추고 입력 모달을 표시합니다. 제출한 값은 같은 요청과 이후 단계에서 사용할 수 있습니다.

입력 모달의 실제 값은 시나리오 YAML에 저장하지 않습니다. 실행 결과와 변수는 원문으로 반환됩니다. `sensitive: true`인 입력값은 **민감값 숨기기** 토글이 켜져 있으면 입력칸과 실행 결과의 모든 위치에서 가립니다. 실행 취소·창 종료·5분 만료 시 대기를 해제합니다. 필수값이 만료되거나 비대화형 실행에 입력 공급자가 없으면 해당 단계는 차단됩니다.

시나리오는 프로젝트 단위로 저장하며, 작성 툴바에서 고른 환경의 기본 주소로 모든 API를 호출합니다. YAML에 환경 제한이 없으면 모든 환경에서 재사용할 수 있습니다. 작성 중 프로젝트·서버·탭 전환은 막고 환경 전환은 허용하며, 작성 중인 초안은 유지됩니다. 미저장 상태에서 닫으면 **계속 작성** 또는 **변경사항 버리고 닫기**를 고릅니다.

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
| 검증 | 본문 `expect: [{ source: body, pointer: /data/status, operator: equals, value: ACTIVE }]`, 특정 상태 코드 `{ source: status, operator: equals, value: 201 }` (없으면 2xx 자동 확인) |

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

1. 명세가 없거나, 예전 방식으로 저장돼 원본 문서가 없거나, 30일 이상 지났으면 서버별로 **명세를 다시 가져오세요** 경고가 표시됩니다. 필요하면 **AI가 쓸 API**에서 범위를 좁힙니다. Swagger처럼 태그별로 접히는 목록이며, 태그·경로·제목으로 검색하고 태그 전체 또는 엔드포인트 단위로 고릅니다. 실행을 지원하지 않는 API(비 JSON 본문)는 흐리게 표시되고 고를 수 없습니다.
2. **가이드 보기**로 가이드 내용을 앱에서 확인할 수 있습니다. **AI 가이드 복사**를 누르면 현재 환경의 상세 스키마를 앱 데이터의 `ai/<프로젝트 id>/api-catalog.json`에 저장하고, 가이드를 클립보드에 복사합니다.
3. 백엔드 프로젝트 폴더에서 AI를 열고 가이드를 붙여넣습니다. AI는 먼저 무엇을 테스트할지 묻고, 답을 받으면 백엔드 코드와 스키마 파일을 읽어 작성합니다.
4. AI는 결과를 앱 데이터의 `ai/<프로젝트 id>/scenarios.yaml`에 저장(덮어쓰기)합니다. 시나리오마다 `---`로 구분하고, 2개 이상이면 마지막 문서에 `suite: { name, scenarios: [시나리오 이름…] }`로 실행 순서를 씁니다. AI는 시나리오 id를 쓰지 않으며, Checkly가 검사할 때 화면에서 만든 것과 같은 `scenario-<uuid>`를 붙입니다(id를 직접 쓴 YAML도 받습니다). 파일에 쓸 수 없으면 ```yaml 코드 블록으로 출력합니다.
5. **AI 결과 불러오기**를 누르면 그 파일을 읽어 바로 검사합니다. 대화에 출력된 경우 **YAML 직접 붙여넣기·파일 가져오기**에 그대로(설명 글 포함) 붙여넣거나 **YAML 파일 가져오기** 후 **검사**를 누릅니다.
6. 시나리오별 검사 결과·실행 전 설정 필요 항목·YAML이 표시됩니다. 문제가 있으면 **문제 복사**로 AI에 붙여넣고, AI가 다시 저장하면 다시 불러옵니다.
7. **선택한 것 저장**을 누르면 검사를 통과한 시나리오는 일반 시나리오로, 문제가 남은 시나리오는 초안으로 저장합니다. 스위트가 있으면 저장이 기본으로 켜져 있으며, 스위트에는 통과한 시나리오만 순서대로 넣습니다. 저장 후 시나리오 탭으로 이동해 실행합니다.

가이드 내용: 진행 순서(먼저 질문), 결과 파일·API 파일 경로, 작성 규칙(검증은 사용자가 원한 확인만, 습관성 `status 200`·`/data` 존재 검증 금지), 서버 이름, 전역변수(이름·타입과 만드는 시나리오·쓰는 시나리오), 기존 그룹, 기존 시나리오 이름·그룹. AI는 시나리오와 스위트마다 `group: 회원/인증`을 쓸 수 있고(기존 그룹 우선, 필요하면 새 그룹), Checkly는 이 줄을 시나리오 본문에서 빼서 저장 위치(폴더)로 씁니다. 폴더 규칙에 맞지 않는 그룹은 문제로 표시합니다. API 목록과 스키마는 API 파일에만 넣습니다(요청·응답 필드는 백엔드 코드를 먼저 보도록 안내). 서버 URL·전역변수 값·실행 이력·명세 example/default/enum은 가이드와 스키마 파일 모두에 넣지 않으며, 6자 이상 문자열 전역변수 값이 설명에 있으면 `***`로 바꿉니다. 프로젝트를 삭제하면 이 폴더도 지웁니다.

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
