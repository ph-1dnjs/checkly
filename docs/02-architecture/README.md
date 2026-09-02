# 아키텍처

Checkly는 Electron main 프로세스가 파일·대화상자·Playwright를 담당하고, React 렌더러가 편집과 실행 UI를 담당하는 데스크톱 앱입니다.

```text
src/renderer/src.tsx → App
  → pages / widgets → window.electronAPI
src/app/preload.ts → Electron IPC
src/app/main.ts → 파일 시스템 · Playwright · 업데이트
```

## 디렉터리

| 위치 | 책임 |
| --- | --- |
| `src/app/main.ts` | BrowserWindow, IPC handler, 시나리오 실행, 파일·영상·리포트 I/O |
| `src/app/preload.ts` | 최소 `electronAPI` 브리지 |
| `src/renderer/app/App.tsx` | 화면 전환 및 앱 상태 조립 |
| `src/renderer/pages/` | 대시보드, 편집, 선택, 실행, 설정 화면 |
| `src/renderer/widgets/` | 하단 탐색, 실행 기록 서랍 |
| `src/renderer/shared/model/scenario.ts` | 시나리오 타입, Markdown 파서, 표시용 함수 |
| `src/renderer/styles/` | 전역·화면별 CSS |

## 화면 전환과 상태

URL 라우터는 없습니다. `App`의 `route` 상태(`dashboard`, `editor`, `picker`, `run`, `settings`)가 표시 페이지를 결정합니다. 시나리오 원문과 마커 위치는 Electron `userData` 아래에 저장되고, 실행 기록과 설정 토글은 현재 렌더러 메모리에만 유지됩니다.

## 실행 흐름

```text
Markdown → parseMarkdown → Scenario
  → IPC qa:start → Playwright Chromium
  → IPC 진행/수동입력/미리보기 이벤트 → RunPage
```

Playwright는 headless Chromium과 재사용 가능한 worker context를 사용합니다. 실행 영상과 HTML/JSON 리포트는 `userData` 아래에 생성됩니다.

## 빌드 경계

Vite는 `src/renderer`를 `dist/`로 빌드하고, TypeScript는 `src/app`을 CommonJS `dist-electron/`로 컴파일합니다. `electron-builder`가 두 산출물과 `package.json`을 패키징합니다. 패키징 대상은 macOS(dmg/zip), Windows(nsis), Linux(AppImage)입니다.

