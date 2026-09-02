# 시나리오 편집

Markdown 원문 편집, 파일 import/export, 대상 페이지 위 마커 편집을 제공합니다.

> **범위**: 편집기 진입부터 원문·마커 저장 또는 실행까지입니다. 실제 브라우저 단계 실행은 [시나리오 실행](../040-scenario-run/README.md)을 봅니다.

## 문서 목록

1. [개요](01-overview.md)
2. [사용자 흐름](02-userflow.md)
3. [IPC 연동](03-api.md)
4. [엣지 케이스](04-edge-cases.md)

| 구분 | 위치 | 책임 |
| --- | --- | --- |
| 화면 | `src/renderer/pages/editor/ScenarioEditorPage.tsx` | text·marker UI |
| 조립 | `src/renderer/app/App.tsx` | 원문, 직렬화, 저장, marker store |
| 모델 | `src/renderer/shared/model/scenario.ts` | 타입·파싱·표시 |
| native | `src/app/preload.ts`, `main.ts` | 파일·검사 IPC |

