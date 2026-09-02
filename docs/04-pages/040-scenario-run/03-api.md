# [API 연동] 시나리오 실행

| IPC | 호출 시점 | 용도 |
| --- | --- | --- |
| `qa:start` | 시나리오별 시작 | Playwright 실행 |
| `qa:cancel` | 중단 | 수동 Promise 해제·브라우저 종료 |
| `qa:manual-input` | 수동 입력 완료 | 입력 단계 재개 |
| `qa:manual-control` / `manual-result` | 수동 판단 | 계속·실패 결정 |
| `qa:manual-browser-event` | 직접 제어 | 클릭·스크롤·키·텍스트 전달 |
| `qa:download-run-video` | 단일 영상 다운로드 | Downloads 복사 |
| `qa:merge-run-videos` | 전체 영상 요청 | ffmpeg concat |

main에서 renderer로 보내는 `qa:progress`, `qa:manual-required`, `qa:manual-control-required`, `qa:manual-result-required`, `qa:preview`, `qa:run-video` 이벤트가 화면 상태를 갱신합니다.

