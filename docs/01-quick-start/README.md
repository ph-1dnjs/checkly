# Quick Start

## 사전 요구 사항

| 항목 | 기준 |
| --- | --- |
| Node.js | 버전은 저장소에서 고정하지 않음; Electron 37과 npm lockfile 기준으로 호환 버전을 사용 |
| npm | `package-lock.json` 사용 |
| Chromium | `npm install` 후 `postinstall`이 Playwright Chromium 설치 |

## 설치와 실행

```bash
cp .env.example .env
npm install
npm run dev
```

개발 모드는 Vite(`127.0.0.1:5173`)와 Electron main 프로세스를 함께 실행합니다. 빌드본을 실행하려면 `npm start`를 사용합니다.

## 환경 변수

| 변수 | 필수 | 용도 |
| --- | --- | --- |
| `GH_OWNER` | 업데이트 게시 시 | GitHub Releases 소유자 |
| `GH_REPO` | 업데이트 게시 시 | GitHub Releases 저장소 |
| `GH_TOKEN` | CI 또는 게시 셸에서만 | GitHub Releases 인증 |

> **WARNING**: `VITE_` 접두 변수는 렌더러 번들에 포함됩니다. 비밀값에 사용하지 않습니다.

## 자주 쓰는 명령

| 목적 | 명령 |
| --- | --- |
| 개발 실행 | `npm run dev` |
| 렌더러·Electron 빌드 | `npm run build` |
| 빌드본 실행 | `npm start` |
| E2E 테스트 | `npm test` |
| 설치 파일 생성 | `npm run package` |
| 패키지 디렉터리 생성 | `npm run package:dir` |

최소 검증은 `npm run build`와 `npm test`입니다. 테스트는 Vite preview 서버에서 렌더러 UI를 검증합니다.

