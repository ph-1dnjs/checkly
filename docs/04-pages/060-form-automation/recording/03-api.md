# 저장·IPC 계약

`app.getPath('userData')/live-sessions/<UUID>/`:

- `session.json`: 제목·URL·출처·오류 발생 시각·수집 구간·상태·이벤트 수·크기·트리거 로그 ID. 팀 기록은 `team { projectId, userId }`, `browserSessionId`, `syncStatus`(pending/uploaded/error), `syncError`를 함께 보관한다.
- `events.jsonl`: 문서별 rrweb 이벤트 묶음. 브라우저에서 500ms 또는 100개마다 보내지만 평소에는 메모리에만 둔다. 오류가 발생하면 재생 가능한 직전 스냅샷을 포함해 기록을 만든다. 화면에서 표시하는 구간은 전후 5초로 제한한다.
- 세션별 본문은 최대 50MB. 비정상 종료 시 완성된 JSONL 줄까지 복구하고 `interrupted`로 표시한다. 입력값은 recorder에서 마스킹한다.
- 계정이 없는 로컬 기록은 팀 로그인 후 자동 업로드하지 않는다. 팀 로컬 사본은 해당 프로젝트에서만 표시한다.

## 팀 저장

마이그레이션: `supabase/migrations/20261019051932_browser_telemetry.sql`. `develop`에 반영되면 기존 `.github/workflows/supabase.yml`의 `db push`가 적용한다. 새 Edge Function은 필요하지 않다.

| 저장소 | 내용 |
| --- | --- |
| `form_browser_logs` | 프로젝트·작성자·브라우저 세션 ID, 종류, 발생 시각, URL·페이지 URL, 메서드, HTTP 상태, 소요시간, 오류 여부 |
| `form_browser_recordings` | 프로젝트·작성자·브라우저 세션 ID, 최초 오류의 로그 ID(`trigger_log_id`), 시작 시각, Storage 경로, 세션 메타데이터 |
| 비공개 `browser-error-replays` 버킷 | `<projectId>/<userId>/<clipId>.json.gz`: `SessionRecording` 전체 |

모두 로그인 클라이언트를 사용하며 RLS로 현재 프로젝트만 접근한다. 로그는 append-only이며 UUID로 중복 전송을 무시한다. 본인 기록만 업로드/덮어쓸 수 있고 팀원은 조회·재생·삭제할 수 있다. Storage 업로드 후 DB 메타데이터를 쓰며 실패한 전송은 같은 경로로 재시도한다. 업로드 성공한 로컬 파일은 캐시이므로 팀 DB에서 삭제된 기록을 목록에 되살리지 않는다.

로그 대기는 메모리에 최대 2,000개이며 100개씩 전송한다. 연결 실패 시 다음 5초 tick에서 재시도한다. 한도 초과 시 새 로그를 버리고 상태 메시지를 표시한다. 앱 정상 종료 시 로그를 전송하지만 강제 종료 시 미전송 로그는 유실될 수 있다. 오류 파일은 로컬에 남아 다음 실행에서 같은 계정으로 로그인하면 한 번에 하나씩 재시도한다.

## IPC

`window.electronAPI.liveSession`:

- `list()` → `{ sessions, active, mode?: 'local' | 'team', error? }`. 팀 조회 실패 시 해당 프로젝트의 로컬 사본과 오류 문장을 반환한다.
- `read(id)` → `{ session, documents }`. 팀에 올라간 기록은 인증된 Storage 다운로드로 읽고 압축 해제 크기를 제한한다.
- `remove(id)` → 기록 삭제. 팀 삭제는 Storage를 먼저 지우며 실패 시 DB 포인터와 로컬 사본을 보존해 재시도할 수 있다. 업로드 대기/실패 기록도 같은 경로를 정리하므로 서버에서만 성공한 요청이 남아도 삭제할 수 있다.
- `onChanged(callback)` → 로컬 수집·업로드 변경 구독 해제 함수. 다른 팀원의 변경은 목록 새로고침으로 확인한다.
