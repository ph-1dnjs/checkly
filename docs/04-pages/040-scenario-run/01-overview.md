# 기능·실행 정책

> **범위**: 실행 단위, 액션별 처리, 브라우저 공유, 미리보기. 문법은 [편집 개요](../020-scenario-editor/01-overview.md)를 참조합니다.

## 실행 단위와 세션

`beginRuns(scenarios, background = false)`는 전달된 배열 순서대로 실행합니다. 빈 배열이면 안내 모달을 표시하고 시작하지 않습니다. URL 유효성·단계 개수까지 검사하지는 않습니다. 기본 경로는 실행 화면으로 이동하며, 시작 후 다른 화면으로 이동해도 App 훅의 실행은 유지됩니다.

실행마다 sequence를 증가시키고 문자열 workerId로 전달합니다. 같은 workerId의 시나리오는 하나의 headless Chromium과 BrowserContext를 공유하고 각각 새 Page를 생성합니다. 따라서 같은 origin의 쿠키/localStorage 등 컨텍스트 세션 상태가 다음 시나리오에 영향을 줄 수 있습니다. 편집기 WebView의 세션을 실행 컨텍스트로 가져오는 코드는 없습니다.

- 시나리오 하나가 failed여도 다음 시나리오를 계속 실행합니다. cancelled이면 큐를 중단합니다.
- 취소되지 않은 묶음은 하나라도 실패하면 failed, 아니면 passed로 최근 기록에 추가합니다.
- worker ID가 바뀌면 기존 컨텍스트를 닫습니다. 큐 종료 시 `qa:finish-worker`로 컨텍스트·브라우저를 닫습니다.
- main의 activeRun/scenarioWorker는 전역 단일 객체입니다. 독립 실행 큐의 병렬 처리를 보장하지 않습니다. 실행 설정의 WebKit/Firefox 및 workers 2/4 버튼에는 변경 callback이 없어 표시 전용이며 실제 실행은 Chromium·순차 처리입니다.

## 브라우저와 화면 크기

| 항목 | 설정 |
| --- | --- |
| Chromium | headless, launch timeout 15초; 패키지에서는 app.asar.unpacked의 실행 파일 |
| 실행 viewport | main 초기값 2560×1440; `qa:set-viewport`로 변경 |
| viewport 검증 | 반올림 후 유한한 수이고 가로·세로 모두 200 이상; 잘못된 값은 무시 |
| 적용 범위 | 현재 활성 Page와 이후 새 Page·팝업. 선택값은 main 메모리에 유지 |
| 녹화 | BrowserContext에서 1280×720 고정; viewport와 다른 설정 |
| 기본 Page timeout | 액션 10초, navigation 15초 |
| 접속 완료 기준 | 기본 URL 및 goto의 `domcontentloaded` |

실행 화면의 크기 프리셋은 실제 viewport를 요청합니다. 직접 제어 중에는 프리셋 변경을 막고 캡처 이미지의 실제 크기를 사용합니다. fit·확대/축소는 미리보기 표시 배율이며 녹화 해상도를 바꾸지 않습니다. RunPage 재진입 시 페이지 로컬 프리셋은 초기화될 수 있습니다.

팝업이 생기면 `run.page`가 바뀌어 미리보기·직접 제어·viewport 변경은 팝업을 대상으로 합니다. 반면 자동 액션·조건 검사는 계속 원래 `page`를 사용합니다. 팝업이 닫히면 활성 제어 Page가 원래 Page로 돌아갑니다.

## 자동 단계와 대상 탐색

각 단계 전에 condition 텍스트가 보이는지 기본 1초, waitSeconds가 있으면 해당 시간 동안 확인합니다. 미충족이면 건너뜀 로그·단계 캡처·진행 이벤트를 남기고 다음 단계로 갑니다. skip은 실패로 계산하지 않습니다.

| 액션 | 현재 실행 방식 | 대기·실패 정책 |
| --- | --- | --- |
| goto | http(s) 또는 `/`로 시작하는 target을 기본 URL과 결합. 나머지는 `/`로 대체 | domcontentloaded, navigation timeout |
| fill | input 클릭 → 전체 선택 → Backspace → type → blur | 입력 후 waitSeconds가 있으면 추가 대기 |
| fileUpload | input locator에 setInputFiles(value) | 빈 경로는 명시 오류, 없는 파일/잘못된 대상은 실행 실패 |
| click | 보이는 n번째 대상 선택 후 click | 탐색·click에 waitSeconds 또는 10초; click 실패 시 force click 1회 |
| select | native select면 label 선택 후 실패 시 value 선택; custom이면 대상과 값 각각 클릭 | custom 탐색·클릭에 waitSeconds 또는 10초 |
| expectText | 정규식 특수문자 escape 후 대소문자 무시 부분 일치, visible 후보 확인 | 100ms 간격, waitSeconds 또는 10초 후 실패 |

