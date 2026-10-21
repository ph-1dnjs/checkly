# 기능·문법·편집 정책

> **범위**: 텍스트 편집, 화면에서 추출, 복제와 실행 스냅샷. 코드 연결은 [인덱스](README.md)를 봅니다.

## 초기 상태와 텍스트 편집

초기 원문은 빈 문자열, 현재 시나리오는 `emptyScenario`입니다. 앱 시작 때 기본 원문과 좌표를 읽으며, 원문이 있으면 파싱한 첫 시나리오를 현재 대상으로 선택합니다. seed URL이나 예제 시나리오를 자동 삽입하지 않습니다.

textarea 변경마다 `updateSource`가 원문과 미리보기를 갱신하고 첫 시나리오를 선택합니다. 파싱 결과가 없으면 원문은 비지만 기존 현재 시나리오 객체는 남을 수 있습니다. 헤더의 `저장 안 됨` 표시는 `sourceMarkdown !== savedMarkdown`일 때만 표시하므로 아직 원문에 반영하지 않은 마커 편집을 모두 감지하지 않습니다.

미리보기는 시나리오 수·단계 수·웹 엔드포인트 이름·액션을 표시하고 각 블록을 접거나 펼칩니다. 원문 미리보기는 파서가 만든 connected 값(expectText=false, 나머지=true)을 사용하며 inspect 결과를 반영하지 않습니다. `connected` 표시는 실제 실행 성공을 보증하지 않습니다.

## Markdown 계약

```markdown
# 시나리오: 주문 조회
endpoint: 2f1c3c9e-6a55-4d8f-9d6a-1b2c3d4e5f60
tag: regression

Given `/orders` 페이지로 이동한다
And `이메일`에 `qa@example.com` 입력
And 화면에 `안내`가 있는 경우 `닫기` 클릭 [대기 3초]
Then `주문 목록` 텍스트가 보인다 [대기 10초]
```

| 항목 | 현재 해석 |
| --- | --- |
| 블록 경계 | 줄 시작의 `#`~`### 시나리오:` 또는 `Scenario:`; 공백뿐인 블록 제외 |
| 제목 | 한국어 제목 패턴에서 추출. 영문 `Scenario:`는 분리되지만 제목은 `시나리오 N`으로 대체 |
| 엔드포인트/태그 | 소문자 `endpoint:`(설정의 웹 엔드포인트 ID), `tag:`에서 추출. 누락은 undefined이며 엔드포인트 누락은 첫 웹 엔드포인트로 해석. 이전 문서의 `url:`은 저장 시 이동 단계로 바뀜 |
| 단계 | Given/When/Then/And/But/If로 시작하는 줄만 인식, 접두사 대소문자 무시 |
| ID | 시나리오는 블록 순서의 `scenario-0`부터, 단계는 문자열 `"1"`부터 재생성 |
| 조건 | `` 화면에 `텍스트`가 있는 경우 ``는 보이는 텍스트 조건. 빈 조건은 실행 시 조건 없음 |
| 대기 | 줄 끝 `[대기 N초]`에서 정수 추출. 액션별 의미·보존 차이는 아래 표와 실행 문서 참조 |
| 클릭 순번 | `[N번째] 클릭`; 2 이상만 occurrence에 보존 |
| 알 수 없는 단계 | 단계 접두사가 있으면 마지막 fallback으로 click 처리. 엄격한 문법 검증기가 아님 |

비어 있지 않은 임의 블록도 시나리오가 될 수 있습니다. `Given`과 `Then`은 실행 순서를 따로 정하지 않으며 배열의 순서대로 실행합니다.

| 액션 | 표준 단계 본문 | 주요 필드 |
| --- | --- | --- |
| goto | `` `/login` 페이지로 이동한다 `` | target |
| fill | `` `이메일`에 `값` 입력 `` | target, value, waitSeconds |
| fileUpload | `` `첨부`에 `/path/file.pdf` 파일 업로드 `` | target, value |
| manualFill | `` `인증번호` 수동 입력 [안내] `` | target, prompt, required |
| manualControl | `` `결제` 브라우저 직접 제어 [안내] `` | target, prompt |
| manualResult | `` `결과` 수동 결과 확인 [안내] `` | target, prompt |
| click | `` `삭제` [2번째] 클릭 [대기 5초] `` | target, occurrence, waitSeconds |
| select | `` `상태`에서 `완료` 선택 `` | target, value, waitSeconds |
| expectText | `` `저장 완료` 텍스트가 보인다 [대기 10초] `` | target, waitSeconds |

파서 판별 순서는 manualResult → manualControl → 결과 텍스트 → manualFill → fileUpload → fill → select → goto → click입니다. 값 안에 판별 키워드가 포함되면 의도와 다르게 해석될 수 있으므로 미리보기를 확인합니다.

## 화면에서 추출

