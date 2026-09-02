# 함수와 로직

순수 시나리오 모델 함수와 Electron main의 파일·Playwright 서비스를 정리합니다.

## 모델

| 타입 | 핵심 필드 | 용도 |
| --- | --- | --- |
| `Scenario` | id, title, url, steps, tag | 편집·선택·실행 단위 |
| `Step` | action, target, value·prompt·condition·wait·occurrence·marker | 실행 단계 |
| `RunProgress` | current, total, step | main→renderer 진행 |
| `ScenarioRunResult` | status, 실패 index, message | 실행 결과 |
| `RunRecord` | scenarios, pass/fail, results, ranAt | 최근 기록 |
| `MarkerPositionStore` | 시나리오 key→마커 배열 | 좌표·메타 저장 |

## `parseMarkdown`

위치: `src/renderer/shared/model/scenario.ts`

`#~### 시나리오:` 또는 `Scenario:`에서 블록을 나누고 `url:`, `tag:`와 Given/When/Then/And/But/If 단계를 읽습니다. URL이 없으면 seed URL을 사용합니다.

```markdown
# 시나리오: 주문 조회
url: https://example.com
tag: regression

Given `/orders` 페이지로 이동한다
And `이메일`에 `qa@example.com` 입력
And 화면에 `팝업`가 있는 경우 `닫기` 클릭 [대기 3초]
Then `주문 목록` 텍스트가 보인다 [대기 10초]
```

| Action | 대표 문법 | 실행 |
| --- | --- | --- |
| `goto` | `` `/login` 페이지로 이동한다 `` | 기본 URL 기준 이동 |
| `fill` | `` `이메일`에 `값` 입력 `` | input/textarea fill |
| `fileUpload` | `` `첨부`에 `/path/a.pdf` 파일 업로드 `` | `setInputFiles` |
| `manualFill` | `` `인증번호` 수동 입력 [안내] `` | 사용자 값을 기다린 뒤 fill |
| `manualControl` | `` `결제` 브라우저 직접 제어 [안내] `` | 최대 5분 입력 이벤트 대기 |
| `manualResult` | `` `결과` 수동 결과 확인 [안내] `` | 최대 5분 판정 대기 |
| `click` | `` `삭제` [2번째] 클릭 [대기 5초] `` | 보이는 n번째 클릭 |
| `select` | `` `상태`에서 `완료` 선택 `` | native/custom 선택 |
| `expectText` | `` `저장 완료` 텍스트가 보인다 [대기 10초] `` | 보이는 텍스트 대기 |

`화면에 `조건`가 있는 경우`는 조건이 보일 때만 단계를 실행합니다. 미충족은 실패가 아니라 skip입니다. 파서는 manualResult → manualControl → 결과 확인 → manualFill → upload → fill → select → goto → click 우선순위를 사용합니다.

## 표시·계산·직렬화

| 함수 | 책임 |
| --- | --- |
| `actionText` | 공통 단계 설명 |
| `estimateDurationSeconds` | goto 3초, manualFill 15초, 수동 제어/판정 300초, 나머지 기본 1초 |
| `formatDuration`, `formatClock` | 시간 표시 |
| `markerColor`, `defaultMarkerPosition` | pin 색·기본 좌표 |
| `applyPositions` | 제목+URL과 단계 속성으로 저장 marker 결합 |
| `scenarioToMarkdown` | Scenario를 표준 문법으로 직렬화 |
| `replaceScenarioMarkdown` | 한 블록만 원문에서 교체 |

> **현재 제한**: `scenarioToMarkdown`은 `tag:`를 출력하지 않아 마커 모드에서 블록을 다시 쓰면 tag가 사라질 수 있습니다.

## 파일·영상 서비스

| 함수 | 부수 효과 |
| --- | --- |
| `load/saveScenarioMarkdown` | `userData/scenarios.md` |
| `import/export/saveImportedScenarioFile` | native dialog와 외부 Markdown |
| `load/saveMarkerPositions` | `marker-positions.json` |
| `list/chooseScenarioFolder` | 폴더 경로 저장, Markdown 수정 시각 정렬 |
| `writeRunReport` | escaped HTML과 JSON 생성 |
| `mergeRunVideos` | runs 경로의 WebM만 ffmpeg concat |

## 대상 탐색

| 함수 | 규칙 |
| --- | --- |
| `inputFor` | label → placeholder → input/textarea name |
| `selectFor` | `css=` 또는 label/select name |
| `clickTargetFor` | CSS 또는 모든 frame의 button → label → text |
| `waitForVisibleText` | 100ms 간격으로 visible text 대기 |
| `hasVisibleText` | 조건 text 검사 |
| `resultTargetFor` | “결과 확인”, “클릭” 접미 표현 제거 |

click occurrence는 1부터 시작합니다. iframe은 클릭 탐색에 포함되지만 input/select/expectText 기본 탐색은 main page 기준입니다.

## 검사와 실행

`inspectScenario`는 새 headless Chromium에서 기본 URL만 열고 target 존재 여부를 검사합니다. 이전 단계 뒤에 나타나는 요소는 미연결로 표시될 수 있습니다. goto/manualControl/manualResult는 항상 연결됨입니다.

`executeScenario` 흐름:

1. worker ID에 맞는 headless Chromium과 1280×720 녹화 context를 준비합니다.
2. 새 Page와 기본 URL을 열고 popup을 활성 Page로 추적합니다.
3. 필요하면 200ms마다 JPEG preview를 전송합니다.
4. 조건 검사 후 각 action을 실행합니다.
5. 수동 action은 renderer 응답까지 Promise를 일시정지합니다.
6. 진행·로그를 전송하고 성공·실패·취소 리포트를 생성합니다.
7. Page를 닫고 영상을 `videos/runs`로 이동합니다.

throw된 단계 오류는 `실행 실패: {message}` 로그와 failed status로 정규화됩니다.

