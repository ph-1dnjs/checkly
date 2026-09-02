# 아키텍처

이 문서는 현재 구현된 Checkly의 프로세스 구조, 상태와 파일 저장, 시나리오 실행 데이터 흐름을 설명합니다. 설계 의도보다 실제 소스 코드의 동작을 우선합니다.

## 전체 구조

Checkly는 Electron의 main·preload·renderer 경계로 구성됩니다. React 렌더러는 화면과 실행 오케스트레이션을 담당하고, main 프로세스는 OS 권한이 필요한 파일·대화상자·Playwright·ffmpeg·업데이트 작업을 담당합니다. preload는 두 영역 사이에 허용된 IPC만 노출합니다.

```text
src/renderer/src.tsx
  → React App
    → pages / widgets / shared model
      → window.electronAPI
        → src/app/preload.ts
          → Electron ipcRenderer.invoke / event listener
            → src/app/main.ts ipcMain handler
              → 파일 시스템 / native dialog / Playwright / ffmpeg
```

## 프로세스 경계

| 영역 | 진입점 | 책임 | 직접 접근 가능한 자원 |
| --- | --- | --- | --- |
| Renderer | `src/renderer/src.tsx` | 화면 전환, 편집 상태, 실행 큐, 결과 UI | DOM, React state, preload API |
| Preload | `src/app/preload.ts` | 허용된 command/event 브리지 | `ipcRenderer`, `contextBridge` |
| Main | `src/app/main.ts` | 창, 파일, dialog, QA 실행, 영상, 리포트, 업데이트 | Node.js, Electron, Playwright, ffmpeg |

BrowserWindow는 `contextIsolation: true`, `nodeIntegration: false`로 생성됩니다. `sandbox`는 false이며, 편집기의 대상 페이지 표시를 위해 `webviewTag`가 활성화되어 있습니다. 새 창 요청은 앱 창에서 열지 않고 `shell.openExternal`로 OS 기본 브라우저에 전달합니다.

## 소스 레이어

| 위치 | 현재 책임 | 주요 파일 |
| --- | --- | --- |
| `src/app` | Electron main/preload와 native 서비스 | `main.ts`, `preload.ts` |
| `src/renderer/app` | 앱 상태, 화면 전환, 실행 오케스트레이션 | `App.tsx` |
| `src/renderer/pages` | 화면 단위 UI | dashboard, editor, picker, run, settings |
| `src/renderer/widgets` | 여러 화면과 App이 조합하는 UI | `BottomNavigation`, `RunReportDrawer` |
| `src/renderer/shared/model` | 시나리오 타입, 파서, 표시·시간 함수 | `scenario.ts` |
| `src/renderer/styles` | 전역·화면별 CSS | `index.css`와 화면별 파일 |
| `src/renderer/features`, `entities` | 현재 구현 없음 | `.gitkeep`만 존재 |

현재 구조는 Feature-Sliced Design의 이름을 일부 사용하지만 전체 FSD 레이어나 공개 API 규칙을 구현하지는 않습니다. 새 추상화를 만들기보다 인접 코드의 현재 경계를 따릅니다.

## 앱 시작과 화면 전환

`src/renderer/src.tsx`는 React `StrictMode`에서 `App`을 렌더링합니다. URL 라우터는 없으며 `App`의 `Route` 상태가 페이지를 선택합니다.

```text
Route = dashboard | editor | picker | run | settings
```

하단 `BottomNavigation`이 route 변경을 요청하고 `App`이 조건부 렌더링합니다. 실행은 어느 화면에서 시작할 수 있으며, 실행 화면 밖에서는 `runNotification`이 진행률 또는 완료 결과를 표시합니다.

## 상태 관리

외부 상태 관리 라이브러리는 없습니다. 상태는 React `useState`, 계산 값은 `useMemo`, 실행 취소·순서·영상 수집처럼 렌더 사이에 유지할 제어 값은 `useRef`를 사용합니다.

| 상태 | 위치 | 수명 |
| --- | --- | --- |
| 현재 Markdown·선택 시나리오·마커 편집 | `App` | 앱 실행 중 + 일부 파일 저장 |
| 화면 route·편집 모드·모달 | `App` 또는 각 페이지 | 메모리 |
| 실행 큐·진행률·로그·미리보기 | `App` | 메모리 |
| 최근 실행 5개·통과/실패 요약 | `App` | 메모리, 재시작 시 초기화 |
| 선택 폴더 파일·선택 집합 | `ScenarioPickerPage` | 화면 컴포넌트 수명 |
| 설정 토글 | `SettingsPage` | 화면 컴포넌트 수명 |
| 마커 대화상자 로컬 UI·viewport | `ScenarioEditorPage` | 화면 컴포넌트 수명 |

