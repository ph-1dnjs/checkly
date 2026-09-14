# 상태·IPC 연동

| 항목 | 위치 | 용도 |
| --- | --- | --- |
| `checkly-form-target-url` | localStorage | 최근 대상 URL |
| `checkly-form-browser-sessions` | localStorage | 세션 이름·주소·순서 |
| `checkly-form-active-session` | localStorage | 현재 선택한 브라우저 세션 |
| `checkly-form-saved-cases` | localStorage | 화면 범위별 사용자 케이스 |
| `checkly-form-inspector-width` | localStorage | 검사 패널 너비 |
| `checkly-form-network-list-height` | localStorage | 네트워크 요청 목록 높이 |
| `checkly-form-overrides` | localStorage | 응답 오버라이드 규칙 |
| `checkly-form-openapi` | localStorage | 연결된 OpenAPI 문서 |
| `checkly-form-browser-zoom` | localStorage | 웹뷰 화면 배율 |
| `form-automation:insert-text` | preload→main | contenteditable에 native text 입력 |
| `form-automation:attach-fixture` | preload→main | file input에 accept별 fixture 첨부 |
| `form-automation:capture-page` | preload→main | 현재 웹뷰 전체 페이지 캡처 |
| `form-automation:copy-image` | preload→main | 주석 이미지 PNG 클립보드 복사 |
| `form-automation:copy-text` | preload→main | 네트워크·저장소 내용 클립보드 복사 |
| `form-automation:save-session-event` | preload→main | 네트워크·페이지 오류 JSONL 기록 |
| `form-automation:read-session-events` | preload→main | 최근 기록 복원 |
| `form-automation:clear-session-events` | preload→main | 전용 LIVE QA 기록 삭제 |
| `form-automation:export-session-events` | preload→main | 기록을 XLSX로 저장 |
| `form-automation:http-request` | preload→main | CORS와 무관하게 OpenAPI URL 조회 |
| `form-automation:pick-openapi` | preload→main | 로컬 OpenAPI JSON 선택 |
| `form-automation:network-event` | 웹뷰 preload→renderer | fetch/XHR 및 페이지 오류 전달 |

폼 자동완성용 persistent partition은 `persist:checkly-form-automation*` 이름을 사용해 기존 편집기 웹뷰와 저장소를 공유하지 않습니다.

네트워크 기록 파일은 Electron userData 아래 `form-automation-session-events.jsonl`에 저장됩니다. XLSX 내보내기는 요청·응답·계약 오류를 15개 열로 정리합니다.
