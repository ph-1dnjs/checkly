# 개요와 코드 경계

평소 rrweb 이벤트는 8MB 이내 메모리 버퍼에 두고, 오류 전후 5초만 로컬 기록으로 마감한다. 로그인 상태에서는 정상 API 호출·이동 로그를 팀 DB로 보내고 오류 기록만 비공개 Storage로 공유한다. 공통 프로젝트·멤버·엔드포인트 테이블은 변경하지 않는다.

- `src/app/ipc/live-session/service.ts`: 웹뷰·Playwright 수집, 오류 클립 lifecycle, 로컬·팀 조회/삭제, 계정 변경 시 버퍼 초기화.
- `buffer.ts`: 재생에 필요한 전체 스냅샷을 포함하는 제한된 버퍼.
- `telemetry.ts`: 메타데이터 허용 목록, 100개 단위 로그 전송·재시도, 세션 변경 시 대기열 폐기.
- `team-store.ts`: 로그인 클라이언트/RLS로 gzip 업로드·다운로드·삭제. renderer와 대상 페이지에 토큰을 노출하지 않는다.
- `src/app/formAutomationWebviewPreload.ts`: 기존 네트워크 이벤트를 main으로 전달. 페이지 이동은 WebContents 이벤트로 수집한다.
- `scripts/copy-session-recorder.cjs`: npm recorder 번들을 앱에 포함하며 CDN은 쓰지 않는다.
- `SessionRecordingsDialog.tsx`, `SessionPlayer.tsx`: 로컬/팀 목록, 업로드 상태, 삭제, 문서 선택, 재생과 타임라인.

```bash
npm run build
npx tsc --noEmit
npm run test:live-session
npm run test:live-session:desktop
node --import tsx tests/live-session/team-desktop.e2e.ts
```

단위 검증은 저장소 복구·크기 제한·오류 구간·로그 민감값 제거·로그 재시도·계정 변경·Supabase 클라이언트의 압축 업로드/조회/삭제 HTTP 계약을 검사한다. HTTP 검증은 가짜 응답을 사용하는 클라이언트 테스트이며 실제 클라우드 배포 검증과 구분한다. Desktop 검증은 임시 프로필과 로컬 사이트에서 정상 동작 무저장·오류 전후 5초·중복 오류 합치기·마스킹·재생·재시작·삭제를 확인한다. 팀 Desktop 검증은 임시 Supabase HTTP 서버로 실제 Electron 수집부터 로그 전송·오류 업로드 실패/재시도·재생·삭제까지 검사하며 팀 클라우드를 건드리지 않는다.
