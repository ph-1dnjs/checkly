# [IPC 연동] 시나리오 실행

## Command

| IPC | 호출 | 핵심 입력·출력 |
| --- | --- | --- |
| `qa:start` | 시나리오마다 | Scenario + preview/workerId → status/log/reportPath |
| `qa:finish-worker` | 큐 종료 | workerId → close |
| `qa:cancel` | 실제 중지 | active run 해제·worker close |
| `qa:manual-input` | 입력 제출 | string |
| `qa:manual-control` | 직접 제어 완료·실패 | status/reason |
| `qa:manual-browser-event` | preview 조작 | click/wheel/key/text |
| `qa:manual-result` | 판정 | passed/failed + reason |
| `qa:download-run-video` | 다운로드 | run path → Downloads path |
| `qa:merge-run-videos` | 큐 완료 | path[] → merged path/null |

## Event

| 채널 | payload | App 처리 |
| --- | --- | --- |
| `qa:progress` | current/total/step | ref·state·로그 갱신 |
| `qa:manual-required` | manualFill 단계 | 입력 UI |
| `qa:manual-control-required` | 단계+300초 | 직접 제어 UI |
| `qa:manual-result-required` | 단계+300초 | 판정 modal |
| `qa:preview` | JPEG data URL | viewport 이미지 |
| `qa:run-video` | path/null | 현재 시나리오와 path 수집 |

`qa:start`의 main 결과에는 reportPath가 있지만 App 타입과 UI는 현재 이를 사용하지 않습니다.

