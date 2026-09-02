# Checkly

Checkly는 Markdown으로 브라우저 QA 시나리오를 작성하고 Playwright Chromium에서 실행하는 Electron 데스크톱 애플리케이션입니다. 단일·다중 시나리오 실행, 수동 입력·직접 제어·결과 판정, 실행 영상과 HTML/JSON 리포트 생성을 지원합니다.

> **현재 구현 기준**: 2026-09-02의 저장소 코드와 설정을 기준으로 합니다. 제품 정책이나 외부 서버 연동처럼 코드에서 확인되지 않은 내용은 개발 문서에서 미확인 또는 미구현으로 구분합니다.

## 핵심 기능

- Markdown 원문 편집과 파싱 결과 미리보기
- Markdown 파일 가져오기·저장·내보내기
- 대상 페이지 위 마커 추가·수정·정렬과 연결 상태 검사
- 폴더 내 `.md`, `.markdown` 파일 탐색과 다중 시나리오 선택
- 자동 단계와 수동 단계를 결합한 Playwright 실행
- 여러 시나리오의 순차 실행과 브라우저 context 재사용
- 실시간 진행률·JPEG 미리보기·실행 로그 표시
- 실행별 WebM 영상, 묶음 영상, HTML/JSON 리포트 생성
- 최근 5개 실행 기록 요약과 재실행

## 기술 구성

| 영역            | 기술                               | 역할                                               |
| --------------- | ---------------------------------- | -------------------------------------------------- |
| 데스크톱 런타임 | Electron 37                        | 창, native dialog, 파일 시스템, IPC, 자동 업데이트 |
| 렌더러          | React 19, React DOM                | 화면과 인메모리 상태 조립                          |
| 언어·빌드       | TypeScript 5.9, Vite 7             | 렌더러 번들 및 Electron 프로세스 컴파일            |
| 브라우저 자동화 | Playwright 1.55 Chromium           | 대상 탐색, 입력, 클릭, 선택, 확인, 영상 녹화       |
| 영상 처리       | `ffmpeg-static`                    | 다중 실행 WebM 영상 결합                           |
| 패키징·업데이트 | electron-builder, electron-updater | 설치 파일 생성과 GitHub Releases 업데이트 확인     |
| UI 검증         | Playwright Test                    | Vite preview 기반 렌더러 E2E                       |

소스는 `app`, `pages`, `widgets`, `shared` 경계를 사용합니다. `features`, `entities` 폴더는 현재 자리만 있고 구현 코드는 없습니다.

## 시작하기

```bash
cp .env.example .env
npm install
npm run dev
```

개발 모드는 Vite(`127.0.0.1:5173`)와 Electron main 프로세스를 함께 실행합니다. 빌드 후 앱을 실행하려면 `npm start`를 사용합니다.

## 주요 명령어

| 목적                  | 명령어                |
| --------------------- | --------------------- |
| 빌드 후 Electron 실행 | `npm start`           |
| 렌더러 E2E            | `npm test`            |
| Playwright UI 모드    | `npm run test:ui`     |
| 설치 파일 생성        | `npm run package`     |
| unpacked 패키지 생성  | `npm run package:dir` |

상세한 설치·구조·기능·IPC·배포 설명은 [개발 문서](docs/README.md)를 확인합니다. UI 변경은 [DESIGN.md](DESIGN.md)의 디자인 기준을 따릅니다.

## 환경 변수와 보안

`.env`는 Git에서 제외됩니다. `GH_OWNER`, `GH_REPO`는 GitHub Releases 게시 대상이며 `GH_TOKEN`은 게시 권한입니다.

> **WARNING**: `VITE_` 접두 환경 변수는 렌더러 번들에 포함됩니다. 토큰·API 키 등 비밀값에 사용하지 않습니다.

## 현재 확인된 제한

- 백엔드 HTTP API, 로그인, 계정·권한 기능은 없습니다.
- 실행 기록과 설정 토글은 앱 메모리에만 있어 재시작 시 초기화됩니다.
- 저장된 HTML/JSON 리포트를 앱 안에서 다시 여는 기능은 없습니다.
- 설정 화면의 브라우저 변경, 보관 기간, 알림, Slack 연동은 표시 전용입니다.
- CI 워크플로, 서명·공증, 실제 릴리즈·롤백 절차는 저장소에서 확인되지 않습니다.
