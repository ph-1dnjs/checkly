# 개요

하단 `폼 자동 완성` 탭은 기존 시나리오 편집·실행 상태와 분리된 로컬 상태를 사용합니다. 세션마다 별도 persistent partition을 사용하므로 로그인과 쿠키가 서로 섞이지 않습니다.

지원 입력은 일반 input·textarea, radio, checkbox, 단일·다중 select, contenteditable, file, 날짜·기간 선택 트리거입니다. 감지 결과로 정상값과 유효성 오류값 케이스를 만들며, 사용자가 값을 편집해 현재 화면 범위에 저장할 수 있습니다.

## 제공 기능

- `자동 입력`: 현재 화면 필드 감지, 정상·실패 케이스 생성, 사용자 케이스 저장과 초기화
- `네트워크`: fetch/XHR 및 페이지 오류 기록, 오류 필터, 상세 요청·응답 확인, API 스펙 복사, XLSX 다운로드와 전체 삭제
- `Swagger`: OpenAPI JSON URL 또는 로컬 파일 연결, 응답 스키마 계약 검증
- `저장소`: 현재 세션의 localStorage, sessionStorage, 접근 가능한 쿠키, IndexedDB·Cache Storage 요약
- `오버라이드`: 실제 응답 복제, exact method/path 규칙 편집, 활성화·비활성화와 즉시 재적용
- `화면 캡처`: 전체 웹뷰 캡처 후 펜·네모·체크·텍스트·지우개로 주석하고 PNG를 클립보드에 복사
- `화면 배율`: 노트북 화면에 맞춰 웹뷰를 50~125% 범위에서 5% 단위로 조절

브라우저 네트워크 훅과 팝업 처리는 `persist:checkly-form-automation*` partition에만 적용되어 기존 편집기·실행기 웹뷰에는 영향을 주지 않습니다.