입력 대상은 `css=`이면 CSS의 `[value=...]` 조건을 제거한 첫 요소입니다. 그 외는 `필드`/`입력란` 접미사를 정리한 label·placeholder·input/textarea name 부분 일치의 결합 locator에서 첫 요소를 사용합니다. select도 CSS 또는 label/select name을 사용합니다.

클릭은 CSS이면 main page의 보이는 요소 중 순번을 사용합니다. 텍스트이면 모든 frame의 button·label·text 후보를 모아 클릭 컨테이너 중복을 제거하고 frame 순서와 DOM 순서로 정렬합니다. label은 공백·제로폭 공백을 제거해 비교합니다. 화면 좌표순 정렬은 아닙니다. occurrence는 기본 1입니다. iframe 탐색 지원은 텍스트 클릭 경로이며 입력·선택·결과 확인 전체에 적용되는 기능은 아닙니다.

`resultTargetFor`가 “결과 확인”·“클릭” 접미사를 제거한 결과가 click target과 다르면 실제 클릭 대신 텍스트 확인을 수행합니다. 이 호환 경로는 기본 10초를 사용합니다.

> **대기 의미**: waitSeconds는 전역 단계 timeout이 아닙니다. 조건 확인과 액션에서 각각 소비할 수 있고, 클릭 fallback이나 select label/value 재시도로 전체 소요 시간이 더 길어질 수 있습니다. 마커 직렬화는 click/expectText의 대기만 보존합니다.

## 수동 단계

| 액션 | 요청·완료 | 시간·저장 정책 |
| --- | --- | --- |
| manualFill | 단계 캡처 후 값 요청 → 제출값을 locator.fill로 입력 | 별도 대기 timeout 없음. 제출 문자열을 명시적으로 로그에 추가하지 않음 |
| manualControl | 단계 캡처·직접 제어 요청 → continue/failed | 최대 300초, 시간 초과는 failed와 사유. 클릭·wheel·key·text를 활성 Page에 전달 |
| manualResult | 단계 캡처·전역 판정 모달 → passed/failed | 최대 300초, 실패 사유는 로그·리포트에 포함 |

수동 제어 이벤트와 응답은 실행 ID·단계 ID를 전송하지 않고 현재 activeRun에 전달합니다. main의 브라우저 이벤트 함수는 수동 단계 대기 여부까지 확인하지 않으므로, 수동 제어 UI 노출 조건이 유일한 단계별 제한입니다.

실패 사유는 UI에서 비어 있으면 실패 버튼이 비활성입니다. main은 사유가 비어도 기본 문구로 failed 처리합니다. manualFill의 required는 요청 정보이며 main에서 빈 값 제출을 거부하지 않습니다.

직접 제어의 클릭 좌표는 표시 이미지의 위치를 naturalWidth/naturalHeight 기준으로 변환합니다. 문자 키는 insertText, 제어 키는 keyboard.press, 붙여넣기는 text 이벤트로 전달합니다. 별도 Chromium 창을 띄우는 방식이 아닙니다.

## 캡처·진행·결과 UI

livePreview 옵션이 켜져 있거나 manualControl 단계가 있으면 JPEG quality 60 미리보기를 200ms 간격으로 시도하며 캡처 중복을 막습니다. 단계 완료·skip·수동 대기 전에는 quality 80 단계 이미지를 전송합니다. 예외 발생 시에도 가능한 경우 실패 이미지를 전송합니다. 캡처 실패는 실행을 중단하지 않습니다.

단계 이미지는 `scenarioId:stepId` 키로 메모리에 저장하고 같은 키의 최신 이미지가 이전 이미지를 대체합니다. 직접 제어 중에는 실시간 이미지를 우선하고, 그 외에는 선택한 단계 캡처 또는 최신 미리보기를 표시합니다. 로그 ALL/ERR 필터(ERR는 `실패`를 포함한 문자열만 선택), 시나리오별 결과와 영상 다운로드를 제공합니다.

진행률은 완료·skip 이벤트의 current/total입니다. 실패 단계 인덱스는 renderer가 마지막 progress.current로 추정하므로 접속·브라우저 준비 실패도 첫 단계 실패처럼 보일 수 있습니다. 소요 시간은 시나리오마다 초기화됩니다.

## 인증·외부 데이터 변경

로그인 만료·로그인 화면 리다이렉트를 감지해 재인증하는 공통 로직은 없습니다. 로그인 상태가 필요한 경우 시나리오 단계나 수동 제어로 준비해야 하며, 실제 성공 여부는 후속 액션/expectText/manualResult로 확인합니다. 페이지 접속 완료만으로 인증 성공이나 업무 결과를 판정하지 않습니다.

취소·실패는 남은 실행과 브라우저 자원을 중단하는 동작입니다. 이미 대상 사이트에서 처리한 저장·제출·업로드를 되돌리는 트랜잭션이나 테스트 데이터 정리 로직은 없습니다.
