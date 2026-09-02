# 컴포넌트

| 컴포넌트 | 위치 | 책임 | 사용처 |
| --- | --- | --- | --- |
| `BottomNavigation` | `src/renderer/widgets/BottomNavigation.tsx` | 화면 전환과 실행/중단 버튼 | `App` |
| `RunReportDrawer` | `src/renderer/widgets/RunReportDrawer.tsx` | 실행 기록 상세와 재실행 | `App`/대시보드 |
| `ScenarioEditorPage` | `src/renderer/pages/editor/ScenarioEditorPage.tsx` | 텍스트·마커 편집 UI | `App` |
| `RunPage` | `src/renderer/pages/run/RunPage.tsx` | 진행도, 수동 단계, 영상 다운로드 UI | `App` |

`BottomNavigation`은 `route`, `running`, 이동·실행·취소 callback을 받습니다. 실행 중이면 같은 버튼이 취소 동작으로 바뀝니다.

`RunReportDrawer`는 `RunRecord | null`을 받으며 null일 때 렌더링하지 않습니다. 재실행은 기록에 저장된 시나리오 배열을 상위로 돌려줍니다.

페이지 컴포넌트는 현재 대부분의 상태를 props로 받으므로, 단일 화면 전용 상태를 새 전역 저장소로 분리하지 않습니다.

