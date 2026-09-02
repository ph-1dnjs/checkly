# [개요] 시나리오 실행

## 실행 단위

`beginRuns`는 빈 배열이면 현재 시나리오, 아니면 받은 순서의 Scenario 배열을 사용합니다. 실행 sequence를 올리고 동일 sequence를 worker ID로 사용합니다. 큐 안에서는 하나의 headless Chromium·BrowserContext를 재사용하고 시나리오마다 새 Page를 엽니다.

Page 기본값:

- viewport·video 1280×720
- action timeout 10초
- navigation timeout 15초
- 기본 URL `domcontentloaded`
- popup이 생기면 활성 제어 Page로 전환

한 시나리오가 failed여도 다음 시나리오를 계속 실행합니다. cancelled이면 큐를 중단합니다.

## 자동 단계

조건 텍스트가 없으면 skip하고, goto/fill/upload/click/select/expectText를 Playwright locator로 실행합니다. click·expectText는 기본 10초 또는 단계 wait를 사용합니다.

## 수동 단계

| 단계 | 화면 | 완료 |
| --- | --- | --- |
| manualFill | 값 입력 modal, 숨김/표시 | 값을 main에 보내 target fill |
| manualControl | 실시간 preview 직접 제어 | continue 또는 failed; 최대 5분 |
| manualResult | 성공/실패 modal | 실패 사유 필수; 최대 5분 |

manual input 값은 로그·record에 저장하지 않습니다. manualControl click은 화면 이미지 좌표를 1280×720로 변환합니다.

## 결과 산출물

- 시나리오별 status/log와 renderer 결과
- `reports/run-{timestamp}/report.json`, `report.html`
- `videos/runs/{title}_실행{timestamp}.webm`
- 큐 완료 시 `전체_시나리오_실행{timestamp}.webm`
- renderer 메모리의 최근 실행 record

실행 화면의 과거 파일 목록 복원은 없으며 현재 실행에서 수집한 path만 다운로드합니다.

