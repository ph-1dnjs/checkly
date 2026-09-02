# API

이 프로젝트에는 백엔드 HTTP 클라이언트가 없습니다. 화면과 native 기능의 계약은 Electron IPC입니다.

```text
React page → window.electronAPI (preload) → ipcMain handler → 파일 시스템 / Playwright
```

| 범주 | 주요 채널 | 구현 |
| --- | --- | --- |
| 시나리오 | `scenario:load`, `save`, `import-file`, `export-file`, `list-folder` | `src/app/main.ts` |
| 마커 | `marker-positions:load`, `save` | `src/app/main.ts` |
| 실행 | `qa:inspect`, `start`, `cancel`, `finish-worker` | `src/app/main.ts` |
| 수동 실행 | `qa:manual-input`, `manual-control`, `manual-result`, `manual-browser-event` | `src/app/main.ts` |
| 실행 이벤트 | `qa:progress`, `manual-required`, `qa:preview`, `qa:run-video` | main → renderer |

IPC 공개 surface는 `src/app/preload.ts`의 `contextBridge.exposeInMainWorld`에 한정합니다. 다운로드·병합은 실행 영상 디렉터리인지 검사하며, 실패는 현재 호출 Promise가 reject되어 UI 흐름에서 처리됩니다.

인증, HTTP 재시도, 서버 캐시 정책은 현재 구현에 없습니다.

