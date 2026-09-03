# 배포

> **WARNING**: 코드 서명·공증은 CI 워크플로에 자리(secrets)만 마련되어 있고, 실제 인증서·Apple 자격 증명이 설정되었는지는 저장소에서 확인되지 않았습니다. Release 승인·롤백·모니터링 절차도 확인되지 않았습니다.

## Chromium 번들링

`main.ts`는 Playwright의 `chromium.launch()`로 시나리오를 실행합니다. `@playwright/test`는 `dependencies`에 있어 `app.asar`에 포함되고, 실제 Chromium 실행 파일은 `postinstall`이 `PLAYWRIGHT_BROWSERS_PATH=0`로 설치해 `node_modules/playwright-core/.local-browsers`에 로컬로 내려받습니다. 이 폴더는 `build.asarUnpack`에 등록되어 `app.asar.unpacked`로 풀려 나가고, `main.ts`는 `chromium.executablePath().replace('app.asar', 'app.asar.unpacked')`로 실행 파일의 실제 경로를 계산해 `launch()`에 넘깁니다(ffmpeg와 동일한 패턴). 이 값이 없으면 패키지된 앱은 asar 안의 가상 경로를 spawn하려다 실패합니다.

`process.env.PLAYWRIGHT_BROWSERS_PATH = '0'`는 `main.ts`의 첫 실행 문장으로, 다른 import보다 먼저 평가되어야 합니다. Playwright는 이 값을 모듈이 처음 로드되는 시점에 한 번만 읽으므로 이후에 설정해도 반영되지 않습니다.

## 빌드와 패키징

```bash
npm install
npm run build
npm run package
```

`npm run build`는 Vite renderer → `dist/`, main/preload CommonJS → `dist-electron/`을 만듭니다. `npm run package`는 `.env`를 로드하고 electron-builder를 실행해 `release/`에 산출물을 생성합니다. `package:dir`은 unpacked 앱을 만듭니다(자동 업데이트용 `app-update.yml`/`latest*.yml`은 생성되지 않으므로 업데이트 확인은 항상 오류로 끝납니다 — 실제 설치 파일 빌드에서만 확인 가능).

| 플랫폼 | target |
| --- | --- |
| macOS | dmg, zip |
| Windows | nsis |
| Linux | AppImage |

패키지에는 `dist/**`, `dist-electron/**`, `package.json`과 `dependencies`에 선언된 node_modules가 포함됩니다. `ffmpeg-static`, `playwright-core/.local-browsers`의 실행 파일은 asar 밖으로 unpack됩니다. appId는 `dev.ph1dnjs.checkly`, publish 대상은 `ph-1dnjs/checkly`로 `package.json`에 고정되어 있습니다.

## CI/CD (`.github/workflows/release.yml`)

`v*.*.*` 형태의 태그를 push하면 macOS/Windows/Linux 3개 러너에서 각각 `npm ci → npm run build → electron-builder --publish always`를 실행해 GitHub Releases에 자동 업로드합니다. `GH_TOKEN`은 워크플로 기본 `secrets.GITHUB_TOKEN`을 사용하며 별도 PAT는 필요 없습니다(같은 저장소에 release를 쓰는 `contents: write` 권한만 있으면 됩니다). 코드 서명용 `CSC_LINK`/`CSC_KEY_PASSWORD`/`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`/`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`는 워크플로에 env로 연결되어 있으나 값을 설정하지 않으면 electron-builder가 서명을 건너뜁니다. `workflow_dispatch`로 수동 실행도 가능합니다.

새 버전 릴리즈 절차:

```bash
npm version patch   # package.json 버전을 올리고 태그를 만듭니다
git push --follow-tags
```

## 앱 업데이트

`main.ts`는 패키지된 앱이 시작될 때 `electron-updater`로 즉시 한 번 확인하고, 이후 4시간(`UPDATE_CHECK_INTERVAL_MS`)마다 주기적으로 다시 확인합니다. 이 주기 확인은 `userData/update-settings.json`의 `autoCheck` 값이 꺼져 있으면 건너뜁니다. 확인·다운로드·에러 상태는 `update:status` 이벤트로 렌더러에 전달되어 설정 화면에 표시됩니다. 다운로드가 끝나면(`autoDownload`가 기본 켜져 있어 자동으로 받습니다) 설정 화면에 "재시작하여 설치" 버튼이 나타나고, 클릭하면 `autoUpdater.quitAndInstall()`이 실행됩니다. 설정 화면의 "지금 확인"은 `autoCheck` 값과 무관하게 언제든 수동으로 확인을 트리거합니다.

개발(미패키지) 빌드에서는 모든 업데이트 확인이 `not-available`로 즉시 반환되고 `electron-updater`를 실제로 호출하지 않습니다.

## 사용자 다운로드

설정 화면의 "다운로드 페이지 열기"는 `https://github.com/ph-1dnjs/checkly/releases/latest`를 외부 브라우저로 엽니다(주소는 `SettingsPage.tsx`에 고정 문자열로 있습니다 — 저장소 이름이 바뀌면 함께 수정해야 합니다). 신규 사용자는 이 페이지에서 OS에 맞는 설치 파일(dmg/zip, nsis, AppImage)을 직접 받습니다.

## 릴리즈 전 확인

1. `npm run build`, `npm test`를 통과합니다.
2. `npm run package:dir`로 로컬에서 Chromium이 `app.asar.unpacked`에 포함되는지, 실행 파일이 정상 spawn되는지 확인합니다.
3. 서명·공증 secrets을 채웠다면 실제 `npm run package`(또는 태그 push)로 서명된 산출물을 확인합니다.
4. 이전 버전을 설치한 상태에서 새 태그를 배포해 자동 업데이트 확인 → 다운로드 → 재시작 설치가 끝까지 동작하는지 검증합니다.
5. userData 복원, 영상·리포트 생성, Downloads 복사를 확인합니다.

## 미확인 항목

- macOS Developer ID/notarization, Windows signing 인증서의 실제 발급·등록 여부
- Linux 배포 채널(AppImage 외 패키지 포맷, 스토어 배포)
- 롤백과 이전 버전 재게시 절차
- 오류·충돌 모니터링(크래시 리포터, 원격 로깅)
- 사용자 데이터 백업·schema migration
