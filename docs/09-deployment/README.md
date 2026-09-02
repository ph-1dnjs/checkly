# 배포

> **WARNING**: CI 워크플로, 코드 서명·공증, 실제 Release 승인·롤백·모니터링 절차는 저장소에서 확인되지 않았습니다.

## 빌드와 패키징

```bash
npm install
npm run build
npm run package
```

`npm run build`는 Vite renderer → `dist/`, main/preload CommonJS → `dist-electron/`을 만듭니다. `npm run package`는 `.env`를 로드하고 electron-builder를 실행해 `release/`에 산출물을 생성합니다. `package:dir`은 unpacked 앱을 만듭니다.

| 플랫폼 | target |
| --- | --- |
| macOS | dmg, zip |
| Windows | nsis |
| Linux | AppImage |

패키지에는 `dist/**`, `dist-electron/**`, `package.json`이 포함되고 `ffmpeg-static` binary는 asar 밖으로 unpack됩니다. appId는 현재 `com.example.checkly`입니다.

## GitHub Releases와 업데이트

publish 설정은 `.env`의 `GH_OWNER`, `GH_REPO`를 사용하고 인증은 shell/CI의 `GH_TOKEN`이 필요합니다. 토큰은 커밋하지 않습니다.

패키지 앱만 시작 시 `autoUpdater.checkForUpdatesAndNotify()`를 호출합니다. update event UI, 재시작 안내, 채널·강제 업데이트 정책은 없습니다.

## 릴리즈 전 확인

1. 실제 appId, version, 태그·asset 정책을 확인합니다.
2. owner/repo/token을 안전하게 주입합니다.
3. `npm run build`, `npm test`를 통과합니다.
4. 대상 OS에서 설치, Chromium, ffmpeg, native dialog를 확인합니다.
5. userData 복원, 영상·리포트 생성, Downloads 복사를 확인합니다.
6. 서명·공증과 Windows 신뢰 정책을 확인합니다.
7. 이전 패키지에서 새 버전 탐지·설치를 검증합니다.

## 미확인 항목

- CI/CD 실행 위치와 승인자
- macOS Developer ID/notarization, Windows signing
- Linux 배포 채널
- 롤백과 이전 버전 재게시
- 오류·충돌 모니터링
- 사용자 데이터 백업·schema migration

