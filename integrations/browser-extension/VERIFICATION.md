# 검증 결과

2026-11-09 개발 환경에서 실행:

- 독립 npm install / npm run build: 성공
- npm audit: 알려진 취약점 0개
- npm test: 4개 통과
- npm run test:browser: 실제 Chromium, 로컬 HTTP 500, DOM 스냅샷, 입력값·텍스트 마스킹, rrweb 재생 성공
- npm run test:extension: 별도 프로필에 실제 확장을 로드, 서비스 워커 시작과 비로그인 팝업 성공

단위 테스트의 서버 업로드는 mock 클라이언트로 gzip 바이트를 해제하고 기존 앱의 SessionRecording 형태 및 DB 경로·metadata 계약을 검증합니다. 실제 운영 Supabase에 기록을 쓴 결과나 Electron 앱 UI에서 재생한 결과로 해석하면 안 됩니다. 운영 로그인 정보는 사용하지 않았습니다.

출시 전 확인: 사용자 계정 로그인 → 테스트 사이트 수집 동의 → 오류 발생 → 로컬 목록 확인 → 항목 선택 및 전송 → 완료 건수 증가 → 체클리 앱 동일 프로젝트의 브라우저 기록/서버에서 재생. 새로고침·동일 사이트 페이지 이동·로그아웃·오프라인 전송 실패와 선택 재전송도 확인하세요.
