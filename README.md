# Checkly

Electron 기반 브라우저 QA 데스크톱 애플리케이션의 초기 구성입니다.

UI 작업은 [DESIGN.md](DESIGN.md)의 디자인 기준을 따릅니다.

## 기술 구성

- TypeScript + Electron
- React UI
- Playwright 브라우저 QA
- electron-builder 패키징 및 electron-updater 자동 업데이트
- Feature-Sliced Design: `app`, `pages`, `widgets`, `features`, `entities`, `shared`

## 시작하기

```bash
cp .env.example .env
npm install
npm run dev
```

## 명령어

```bash
npm test          # Playwright 테스트
npm run build     # 렌더러와 Electron 프로세스 빌드
npm run package   # 설치 파일 생성
```

## 환경 변수와 보안

`.env`는 Git에서 제외됩니다. 토큰, API 키 등 비밀값은 이 파일 또는 CI의 비밀 변수에만 설정하세요. `VITE_` 접두사가 붙은 값은 렌더러 번들에 포함되므로 비밀값에 사용하면 안 됩니다.

GitHub Releases로 업데이트를 발행할 때는 CI 비밀 변수 `GH_TOKEN`을 사용합니다. 저장소 정보는 `.env`의 `GH_OWNER`, `GH_REPO`로 설정하며, `npm run package`가 이를 electron-builder에 전달합니다.
