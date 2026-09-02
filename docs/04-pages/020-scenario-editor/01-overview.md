# [개요] 시나리오 편집

## 텍스트 모드

- 여러 시나리오를 포함한 Markdown textarea
- `parseMarkdown` 기반 제목·URL·tag·단계 미리보기
- 변경 여부 표시
- Markdown 파일 불러오기, 저장/내보내기, 실행
- 마커 편집 모드 전환

초기에는 `userData/scenarios.md`를 불러오고 없으면 seed Markdown을 사용합니다. 원문 변경 시 첫 시나리오가 현재 marker 대상이 됩니다.

## 마커 모드

- 여러 블록 중 편집할 시나리오 선택
- mobile 390px, tablet 834px, desktop 100% WebView 폭
- 단계 목록 선택·편집·삭제·pointer drag 재정렬
- target Page 위 marker pin 표시·숨김·추가
- 마지막 단계 삭제·전체 초기화
- Playwright 기반 connected 검사
- action, target, condition, wait, occurrence, value/file, prompt 편집

마커 좌표는 제목+URL key 아래 action/target/value/prompt/condition/wait가 같은 단계에 재결합됩니다. 좌표 없는 단계는 index 기반 기본 위치를 사용합니다.

## 저장

- 기본 원문: 항상 `userData/scenarios.md`
- 가져온 파일: 활성 경로가 있으면 같은 파일도 덮어씀
- 새 저장: native save dialog로 파일 생성
- marker 위치: 변경될 때 `marker-positions.json` 자동 저장
- marker→text 복귀: 저장, 저장하지 않음, 취소 중 선택

지원 action과 Markdown 문법은 [함수 문서](../../06-functions/README.md)를 참고합니다.

