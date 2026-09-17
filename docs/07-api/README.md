# API와 IPC 계약

이 문서의 시나리오 편집·브라우저 QA 실행 계약은 Electron IPC입니다. 별도 API 테스트의 HTTP 요청·저장 계약은 [API 테스트](../04-pages/070-api-testing/03-api.md)를 봅니다.

```text
React → window.electronAPI → preload → ipcMain → 파일/Playwright
main → webContents.send → preload listener → React callback
```

## 보안 경계

renderer는 Node.js·Playwright·파일 시스템에 직접 접근하지 않습니다. native dialog가 외부 파일·폴더를 선택하고, 영상 다운로드·병합은 입력 경로가 `userData/videos/runs` 바로 아래인지 검사합니다. BrowserWindow는 context isolation을 켜고 Node integration을 끕니다. 편집기 WebView를 위해 sandbox는 false, webview tag는 true입니다.

## Renderer → Main

### 앱·시나리오·파일

| 공개 함수 | IPC | 입력 | 출력·용도 |
| --- | --- | --- | --- |
| `getAppVersion` | `app:version` | 없음 | 버전; 설정 화면에 표시 |
| `loadScenarioMarkdown` | `scenario:load` | 없음 | 원문 또는 null |
| `saveScenarioMarkdown` | `scenario:save` | Markdown | 기본 원문 저장 |
| `importScenarioFile` | `scenario:import-file` | 없음 | 원문+경로 또는 null |
| `saveImportedScenarioFile` | `scenario:save-imported-file` | Markdown | 활성 파일 경로 또는 null |
| `exportScenarioFile` | `scenario:export-file` | Markdown | 새 파일 경로 또는 null |
| `selectUploadFile` | `qa:select-upload-file` | 없음 | 업로드 경로 또는 null |
| `load/saveMarkerPositions` | `marker-positions:load/save` | JSON string | marker 복원·저장 |

### 폴더·실행

| 공개 함수 | IPC | 입력 | 출력·효과 |
| --- | --- | --- | --- |
| `listScenarioFolder` | `scenario:list-folder` | 없음 | folderPath, name/path/updatedAt 목록 |
| `chooseScenarioFolder` | `scenario:choose-folder` | 없음 | 선택 후 동일 목록 |
| `readScenarioFile` | `scenario:read-file` | path | 원문 또는 null |
| `inspectScenario` | `qa:inspect` | Scenario | `{id, connected}[]` |
| `runQa` | `qa:start` | Scenario, preview·workerId | status, log, reportPath |
| `finishQaWorker` | `qa:finish-worker` | workerId | worker 종료 |
| `cancelQa` | `qa:cancel` | 없음 | active run·worker 종료 |
| `setQaViewport` | `qa:set-viewport` | width, height | 선택 크기 및 활성 Page 변경, 유한값·200 이상 검사 |
| `downloadRunVideo` | `qa:download-run-video` | run path | Downloads 경로 |
| `mergeRunVideos` | `qa:merge-run-videos` | run paths | 병합 path 또는 null |

preload에는 `headed?` 옵션 타입이 있지만 main은 사용하지 않으며 Chromium은 항상 headless입니다.

### 수동 단계

| 공개 함수 | IPC | 입력 | 동작 |
| --- | --- | --- | --- |
| `submitManualInput` | `qa:manual-input` | string | input 대기 재개 |
| `submitManualControl` | `qa:manual-control` | continue/failed, reason | 직접 제어 확정 |
| `controlManualBrowser` | `qa:manual-browser-event` | click/wheel/key/text | 활성 Page 입력 |
| `submitManualResult` | `qa:manual-result` | passed/failed, reason | 수동 판정 확정 |

수동 입력값은 Page에 fill되며 명시적으로 실행 로그·결과에 추가하지 않습니다. 화면 캡처·녹화·오류 메시지까지 마스킹하는 정책은 없습니다. [실행 데이터 보존](../04-pages/040-scenario-run/03-api.md)을 봅니다.

### 업데이트

| 공개 함수 | IPC | 입력 | 출력·효과 |
| --- | --- | --- | --- |
| `checkForUpdates` | `update:check` | 없음 | `electron-updater`로 즉시 확인, 최신 `UpdateStatus` 반환 |
| `getUpdateStatus` | `update:get-status` | 없음 | main이 들고 있는 마지막 `UpdateStatus` |
| `installUpdate` | `update:install` | 없음 | 다운로드 완료 후 `autoUpdater.quitAndInstall()` |
| `getUpdateSettings` | `update:get-settings` | 없음 | `{ autoCheck }`, userData의 `update-settings.json` |
| `setUpdateAutoCheck` | `update:set-auto-check` | boolean | 주기 확인 on/off를 파일에 저장 |

패키지되지 않은 개발 빌드(`app.isPackaged === false`)에서 `checkForUpdates`는 항상 `{ state: 'not-available' }`을 반환하고 실제 확인을 시도하지 않습니다.

## Main → Renderer

| 구독 | 채널 | payload |
| --- | --- | --- |
| `onQaProgress` | `qa:progress` | current, total, step |
| `onManualInputRequired` | `qa:manual-required` | id, target, prompt, required |
| `onManualControlRequired` | `qa:manual-control-required` | 단계 + 300초 |
| `onManualResultRequired` | `qa:manual-result-required` | 단계 + 300초 |
| `onQaPreview` | `qa:preview` | JPEG data URL |
| `onQaStepPreview` | `qa:step-preview` | scenarioId, stepId, image (JPEG data URL) |
| `onRunVideo` | `qa:run-video` | path 또는 null |
| `onUpdateStatus` | `update:status` | `UpdateStatus` (checking/available/not-available/downloading/downloaded/error) |

구독 함수는 React effect cleanup에 사용할 listener 제거 함수를 반환합니다.

## 오류 정책

- dialog 취소는 null이며 기존 상태를 유지합니다.
- 기본·외부 파일 쓰기 실패는 reject됩니다. 명시 저장·마커 저장·좌표 저장은 토스트를 표시하지만 importScenario 호출에는 catch가 없어 불러오기 실패 토스트가 보장되지 않습니다.
- 폴더·파일 읽기 실패는 빈 결과/null로 축약합니다.
- QA 단계 오류는 대부분 failed status와 log로 반환합니다.
- 취소는 수동 Promise를 해제하고 worker를 닫습니다.
- preview 캡처 실패는 실행을 중단하지 않습니다.
- 잘못된 영상 경로, ffmpeg·병합 실패는 reject됩니다.

브라우저 QA IPC에는 HTTP 인증·retry/cache를 관리하는 공통 계층이 없습니다. 파일 저장의 부분 성공, 취소 결과 불일치, 수동 UI 정리 한계는 [편집 예외](../04-pages/020-scenario-editor/04-edge-cases.md)와 [실행 예외](../04-pages/040-scenario-run/04-edge-cases.md)를 기준으로 확인합니다.

