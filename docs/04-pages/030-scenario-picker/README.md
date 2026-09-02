# 시나리오 선택

선택한 폴더의 Markdown 파일에서 하나 이상의 시나리오를 골라 실행합니다.

## 문서 목록

1. [개요](01-overview.md)
2. [사용자 흐름](02-userflow.md)
3. [API 연동](03-api.md)
4. [엣지 케이스](04-edge-cases.md)

| 구분 | 위치 | 책임 |
| --- | --- | --- |
| 화면 | `src/renderer/pages/picker/ScenarioPickerPage.tsx` | 파일·시나리오 선택 |
| 모델 | `src/renderer/shared/model/scenario.ts` | 파일 Markdown 파싱 |
| IPC | `scenario:list-folder`, `choose-folder`, `read-file` | 폴더 접근 |

