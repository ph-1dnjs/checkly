# 시나리오 선택

선택한 폴더의 Markdown 파일을 읽어 하나 이상의 시나리오를 실행 큐로 전달합니다.

## 문서 목록

1. [개요](01-overview.md)
2. [사용자 흐름](02-userflow.md)
3. [IPC 연동](03-api.md)
4. [엣지 케이스](04-edge-cases.md)

| 구분 | 위치 | 책임 |
| --- | --- | --- |
| 화면 | `src/renderer/pages/picker/ScenarioPickerPage.tsx` | 파일 cache·선택 카트 |
| 모델 | `src/renderer/shared/model/scenario.ts` | Markdown 파싱 |
| native | `scenario:list-folder/choose-folder/read-file` | 폴더·파일 접근 |

