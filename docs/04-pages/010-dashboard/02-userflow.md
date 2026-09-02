# [사용자 흐름] 대시보드

```mermaid
flowchart TD
  A[실행 기록 진입] --> B{기록 존재}
  B -->|아니오| C[빈 상태]
  C --> D[시나리오 선택]
  B -->|예| E[요약·최근 5개 표시]
  E --> F[기록 행 선택]
  F --> G[RunReportDrawer]
  G --> H{다시 실행}
  H -->|예| I[원래 Scenario 배열로 실행]
  H -->|아니오| J[서랍 닫기]
```

| 단계 | 사용자 액션 | 시스템 동작 | 다음 단계 |
| --- | --- | --- | --- |
| 1 | 시나리오 선택 | picker route로 전환 | 실행 대상 선택 |
| 2 | 전체 실행 | run route로 전환 | 현재 편집 원문의 모든 시나리오 실행 |
| 3 | 기록 선택 | 선택 record를 drawer state에 저장 | 상세 표시 |
| 4 | 다시 실행 | record의 Scenario 배열로 `beginRuns` | 실행 화면 |

