# 기능·실행 정책

> **범위**: 실행 단위, 액션별 처리, 브라우저 공유, 미리보기. 문법은 [편집 개요](../020-scenario-editor/01-overview.md)를 참조합니다.

## 실행 단위와 세션

`beginRuns(scenarios, background = false)`는 전달된 배열 순서대로 실행합니다. 빈 배열이면 안내 모달을 표시하고 시작하지 않습니다. URL 유효성·단계 개수까지 검사하지는 않습니다. 기본 경로는 실행 화면으로 이동하며, 시작 후 다른 화면으로 이동해도 App 훅의 실행은 유지됩니다.

실행마다 sequence를 증가시키고 문자열 workerId로 전달합니다. 같은 workerId의 시나리오는 하나의 headless Chromium과 BrowserContext를 공유하고 각각 새 Page를 생성합니다. 따라서 같은 origin의 쿠키/localStorage 등 컨텍스트 세션 상태가 다음 시나리오에 영향을 줄 수 있습니다. 편집기 WebView의 세션을 실행 컨텍스트로 가져오는 코드는 없습니다.

- 시나리오 하나가 failed여도 다음 시나리오를 계속 실행합니다. cancelled이면 큐를 중단합니다.
- 취소되지 않은 묶음은 하나라도 실패하면 failed, 아니면 passed로 최근 기록에 추가합니다.
- worker ID가 바뀌면 기존 컨텍스트를 닫습니다. 큐 종료 시 기본적으로 `qa:finish-worker`로 컨텍스트·브라우저를 닫습니다.
- main의 activeRun/scenarioWorker는 전역 단일 객체입니다. 독립 실행 큐의 병렬 처리를 보장하지 않습니다. 실행 설정의 WebKit/Firefox 및 workers 2/4 버튼에는 변경 callback이 없어 표시 전용이며 실제 실행은 Chromium·순차 처리입니다.

### 실행 간 세션 유지 (`keepSession`)

실행 화면의 "세션 유지" 토글(`useRunOrchestration`의 `keepSession`)을 켜면, 묶음 실행이 끝나도 `qa:finish-worker`를 호출하지 않고 고정된 workerId(`session-<timestamp>`)를 재사용합니다. 따라서 이후 `beginRuns`/`rerunScenario` 호출(다시 실행, 시나리오 재선택 후 실행, 개별 재실행 등)이 같은 BrowserContext·Page 세션을 이어받아 로그인 쿠키가 유지되며, 2차 인증이 필요한 시나리오를 반복 실행할 때 매번 재인증하지 않아도 됩니다.

- **실행 도중에도 켤 수 있습니다.** 토글은 `running` 여부와 무관하게 항상 활성화되어 있습니다. 시나리오가 실행되는 중에 켜면, 지금 사용 중인 브라우저의 workerId를 그대로 `sessionWorkerId`로 승격시켜 유지 세션으로 삼습니다 — 처음부터 다시 로그인할 필요 없이, 지금 막 로그인을 마친 바로 그 세션부터 이어집니다. 내부적으로 `keepSession` 상태와 별도로 `keepSessionRef`를 두어, 실행 시작 시점의 클로저가 아니라 종료 시점의 최신 토글 값을 기준으로 워커를 닫을지 결정합니다.
- 실행 중에 토글을 끄면 지금 쓰고 있는 브라우저를 즉시 닫지 않고, 그 실행이 끝날 때 `qa:finish-worker`로 정리되도록 미룹니다(진행 중인 단계가 끊기지 않도록). 유휴 상태에서 끄면(또는 "세션 종료" 버튼) 즉시 `qa:finish-worker`로 컨텍스트·브라우저를 닫습니다.
- "실행 중단"(`qa:cancel`)은 workerId와 무관하게 현재 브라우저를 즉시 닫으므로, 유지 중이던 세션도 함께 종료됩니다. "세션 종료" 버튼은 실행 중에는 비활성화되어, 실행 중인 브라우저를 실수로 끊지 않도록 합니다.
- 앱 종료(`before-quit`) 시 유지 중인 세션이 있으면 `shutdownScenarioWorker`가 정리합니다.
- 세션 유지는 쿠키·localStorage 등 컨텍스트 상태만 이어줄 뿐, 로그인 성공 여부를 자동으로 판정하거나 만료된 세션을 감지해 재인증하지 않습니다. 로그인 화면으로 리다이렉트되었는지는 여전히 시나리오의 condition·expectText·manualResult로 확인해야 합니다.
- **타이밍 주의**: 세션 유지 상태에서는 이미 인증되어 있어 로그인 관련 단계가 스킵되거나 매우 빨리 지나갑니다. click/goto는 액션 자체의 완료만 기다리고 SPA 클라이언트 라우팅으로 인한 화면 렌더링 완료까지는 기다리지 않으므로, 세션 없이 실행할 때 로그인 타이핑·리다이렉트가 우연히 만들어주던 대기 시간이 사라져 다음 단계(특히 manualFill/manualControl)가 화면이 준비되기 전에 활성화될 수 있습니다. click/goto 직후 자동·수동 단계가 바로 이어지는 곳에는 `condition` 또는 `waitSeconds`를 명시적으로 지정해야 합니다.

### 실행 전 세션 유지 확인 모달

`beginRuns`는 시나리오 배열이 비어 있지 않으면, `localStorage`(`checkly:keepSessionPromptAnswer`, 값은 `"keep"`/`"skip"`)에 이전 응답이 저장되어 있는지 먼저 확인합니다. 저장되어 있지 않으면 실제 실행(`startRun`)을 보류하고 "세션을 유지하시겠습니까?" 모달을 띄웁니다. 모달에는 버튼이 둘 있습니다: **닫기**(`keep = false`)와 **세션 유지**(`keep = true`). 어느 쪽을 누르든 `resolveSessionPrompt(keep, dontAskAgain)`이 그 값으로 `keepSession`을 즉시 반영합니다.

