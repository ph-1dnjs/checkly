# 컴포넌트

현재 renderer 컴포넌트의 책임과 상태 소유권을 정리합니다. URL 라우터는 없고 `App.route`가 페이지를 조건부 렌더링합니다.

## 앱과 페이지

| 컴포넌트 | 위치 | 책임 | 상태 소유 |
| --- | --- | --- | --- |
| `App` | `app/App.tsx` | route, Markdown·마커, IPC 구독, 실행 큐·결과·공통 UI | 앱 공유 상태 |
| `DashboardPage` | `pages/dashboard/DashboardPage.tsx` | 실행 요약·최근 기록 표시 | props만 사용 |
| `ScenarioEditorPage` | `pages/editor/ScenarioEditorPage.tsx` | 원문·마커 편집과 WebView | device·drag 등 화면 상태 |
| `ScenarioPickerPage` | `pages/picker/ScenarioPickerPage.tsx` | 폴더 파일·시나리오 선택 | 파일 cache·선택 집합 |
| `RunPage` | `pages/run/RunPage.tsx` | 큐·진행·미리보기·수동 제어·영상 UI | viewport·log filter 등 표시 상태 |
| `SettingsPage` | `pages/settings/SettingsPage.tsx` | 기본 URL과 설정 표시 | 세 토글의 임시 상태 |

`App`은 페이지에 데이터와 callback을 전달하고, main→renderer 이벤트를 React 상태로 바꿉니다.

## 페이지 상세

### DashboardPage

누적 실행 묶음의 통과율·실패 수, 최근 기록별 예상 시간의 중앙 요소, 최대 5개 기록을 표시합니다. 행 선택은 `RunReportDrawer`를 엽니다. 키보드 `Enter` 처리는 현재 없습니다.

### ScenarioEditorPage

텍스트 모드는 textarea와 파싱 미리보기, import/export/run을 제공합니다. 마커 모드는 device 폭, 단계 drag 정렬, WebView, pin, 액션 대화상자를 제공합니다. 액션별 값·파일·안내·조건·대기·동일 대상 순서를 편집합니다.

### ScenarioPickerPage

폴더·시나리오·선택 카트의 3열 UI입니다. `filePath::scenario.id`를 선택 key로 사용하고 파일 순서와 내부 시나리오 순서로 실행 배열을 만듭니다. 단계가 하나도 없는 파일은 목록에서 제외합니다.

### RunPage

실행 큐, 단계 tape, 실시간 JPEG viewport, 로그, 수동 입력·직접 제어, 영상 다운로드를 표시합니다. 직접 제어 시 이미지 좌표를 1280×720 Page 좌표로 변환해 click/wheel/key/text 이벤트를 전달합니다. “브라우저 창 분리”는 현재 로그·토스트만 갱신합니다.

### SettingsPage

세 토글과 브라우저 변경 버튼은 실제 저장·실행·알림 로직에 연결되지 않습니다. “30일 보관”, Slack 채널 등은 표시 텍스트입니다.

## 위젯

### BottomNavigation

현재 route를 바꾸고, 실행 중이 아니면 실행, 실행 중이면 3.5초 안의 두 번째 클릭으로 취소합니다. 실행 화면은 메뉴 항목에 없고 실행 시작 또는 알림 바로가기로 진입합니다.

### RunReportDrawer

`RunRecord | null`을 받아 묶음 결과, 예상 시간, 단계 tape, 실패 메시지와 재실행을 제공합니다. 현재 “STEPS” 값은 실제 단계 수가 아니라 성공+실패 시나리오 수입니다.

## 타입 경계

renderer는 `shared/model/scenario.ts`의 공통 타입을 사용합니다. main에는 별도 구조 타입이 있으므로 필드를 추가할 때 두 경계를 함께 갱신합니다.

