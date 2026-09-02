# Quick Start

이 문서는 Checkly를 로컬에서 실행하고 변경 사항을 검증하는 최소 절차를 안내합니다.

## 사전 요구 사항

| 항목       | 기준                                                          |
| -------- | ----------------------------------------------------------- |
| Node.js  | 버전은 저장소에서 고정하지 않음; Electron 37과 npm lockfile 기준으로 호환 버전을 사용 |
| npm      | `package-lock.json` 사용                                      |
| Chromium | `npm install` 후 `postinstall`이 Playwright Chromium 설치       |
| Git | 저장소 접근이 가능한 버전 |

Node.js의 `engines`, `.nvmrc`, Volta 설정은 현재 저장소에 없습니다. 팀 표준 버전이 있다면 그 값을 우선 사용합니다.

## 설치와 실행

```bash
cp .env.example .env
npm install
npm run dev
```

개발 모드는 두 프로세스를 병렬로 실행합니다.

1. Vite가 `src/renderer`를 `http://127.0.0.1:5173`에서 제공합니다.
2. `wait-on`이 개발 서버를 기다립니다.
3. `tsx watch`가 `src/app/main.ts`를 실행해 Electron 창을 엽니다.

빌드본을 실행하려면 다음 명령을 사용합니다.

```bash
npm start
```

`npm start`는 매번 `npm run build`를 먼저 실행한 뒤 `electron .`을 시작합니다.

## 환경 변수

| 변수 | 필수 | 용도 | 렌더러 노출 |
| --- | --- | --- | --- |
| `GH_OWNER` | 업데이트 게시 시 | GitHub Releases 소유자 | 아니오 |
| `GH_REPO` | 업데이트 게시 시 | GitHub Releases 저장소 | 아니오 |
| `GH_TOKEN` | 게시 셸·CI에서만 | GitHub Releases 인증 | 아니오 |
| `VITE_DEV_SERVER_URL` | 개발 스크립트가 자동 설정 | Electron이 로드할 Vite URL | main 프로세스에서 사용 |

> **WARNING**: `VITE_` 접두 변수는 일반적으로 렌더러 번들에 포함될 수 있으므로 비밀값에 사용하지 않습니다. `GH_TOKEN`은 커밋하지 않습니다.

## 자주 쓰는 명령

| 목적 | 명령 | 실제 동작 |
| --- | --- | --- |
| 개발 실행 | `npm run dev` | Vite와 Electron main 동시 실행 |
| 렌더러·Electron 빌드 | `npm run build` | `vite build` 후 Electron TypeScript 컴파일 |
| 빌드본 실행 | `npm start` | 빌드 후 Electron 실행 |
| 렌더러 preview | `npm run preview` | 기본 포트 `4173` |
| E2E 테스트 | `npm test` | Playwright Chromium 프로젝트 실행 |
| 테스트 UI | `npm run test:ui` | Playwright UI 모드 |
| 설치 파일 생성 | `npm run package` | `.env` 로드 후 electron-builder 실행 |
| 패키지 디렉터리 생성 | `npm run package:dir` | 설치 파일 없이 unpacked 앱 생성 |

별도 lint나 format 스크립트는 현재 없습니다.

## 변경 후 최소 검증

```bash
npm run build
npm test
```

- `npm run build`는 렌더러의 strict TypeScript 검사와 Electron main/preload 컴파일을 함께 검증합니다.
- `npm test`는 Vite preview 서버에서 렌더러 UI를 검증하도록 구성되어 있습니다. 현재 E2E는 이전 화면 heading·버튼과 localStorage fallback을 기대해 2건 모두 실패하므로, 테스트와 현재 UI·Electron API mock의 정합성 복구가 필요합니다.
- native dialog, 실제 파일 저장, Electron IPC, Playwright 대상 사이트 실행, 영상 병합은 브라우저 E2E만으로 완전히 검증되지 않으므로 관련 변경 시 `npm run dev`에서 수동 확인합니다.

## 처음 확인할 흐름

1. 앱이 열리면 하단의 **편집기**로 이동합니다.
2. Markdown 시나리오를 수정하고 파싱된 단계가 갱신되는지 확인합니다.
3. **시나리오 선택**에서 폴더를 선택하거나 편집기 실행 버튼을 사용합니다.
4. 실행 화면에서 진행률·로그·미리보기를 확인합니다.
5. 완료 후 실행 기록에서 리포트 서랍과 재실행을 확인합니다.