- 상단 주소줄에서 웹 엔드포인트를 고르고, WebView 뒤로/앞으로/새로고침, 모바일 390px·태블릿 834px·데스크톱 100% 폭을 선택합니다. 이 폭은 실행 viewport 설정과 별개입니다. 왼쪽 위 **편집 대상**에서 마커를 찍을 시나리오 블록을 고릅니다.
- 왼쪽 아래 **마커 추가**(선택 중에는 다시 누르거나 Esc로 취소) 후 캔버스를 클릭하면 상대 좌표(%, 소수 첫째 자리)를 계산하고 `elementFromPoint`로 target을 추출합니다.
- 가장 가까운 label/button/link/input/select/textarea 또는 라벨 속성 요소를 선택합니다. select만 자동으로 select 액션이 되고 나머지는 click이므로 입력·업로드 액션은 마커 편집 폼에서 바꿉니다.
- 대상은 select 라벨, checkbox/radio 라벨의 data 속성, 텍스트, data-label/aria-label, CSS 속성·id·class 순으로 추출합니다. 추출 실패 시 직접 입력합니다.
- 마커 행을 누르면 그 행 아래에 편집 폼이 펼쳐지고(새 마커는 목록 끝에 `NEW MARKER`로 펼쳐짐) 액션, 라벨, 실행 조건(Y/N), 입력/선택값, 업로드 경로, 수동 안내를 편집합니다. 마커 핀 색은 연결됨(파랑)·미연결(노랑)을 나타냅니다. click/expectText는 대기(기본 10초), click은 순번(기본 1)을 편집합니다.
- 완료는 `target.trim()`이 비어 있지 않아야 합니다. URL·조건·파일 존재 여부 등 전체 실행 유효성을 검사하지는 않습니다.
- 단계 삭제·마지막 삭제·전체 초기화·pointer drag 재정렬 후 ID를 1부터 다시 부여합니다. pin은 저장된 좌표가 있는 단계에 표시합니다. 별도 브라우저의 대상 연결 검사 결과는 목록의 연결 상태에만 반영하고 저장된 pin을 숨기지 않습니다. 좌표가 없는 단계는 목록에만 표시하며 임의의 기본 위치에 pin을 만들지 않습니다.

`qa:inspect`는 편집기 마커 모드 진입 시 별도 headless 브라우저로 기본 URL만 검사합니다. WebView의 로그인·탐색 상태를 넘기거나 이전 단계를 재현하지 않습니다. goto/manualControl/manualResult는 항상 연결됨으로 반환하고, 일반 입력/결과 대상은 주로 locator 개수로 검사하므로 가시성·입력 가능성을 보증하지 않습니다. select 검사는 실행의 selectFor가 아닌 heading/text 경로를 사용합니다. 같은 마커 모드 안에서 시나리오·URL을 변경하는 것만으로 검사 effect가 재실행되지는 않습니다.

## 템플릿 복제 정책

미리보기의 복제 버튼에서 이름과 케이스별 값을 입력합니다. 케이스는 최소 1개이고 추가·삭제할 수 있습니다. 취소·배경 클릭은 닫기만 하며 재진입하면 입력 상태가 초기화됩니다.

- fill/select/fileUpload/manualFill은 입력(value), expectText/manualResult는 확인(target)을 변경합니다. 나머지 단계는 유지합니다.
- 변경값은 trim 후 비어 있으면 원본 값을 사용합니다. 따라서 원본의 비어 있지 않은 값을 빈 문자열로 바꾸는 용도로는 쓸 수 없습니다.
- 이름은 비어 있으면 `원본 제목 복제`; 중복이면 `이름 2`, `이름 3`처럼 사용하지 않는 번호를 붙입니다. 이름 템플릿 변수 치환은 없습니다.
- 원본 URL·태그·단계 순서는 유지하고 복제 블록을 원문 끝에 추가합니다. DB 저장은 별도입니다.
- manualFill의 value를 바꾸는 UI는 있으나 직렬화가 value를 출력하지 않아 복제 후 입력값으로 유지되지 않습니다. 마커 좌표도 복제 블록에 포함하지 않습니다.

## 직렬화·실행 정책

`scenarioToMarkdown`은 제목·URL·태그와 표준 단계 문법을 출력합니다. 첫 단계는 Given, 이후 expectText는 Then, 나머지는 And입니다. 원래 접두사·주석·서식은 보존하지 않습니다. waitSeconds는 click/expectText만 출력하므로 fill/select의 대기는 마커 저장·복제 때 소실될 수 있습니다.

편집기의 **바로 실행**은 `commitEditorRunSnapshot`으로 현재 마커 변경을 원문에 반영한 후 전체 시나리오 배열을 실행 화면에 전달합니다. 현재 편집 시나리오는 ID가 일치하면 직렬화 후 재파싱한 객체 대신 원래 마커 객체를 실행에 사용합니다. 따라서 이번 실행에서는 유지된 fill/select 대기 등이 이후 원문 재파싱·재시작 후에는 소실될 수 있습니다. 이는 메모리 반영이며 DB 저장이나 savedMarkdown 갱신이 아닙니다. 하단 실행 버튼의 전달 규칙은 [사용자 흐름](02-userflow.md)을 봅니다.
