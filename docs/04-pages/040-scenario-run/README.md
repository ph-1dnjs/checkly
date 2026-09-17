# 시나리오 실행 — 개발·정책 문서

> **범위·기준**: 2026-09-17 작업 트리의 브라우저 QA 실행 요청, 순차 큐, 자동·수동 단계, 취소, 결과·영상·리포트를 다룹니다. 아래 정책은 현재 구현 기준입니다.

## 문서 목록

1. [기능·실행 정책](01-overview.md)
2. [사용자 흐름·상태 전이](02-userflow.md)
3. [IPC·데이터·보존 정책](03-api.md)
4. [예외 처리·제한·검증 항목](04-edge-cases.md)

원문 문법과 저장은 [시나리오 편집](../020-scenario-editor/README.md), 실행 대상 선택은 [시나리오 선택](../030-scenario-picker/README.md)을 봅니다.

## 코드 근거

| 코드 | 책임 |
| --- | --- |
| [App.tsx](../../../src/renderer/app/App.tsx) | 편집·선택·재실행 진입 연결, 전역 수동 판정 UI |
| [useRunOrchestration.ts](../../../src/renderer/app/hooks/useRunOrchestration.ts) | 큐, sequence, 이벤트 구독, 결과·최근 기록·영상 수집 |
| [RunPage.tsx](../../../src/renderer/pages/run/RunPage.tsx) | 단계/시나리오 목록, 로그, 캡처, viewport, 직접 제어 |
| [BottomNavigation.tsx](../../../src/renderer/widgets/BottomNavigation.tsx) | 실행/중지와 화면 전환 |
| [qaExecution.ts](../../../src/app/ipc/qaExecution.ts) | Chromium worker, locator, 수동 대기, 캡처, 정리 |
| [qaTypes.ts](../../../src/app/ipc/qaTypes.ts) | native 실행 입력·수동 제어 타입 |
| [reports.ts](../../../src/app/ipc/reports.ts), [video.ts](../../../src/app/ipc/video.ts) | 리포트·영상 파일과 다운로드 |
| [preload.ts](../../../src/app/preload.ts), [main.ts](../../../src/app/main.ts) | IPC 공개·등록 |

변경 완료 기준은 실행 결과뿐 아니라 실패 후 다음 항목 진행, 취소 시 큐·파일 처리, 수동 대기, 메모리 기록과 디스크 산출물의 차이가 설명과 일치하는 것입니다.
