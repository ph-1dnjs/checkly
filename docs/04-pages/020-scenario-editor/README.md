# 시나리오 편집

Markdown 원문 편집과 대상 페이지 위 마커 편집을 제공합니다.

## 문서 목록

1. [개요](01-overview.md)
2. [사용자 흐름](02-userflow.md)
3. [API 연동](03-api.md)
4. [엣지 케이스](04-edge-cases.md)

| 구분 | 위치 | 책임 |
| --- | --- | --- |
| 화면 | `src/renderer/pages/editor/ScenarioEditorPage.tsx` | 편집·마커 UI |
| 모델 | `src/renderer/shared/model/scenario.ts` | 파싱·직렬화 대상 타입 |
| IPC | `src/app/preload.ts`, `src/app/main.ts` | 저장·불러오기·검사 |

