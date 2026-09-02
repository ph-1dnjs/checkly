# 시나리오 실행

Playwright Chromium에서 하나 이상의 시나리오를 순차 실행하고 자동·수동 단계, 결과·영상·리포트를 중계합니다.

> **범위**: App의 실행 요청부터 worker 종료, 기록·영상 병합까지입니다.

## 문서 목록

1. [개요](01-overview.md)
2. [사용자 흐름](02-userflow.md)
3. [IPC 연동](03-api.md)
4. [엣지 케이스](04-edge-cases.md)

| 구분 | 위치 | 책임 |
| --- | --- | --- |
| 화면 | `src/renderer/pages/run/RunPage.tsx` | 진행·미리보기·수동 UI |
| 조립 | `src/renderer/app/App.tsx` | 큐·sequence·결과·기록·병합 |
| 실행 | `src/app/main.ts` | Playwright·수동 대기·리포트·영상 |
| 브리지 | `src/app/preload.ts` | command와 event |

