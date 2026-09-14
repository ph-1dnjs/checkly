# 폼 자동 완성

실제 사이트를 독립 웹뷰 세션으로 열고 폼 자동 입력부터 네트워크·저장소 검사, 응답 오버라이드, 화면 캡처까지 한 화면에서 수행합니다.

`qa-app`의 LIVE QA SESSION 기능을 Checkly 디자인과 상태 구조에 맞춰 옮긴 전용 작업대입니다. 각 브라우저 세션은 별도 persistent partition을 사용하므로 다른 페이지나 세션의 로그인·쿠키와 섞이지 않습니다.

## 문서 목록

1. [개요](01-overview.md)
2. [사용자 흐름](02-userflow.md)
3. [상태 연동](03-api.md)
4. [엣지 케이스](04-edge-cases.md)

| 구분 | 위치 | 책임 |
| --- | --- | --- |
| 화면 | `src/renderer/pages/form-automation/FormAutomationPage.tsx` | 웹뷰 세션·검사 패널·기능 상태 조율 |
| 모델 | `src/renderer/pages/form-automation/model.ts` | 필드값 생성·세션·케이스 순수 로직 |
| 주입 코드 | `src/renderer/pages/form-automation/browserScripts.ts` | 대상 웹페이지 필드 감지·입력·초기화 |
| LIVE QA 모델 | `src/renderer/pages/form-automation/liveQa.ts` | 네트워크 계약·오버라이드·저장소 공통 로직 |
| 검사 패널 | `src/renderer/pages/form-automation/InspectorPanels.tsx` | 네트워크·저장소·오버라이드 UI |
| 화면 캡처 | `src/renderer/pages/form-automation/ScreenshotEditor.tsx` | 캡처 이미지 주석·클립보드 복사 |
| Swagger | `src/renderer/pages/form-automation/OpenApiDialog.tsx` | URL·파일 방식 OpenAPI 연결 |
| 웹뷰 preload | `src/app/formAutomationWebviewPreload.ts` | fetch/XHR 관찰·오버라이드 적용·페이지 오류 수집 |
| main IPC | `src/app/ipc/formAutomation.ts` | 캡처·클립보드·로그·HTTP·fixture 처리 |
| 로그 리포트 | `src/app/ipc/formAutomationReport.ts` | 네트워크 로그 XLSX 생성 |
