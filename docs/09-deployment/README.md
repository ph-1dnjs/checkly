# 배포

> **WARNING**: CI 워크플로와 실제 Release 발행 절차는 저장소에서 확인되지 않았습니다.

## 확인된 패키징

```bash
npm install
npm run build
npm run package
```

`electron-builder`는 `release/`에 설치 산출물을 생성하며 macOS는 dmg/zip, Windows는 nsis, Linux는 AppImage를 대상으로 합니다. GitHub publish 설정은 `GH_OWNER`, `GH_REPO`를 사용합니다.

자동 업데이트 확인은 패키지 앱에서만 `autoUpdater.checkForUpdatesAndNotify()`를 호출합니다. 게시 권한과 롤백 절차, 배포 후 모니터링 위치는 현재 저장소에서 미확인입니다.

