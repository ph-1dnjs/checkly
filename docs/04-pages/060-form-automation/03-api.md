# 상태·IPC 연동

| 항목 | 위치 | 용도 |
| --- | --- | --- |
| `checkly-form-target-url` | userData 파일 | 최근 대상 URL |
| `checkly-form-browser-sessions` | userData 파일 | 세션 이름·주소·순서 |
| `checkly-form-active-session` | userData 파일 | 현재 선택한 브라우저 세션 |
| `checkly-form-saved-cases` | userData 파일 | 화면 범위별 사용자 케이스 |
| `checkly-form-inspector-width` | userData 파일 | 검사 패널 너비 |
| `checkly-form-network-list-height` | userData 파일 | 네트워크 요청 목록 높이 |
| `checkly-form-overrides` | userData 파일 | 응답 오버라이드 규칙 |
| `checkly-form-openapi` | userData 파일 | 연결된 OpenAPI 문서 |
| `checkly-form-browser-zoom` | userData 파일 | 웹뷰 화면 배율 |
| `loadFormAutomationState` / `form-automation:load-state` | preload→main | 영속 상태 조회, 최초 실행에서 기존 localStorage 이전 |
| `setFormAutomationState` / `form-automation:set-state` | preload→main | 허용된 키의 값을 저장, 파일 쓰기 완료 후 응답 |
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
| `form-automation:capture-shortcut` | 웹뷰 preload→renderer | 웹뷰에서 누른 `⌘/Ctrl + Shift + S`를 캡처 흐름으로 전달 |

폼 자동완성용 persistent partition은 `persist:checkly-form-automation*` 이름을 사용해 기존 편집기 웹뷰와 저장소를 공유하지 않습니다.

폼 자동 입력 상태는 `app.getPath('userData')/form-automation-state.json`의 `{ version: 1, values }` 형식으로 저장합니다. renderer URL, 개발 서버 포트, 빌드 파일 경로와 무관하게 같은 앱 데이터 디렉터리에서 복원합니다. 최초 파일 생성 시 현재 origin의 기존 localStorage 데이터를 한 번 이전하며, 네이티브 파일이 있으면 빈 저장 목록도 우선하여 삭제한 케이스가 다시 나타나지 않습니다. 일반 브라우저 미리보기는 localStorage를 사용합니다. 구버전 preload 또는 main에 저장 IPC가 없는 경우에도 화면을 마운트하고 기존 localStorage 및 `checkly-form-pending-native-state`의 임시 변경분을 사용합니다. 호환 저장은 변경한 키만 임시 기록하며, 같은 origin에서 저장 연결 재시도나 앱 재시작으로 main에 연결되면 해당 키만 파일에 반영합니다. 파일에 있던 다른 설정이나 삭제된 케이스는 오래된 전체 localStorage 값으로 대체하지 않습니다. 파일 연결이 복구되기 전에는 화면 저장소의 origin을 바꾸지 않는 것이 필요합니다.

조회가 완료된 뒤 폼 화면을 마운트하여 초기 기본값이 기존 데이터를 덮어쓰지 않게 합니다. 저장은 키별로 요청하고 main에서 읽기·수정·쓰기를 직렬화합니다. 임시 파일을 동기화한 뒤 교체하고 `.bak`에 직전 정상 상태를 보관합니다. 읽기 실패 시 정상 백업이 있으면 복원하며, 백업도 없으면 기존 화면 저장본으로 폼을 표시하되 저장을 막고 오류와 다시 불러오기 버튼을 제공합니다. 저장 파일을 덮어쓰지 않습니다. 케이스 저장·삭제는 파일 쓰기 완료 뒤 성공을 표시하고, 실패하면 이전 목록으로 돌아갑니다.

네트워크 기록 파일은 Electron userData 아래 `form-automation-session-events.jsonl`에 저장됩니다. XLSX 내보내기는 요청·응답·계약 오류를 15개 열로 정리합니다.


대상 페이지 스크립트의 디자인 시스템 어댑터는 `controlAdapters.ts`에 있으며 공개 DOM·ARIA·이벤트만 사용합니다. Ark UI와 Ant Design의 기본 입력·체크박스·스위치·라디오·선택 메뉴·단일 날짜 컨트롤을 지원하고, 라이브러리 내부 상태와 테마 토큰에는 의존하지 않습니다.
