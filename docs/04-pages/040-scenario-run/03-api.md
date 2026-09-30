# IPC·데이터·보존 정책

> **범위**: 브라우저 QA IPC와 실행 산출물. 코드 연결은 [인덱스](README.md)를 봅니다.

## Command

| 함수 / IPC | 요청 | 응답·효과 |
| --- | --- | --- |
| runQa / `qa:start` | QaScenario, `{preview?,workerId?}` | `{status,log,reportPath?}`; 한 시나리오 종료까지 대기 |
| finishQaWorker / `qa:finish-worker` | workerId | ID가 일치하는 worker 종료; 없거나 다른 ID면 무시 |
| cancelQa / `qa:cancel` | 없음 | 취소 표시·수동 대기 해제·worker 종료 |
| submitManualInput / `qa:manual-input` | string | 대기 중인 입력 Promise 해결 |
| submitManualControl / `qa:manual-control` | `{status:continue 또는 failed,reason?}` | 직접 제어 Promise 해결 |
| submitManualResult / `qa:manual-result` | `{status:passed 또는 failed,reason?}` | 수동 판정 Promise 해결 |
| controlManualBrowser / `qa:manual-browser-event` | click(x,y), wheel(deltaY), key(key), text(text) | 활성 Page 조작; Page 없거나 취소 상태면 무시 |
| setQaViewport / `qa:set-viewport` | `{width,height}` | 선택 크기와 현재 활성 Page 갱신 |
| downloadRunVideo / `qa:download-run-video` | 파일 경로 | Downloads 목적지 경로, 실패 시 reject |
| mergeRunVideos / `qa:merge-run-videos` | 파일 경로 배열 | 중복 제거 후 병합 경로; 0개면 null |

QaScenario는 id/title/url/steps, QaStep은 id/action/target 및 value/required/prompt/condition/waitSeconds/occurrence입니다. 편집기 tag·좌표·connected는 native 실행 판단에 사용하지 않습니다. preload의 headed 옵션은 main의 실행 타입/로직에서 사용하지 않으며 항상 headless입니다.

`qa:start`의 reportPath는 **리포트 디렉터리**입니다. renderer의 실행 결과 타입/UI는 이를 활용해 과거 리포트를 복원하지 않습니다. IPC 입력 전반에 별도 스키마 검증 계층은 없으며 TypeScript 타입과 함수 내부 조건에 의존합니다.

## Event

| 구독 / 채널 | payload | 처리 |
| --- | --- | --- |
| onQaProgress / `qa:progress` | `{current,total,step}` | 진행 ref/state·로그 갱신 |
| onManualInputRequired / `qa:manual-required` | `{id,target,prompt,required}` | 실행 화면 입력 배너 |
| onManualControlRequired / `qa:manual-control-required` | `{id,target,prompt,timeoutSeconds:300}` | 실행 화면 직접 제어 |
| onManualResultRequired / `qa:manual-result-required` | `{id,target,prompt,timeoutSeconds:300}` | App 전역 판정 모달 |
| onQaPreview / `qa:preview` | JPEG data URL | 최신 이미지 교체 |
| onQaStepPreview / `qa:step-preview` | `{scenarioId,stepId,image}` | 단계 키별 이미지 교체 |
| onRunVideo / `qa:run-video` | path 또는 null | 현재 runVideoScenario와 연결, 병합 배열에 누적 |

구독은 App 훅 mount 시 등록하고 cleanup에서 제거합니다. progress/manual/preview/video 이벤트에는 실행 sequence가 없으며, run-video에는 scenarioId도 없어 renderer ref로 연결합니다.

## 저장 위치와 수명

| 데이터 | 위치·형식 | 기록·복원·삭제 정책 |
| --- | --- | --- |
| 실행 큐·로그·결과·수동 입력 | React 메모리 | 앱 재시작 복원 없음 |
| 최근 실행 | runHistory 최대 5개 | 시나리오 스냅샷, status, passed/failed, ranAt, results 저장. 메모리만 |
| 요약 | runSummary | 취소되지 않은 묶음의 누적 total/passed/failed; 재시작 초기화 |
| 단계 이미지/실시간 이미지 | React의 data URL | 다음 실행에서 초기화. 디스크 이미지 파일로 저장하지 않음 |
| 리포트 | `userData/reports/run-{Date.now()}/report.json`, `report.html` | 시나리오별 생성; 자동 삭제·과거 목록 복원 없음 |
| 임시 영상 | `userData/videos/temporary/` | 컨텍스트의 녹화 파일 생성 위치 |
| 단일 실행 영상 | `userData/videos/runs/{제목}_실행{YYYYMMDDhhmmss}.webm` | 원래 Page 종료 후 rename; 제목의 파일명 금지문자 치환 |
| 전체 실행 영상 | `userData/videos/runs/전체_시나리오_실행{Date.now()}.webm` | 큐 종료 후 ffmpeg concat, 원본 영상 유지 |
| 다운로드 사본 | `app.getPath('downloads')/영상파일명` | copyFile; 동명 파일은 덮어쓸 수 있음 |

userData는 Electron 런타임 경로입니다. JSON 리포트 필드는 `runId,title,baseUrl,status,logs,createdAt`이며 전체 Scenario/Step 배열·캡처·실제 수동 입력값을 별도 필드로 저장하지 않습니다. HTML은 제목·상태·로그를 escape해 기록합니다.

영상 병합/다운로드는 `path.dirname(filePath) === runVideoDirectory()`로 경로를 제한합니다. 확장자·실제 파일 형식 검증까지 하는 것은 아닙니다. 병합은 중복 경로를 제거하고 ffmpeg `-f concat -safe 0 -c copy`로 처리하며 임시 concat 목록은 finally에서 삭제합니다. 녹화 실패로 수집되지 않은 영상이 있으면 전체 영상도 수집된 항목만 포함합니다.

## 정보 취급 정책과 한계

manualFill의 제출 문자열은 명시적으로 실행 로그·리포트에 추가하지 않습니다. 그러나 화면 캡처·녹화에는 입력 후 화면이 포함될 수 있고, locator 오류 메시지나 사용자 실패 사유에 대한 별도 비밀값 마스킹도 없습니다. “수동 입력값을 어느 산출물에도 남기지 않는다”는 보장은 없습니다.

미리보기 비활성화는 녹화 비활성화가 아닙니다. manualControl도 녹화 컨텍스트를 사용합니다. 원래 Page 영상만 이동·수집하고 팝업별 영상은 별도로 수집하지 않습니다. 임시 영상의 포괄 정리, 리포트/영상 보존기한, 저장 용량 제한·자동 삭제·암호화는 이 경로에 구현되어 있지 않습니다.
