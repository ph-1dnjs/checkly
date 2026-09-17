# 시나리오 편집 — 개발·정책 문서

> **범위·기준**: 2026-09-17 작업 트리의 브라우저 QA 시나리오 편집, 복제, 저장, 실행 전달을 다룹니다. API 테스트의 시나리오는 [별도 기능](../070-api-testing/README.md)입니다. 아래 정책은 현재 코드가 적용하는 규칙이며, 의도와 구현이 다른 부분은 제한으로 구분합니다.

## 문서 목록

1. [기능·문법·편집 정책](01-overview.md)
2. [사용자 흐름·상태 전이](02-userflow.md)
3. [IPC·데이터·저장 정책](03-api.md)
4. [예외 처리·제한·검증 항목](04-edge-cases.md)

실행 단계의 실제 동작과 결과 보존은 [시나리오 실행](../040-scenario-run/README.md)을 함께 확인합니다.

## 코드 근거

| 코드 | 책임 |
| --- | --- |
| [ScenarioEditorPage.tsx](../../../src/renderer/pages/editor/ScenarioEditorPage.tsx) | 텍스트·WebView·마커·단계 편집 UI |
| [DuplicateScenarioModal.tsx](../../../src/renderer/pages/editor/DuplicateScenarioModal.tsx) | 복제 케이스 입력·취소 |
| [useScenarioState.ts](../../../src/renderer/app/hooks/useScenarioState.ts) | 원문/저장본/마커 상태, 직렬화, 좌표 복원, 저장, 실행 스냅샷 |
| [scenario.ts](../../../src/renderer/shared/model/scenario.ts) | Scenario/Step 타입과 Markdown 파서 |
| [scenario-duplication.ts](../../../src/renderer/shared/model/scenario-duplication.ts) | 복제 값 종류·기본값·이름 중복 처리 |
| [App.tsx](../../../src/renderer/app/App.tsx) | 편집·실행 훅 연결, 복귀 확인 모달 |
| [fileStorage.ts](../../../src/app/ipc/fileStorage.ts) | 기본 원문·외부 파일·좌표 읽기/쓰기 |
| [qaExecution.ts](../../../src/app/ipc/qaExecution.ts) | 연결 검사와 실행 대상 탐색 |

변경 완료 기준은 정상 흐름뿐 아니라 미저장 상태, 저장 취소·실패, 재시작 복원, 파싱/직렬화 차이까지 설명과 코드가 일치하는 것입니다.