- 체크박스 **"다시 묻지 않기"**를 켠 채 두 버튼 중 하나를 누르면: 그 버튼의 값(`keep`)이 `localStorage`에 저장되고, 이후로는 모달 없이 항상 그 값으로 실행됩니다(다음 앱 실행 시에도 유지). 즉 "닫기 + 다시 묻지 않기"를 고르면 이후 항상 세션 유지가 꺼진 채로 실행됩니다.
- 체크박스를 끈 채 누르면: 이번 실행에만 그 값이 적용되고 응답은 저장하지 않으므로 **다음 `beginRuns` 호출(다음 시나리오 실행)에서 다시 모달이 뜹니다.**
- 이 모달은 `beginRuns`(상단 "실행" 버튼, 시나리오 선택 실행, 리포트의 "다시 실행" 등)에만 적용됩니다. 개별 "재실행"·재실행 대기열(`rerunScenario`/`advanceStack`)은 이미 정해진 `keepSession` 값을 그대로 사용하며 별도로 묻지 않습니다.
- `localStorage`를 사용할 수 없는 환경(비공개 창 등)에서는 저장이 조용히 실패해, 매 실행마다 다시 묻습니다.

### 개별 시나리오 재실행과 재실행 대기열 타임라인

실행 화면의 EXECUTION 목록에서 각 그룹 헤더에 있는 재실행 아이콘 버튼(`replay`)으로 개별 시나리오를 다시 실행할 수 있습니다. 완료 여부와 무관하게 항상 노출되므로, 아직 실행 전이거나 진행 중인 시나리오도 대기열에 미리 추가할 수 있습니다. `useRunOrchestration`의 `rerunScenario`가 담당하며, `beginRuns`와 달리 `runQueue`나 다른 시나리오의 `liveResults`를 초기화하지 않고 대상 시나리오의 결과만 교체합니다. 같은 그룹 헤더에는 해당 시나리오의 녹화 영상이 있을 때만 다운로드 아이콘 버튼(`download`)이 함께 나타납니다(`runVideos`에서 scenario.id로 조회).

`startRun`이 실행하는 모든 시나리오(최초 배치 포함)와 `rerunScenario`로 추가되는 모든 재실행 시도는 `runTimeline`(`RunTimelineEntry[]`) 한 곳에 순서대로 쌓입니다. 각 항목은 실행 전역에서 고유한 `seq`(1부터 증가, `timelineSeq` 카운터)와 상태(`queued`/`running`/`passed`/`failed`/`cancelled`)를 가지며, 배치 안의 원래 시나리오도 재실행과 동일하게 이 타임라인에 표시됩니다.

- **노출**: `runTimeline.length > 0`이면(즉 무엇이든 한 번이라도 실행되었으면) 실행 화면 상단에 가로 스크롤 카드 스트립("재실행 대기열")이 나타나며, 대기 중인 첫 항목이 자동으로 화면에 들어오도록 스크롤됩니다. 카드는 seq·상태 점·이름·진행 메타(예: "실행 중 3/6", "통과 6/6", "대기 2번째")를 보여주고, 실행 중인 카드에는 하단에 진행률 바가 표시됩니다.
- **제거**: `status: "queued"`인 카드에만 개별 제거(×) 버튼이 나타납니다. 이미 끝났거나 실행 중인 카드는 개별 제거할 수 없습니다.
- **완료 기록 지우기**: `passed`/`failed`/`cancelled` 항목만 타임라인에서 제거합니다(`clearDoneRecords`). `queued`/`running` 항목은 영향받지 않습니다.
- **일시정지/재개**: 하나의 토글 버튼(아이콘+라벨이 함께 바뀜)으로 제어합니다. **일시정지**는 다음 대기 항목의 자동 시작만 막습니다 — 현재 진행 중인 실행은 그대로 끝까지 진행됩니다. 재개하면 대기열의 다음 `queued` 항목부터 순서(FIFO)대로 이어집니다.
- 현재 실행이 끝나면(취소가 아닌 정상/실패 완료) `advanceStack`이 자동 호출되어, 일시정지 상태가 아니면 대기열의 다음 `queued` 항목을 꺼내 실행합니다. "실행 중단"으로 취소하면 `cancelRuns`가 현재 `running` 항목을 직접 `cancelled`로 표시하고(유령 카드 방지), 대기열은 자동으로 이어지지 않습니다 — 남은 `queued` 항목은 그대로 남아 "재개"를 눌러야 진행됩니다. 다만 최초 배치 실행이 취소된 경우, 그 배치의 아직 시작하지 않은 나머지 시나리오는 `queued` 카드 자체가 제거됩니다(다시 자동 실행될 일이 없으므로).
- 재실행도 `beginRuns`와 동일하게 `keepSession`이 켜져 있으면 세션 workerId를 재사용하고, 아니면 매번 새 workerId로 실행 후 `qa:finish-worker`를 호출합니다.
- `beginRuns`에는 실행 중 재호출을 막는 가드가 없다는 기존 제약이 `rerunScenario`에도 동일하게 적용됩니다. 재실행이 진행되는 도중 별도로 `beginRuns`(예: 상단 "실행" 버튼)를 호출하면 sequence가 앞당겨져 진행 중이던 재실행의 `qa:finish-worker` 호출이 생략될 수 있습니다.

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
