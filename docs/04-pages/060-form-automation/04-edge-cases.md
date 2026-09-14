# 엣지 케이스

- 마지막으로 열린 dialog가 있으면 페이지 전체보다 dialog 내부 필드를 우선합니다.
- 같은 name의 radio·checkbox는 하나의 필드 그룹으로 처리합니다.
- label이 없으면 aria-label, placeholder, name, 주변 구조 텍스트 순으로 이름을 추론합니다.
- React 제어 입력은 native setter 뒤 input·change·blur·focusout 이벤트를 발생시킵니다.
- 날짜 컴포넌트는 최대 24개월을 이동해 선택하며, 지원하지 않는 달력은 미입력 항목으로 보고합니다.
- 파일 input은 accept와 multiple 조건에 맞는 임시 fixture를 생성합니다.
- 네트워크 훅은 fetch와 XMLHttpRequest만 관찰하며 브라우저 자체의 정적 리소스 요청은 기록하지 않습니다.
- 응답 오버라이드는 HTTP method와 정규화된 pathname이 정확히 일치할 때만 적용합니다. query string은 경로 판정에서 제외합니다.
- OpenAPI 문서의 `$ref`, object, array, primitive 타입을 검증하며 복잡한 조합 스키마는 문서가 제공하는 범위 안에서 확인합니다.
- HttpOnly 쿠키는 페이지 JavaScript 보안 경계 때문에 저장소 탭에 표시할 수 없음을 안내합니다.
- 저장소 값은 현재 선택 세션의 origin에서만 조회하며 다른 세션이나 origin의 값은 합치지 않습니다.
- 캡처 주석 편집기에서는 `Cmd/Ctrl+Z`로 실행 취소하고 `Escape`로 닫습니다.
- 웹뷰 배율은 50~125% 범위를 벗어나지 않습니다.
- 웹뷰 API가 없는 일반 브라우저에서는 페이지 UI만 표시하고 자동 입력은 Electron 전용임을 안내합니다.
