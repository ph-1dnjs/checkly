# 시나리오 실행

Playwright Chromium으로 시나리오를 순차 실행하고 수동 단계를 중계합니다.

## 문서 목록

1. [개요](01-overview.md)
2. [사용자 흐름](02-userflow.md)
3. [API 연동](03-api.md)
4. [엣지 케이스](04-edge-cases.md)

| 구분 | 위치 | 책임 |
| --- | --- | --- |
| 화면 | `src/renderer/pages/run/RunPage.tsx` | 진행·대기·영상 UI |
| 조립 | `src/renderer/app/App.tsx` | 다중 실행 순서, 결과·기록 |
| 실행 | `src/app/main.ts` | Playwright, 수동 대기, 파일 기록 |
| 브리지 | `src/app/preload.ts` | 실행 IPC·이벤트 구독 |