## 영속 데이터

main 프로세스는 Electron `app.getPath('userData')` 아래에 앱 데이터를 저장합니다.

| 데이터 | 경로 | 형식 | 복원 여부 |
| --- | --- | --- | --- |
| 기본 시나리오 원문 | `userData/scenarios.md` | Markdown | 앱 시작 시 첫 시나리오 복원 |
| 마커 좌표·표시 정보 | `userData/marker-positions.json` | JSON | 제목+URL과 단계 속성으로 재결합 |
| 최근 선택 폴더 | `userData/scenario-folder.json` | JSON | 선택 화면 진입 시 목록 재조회 |
| 실행 리포트 | `userData/reports/run-{timestamp}/` | JSON + HTML | 생성만 하며 앱 내 목록 복원은 없음 |
| 임시 녹화 | `userData/videos/temporary/` | WebM | 실행 후 runs로 이동 |
| 실행 영상 | `userData/videos/runs/` | WebM | 다운로드·병합 원본, 앱 내 과거 목록 복원은 없음 |

현재 Playwright E2E는 `localStorage['autoqa-scenarios']`를 기대하지만 renderer 코드에는 해당 fallback과 브라우저 환경용 `window.electronAPI` mock이 확인되지 않습니다. 따라서 패키지 앱의 기준 저장소는 main 프로세스의 `scenarios.md`이며, 브라우저 E2E의 실행 가능 여부는 별도 검증이 필요합니다.

## 시나리오 데이터 흐름

```text
Markdown
  → parseMarkdown
    → Scenario[]
      → applyPositions(title + URL, marker store)
        → 편집/선택/실행 UI
          → runQa(Scenario, workerId)
            → executeScenario
              → Playwright Page
              → qa:progress / manual-* / preview / run-video
                → App 상태·RunPage
```

`Scenario`는 제목, 기본 URL, 선택 태그, 단계 배열을 가집니다. 단계는 action과 target을 필수로 하고 값·안내·조건·대기·동일 대상 순서·마커 좌표를 선택적으로 가집니다.

## 실행 오케스트레이션

1. `App.beginRuns`가 실행 대상 배열, sequence와 worker ID를 만듭니다.
2. 각 시나리오를 순서대로 `qa:start`에 전달합니다.
3. main은 worker ID가 같으면 하나의 headless Chromium과 BrowserContext를 재사용하고 시나리오마다 새 Page를 엽니다.
4. 각 Page는 1280×720 viewport와 영상 녹화를 사용합니다.
5. 자동 단계는 main에서 실행하고, 수동 단계는 이벤트로 렌더러의 응답을 기다립니다.
6. 시나리오마다 결과·리포트·영상이 생성됩니다.
7. 큐가 끝나면 worker를 닫고 ffmpeg로 수집된 영상을 이어 붙입니다.
8. 취소되지 않은 묶음은 최근 실행 기록에 추가됩니다.

한 시나리오가 실패해도 다중 실행 큐는 다음 시나리오를 계속 실행합니다. 명시적 취소만 큐를 중단합니다.

## Playwright 대상 탐색

- 입력: 접근성 label → placeholder → `name` 부분 일치 순으로 첫 요소를 사용합니다.
- 클릭: CSS selector가 있으면 보이는 n번째 요소, 아니면 접근성 button → label → 텍스트 순으로 찾습니다.
- 선택: native `select`면 label/value로 `selectOption`; custom UI면 대상과 옵션을 각각 클릭합니다.
- 텍스트 확인: 대소문자 무시 정규식으로 보이는 텍스트가 나타날 때까지 반복합니다.
- 팝업: BrowserContext의 새 page를 활성 제어 대상으로 바꾸고 팝업이 닫히면 원래 page로 돌아갑니다.
- 조건부 단계: 지정 텍스트가 제한 시간 안에 보이지 않으면 실패가 아니라 해당 단계를 건너뜁니다.

## 빌드 경계

```text
Vite: src/renderer → dist/
TypeScript CommonJS: src/app → dist-electron/
electron-builder: dist + dist-electron + package.json → release/
```

Vite의 `base: './'`는 패키지 앱의 `file://` 로드에서도 상대 자산 경로가 동작하게 합니다. Electron 컴파일은 main과 preload만 포함하며 CommonJS를 출력합니다.
