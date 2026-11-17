<div align="center">

<img src="build/icons/icon.png" alt="Checkly 로고" width="96" height="96">

# Checkly

브라우저 시나리오와 API를 작성하고 실행하는 데스크톱 QA 도구

[개발 문서](docs/README.md) · [다운로드](https://github.com/ph-1dnjs/checkly/releases/latest) · [이슈 등록](https://github.com/ph-1dnjs/checkly/issues)

</div>

## 목차

- [소개](#소개)
- [주요 기능](#주요-기능)
- [요구 사항](#요구-사항)
- [설치](#설치)
- [빠른 시작](#빠른-시작)
- [사용법](#사용법)
- [설정](#설정)
- [문제 해결](#문제-해결)
- [기여하기](#기여하기)

## 소개

Checkly는 QA 작업을 돕는 Electron 데스크톱 애플리케이션입니다. Markdown 시나리오를 편집해 Playwright Chromium에서 실행하고, 진행 상황과 결과를 확인할 수 있습니다. API 테스트와 사이트를 직접 확인하는 화면 테스트도 제공합니다.

## 주요 기능

- **웹 시나리오** — Markdown과 화면 위 마커로 단계를 편집하고 자동·수동 단계를 실행합니다.
- **실행 결과** — 진행률과 미리보기를 확인하고 영상 및 HTML/JSON 리포트를 생성합니다.
- **API 테스트** — Swagger/OpenAPI 명세를 불러와 요청과 시나리오를 작성하고 실행합니다.
- **화면 테스트** — 웹뷰에서 폼 자동 입력, 네트워크 검사, 응답 오버라이드와 화면 캡처를 사용합니다.
- **AI TC 실행** — Excel 테스트 케이스를 가져와 AI와 Chromium으로 실행합니다.
- **팀 프로젝트** — 로그인한 프로젝트에서 시나리오와 실행 기록을 공유합니다.

기능별 동작과 제한은 [개발 문서](docs/04-pages/README.md)에서 확인할 수 있습니다.

## 요구 사항

앱 설치 파일은 macOS, Windows, Linux용으로 구성되어 있습니다. 소스에서 실행하려면 Node.js, npm, Git이 필요합니다. 저장소에 Node.js 버전은 고정되어 있지 않으며 CI는 Node.js 22를 사용합니다. 의존성 설치 시 Playwright Chromium도 다운로드합니다.

## 설치

[GitHub Releases](https://github.com/ph-1dnjs/checkly/releases/latest)에서 운영체제에 맞는 설치 파일을 받습니다. 빌드 설정의 대상은 macOS `.dmg`, Windows `.exe`, Linux `.AppImage`입니다. 릴리즈마다 제공되는 파일은 다운로드 페이지에서 확인해 주세요.

소스에서 개발하려면 저장소를 복제합니다.

```bash
git clone https://github.com/ph-1dnjs/checkly.git
cd checkly
```

## 빠른 시작

```bash
cp .env.example .env
npm install
npm run dev
```

개발 모드는 Vite와 Electron을 함께 실행합니다. 빌드 후 실행하려면 `npm start`를 사용합니다. 팀 서버 연결은 아래 [설정](#설정)을 참고하세요.

## 사용법

1. 웹 시나리오 편집기에서 Markdown 또는 마커로 테스트 단계를 작성합니다.
2. 실행할 시나리오를 선택하고 실행합니다. 수동 단계가 있으면 화면의 안내에 따라 진행합니다.
3. 실행 화면과 기록에서 결과를 확인합니다.

API 테스트와 화면 테스트 사용법은 각각 [API 테스트](docs/04-pages/070-api-testing/README.md), [화면 테스트](docs/04-pages/060-form-automation/README.md) 문서를 참고하세요. AI TC는 [AI TC 실행 문서](docs/04-pages/080-ai-tc/README.md)에 설명되어 있습니다.

### 개발 명령어

| 명령어                | 설명                                |
| --------------------- | ----------------------------------- |
| `npm run dev`         | 개발 서버와 Electron 실행           |
| `npm run build`       | 렌더러와 Electron 빌드              |
| `npm start`           | 빌드 후 Electron 실행               |
| `npm test`            | Playwright 렌더러 테스트            |
| `npm run test:api`    | API 테스트 관련 테스트              |
| `npm run package`     | 설치 파일 생성                      |
| `npm run package:dir` | 설치 파일 없이 패키지 디렉터리 생성 |

## 설정

개발 실행은 `.env`의 설정을 사용합니다. `.env.example`을 복사한 뒤 필요할 때 값을 설정하세요.

| 변수                        | 용도                                               |
| --------------------------- | -------------------------------------------------- |
| `CHECKLY_SUPABASE_URL`      | 개발용 팀 Supabase 주소                            |
| `CHECKLY_SUPABASE_ANON_KEY` | 개발용 Supabase 공개 anon 키                       |
| `CHECKLY_AUTH_EMAIL_DOMAIN` | 팀 로그인에 사용하는 가상 이메일 도메인            |
| `GH_TOKEN`                  | 로컬에서 GitHub Releases에 게시할 때 사용하는 토큰 |

개발 환경에서 Supabase를 설정하지 않으면 로컬 모드로 실행합니다. Supabase가 설정된 경우 웹 시나리오와 API 테스트의 팀 데이터는 로그인 후 사용할 수 있습니다. 패키지 앱은 별도 설정이 없으면 배포용 팀 서버 설정을 사용합니다. 자세한 내용은 [Supabase 가이드](docs/02-architecture/supabase-guide.md)와 [예제 환경 파일](.env.example)을 참고하세요.

`.env`와 비밀 토큰은 커밋하지 마세요. `VITE_` 접두 변수가 렌더러 번들에 포함될 수 있으므로 비밀값을 넣지 마세요.

## 문제 해결

<details>
<summary>macOS에서 앱을 열 수 없다는 메시지가 표시됩니다</summary>

서명·공증되지 않은 배포본은 Gatekeeper에 의해 차단될 수 있습니다. 신뢰할 수 있는 출처에서 받은 앱인지 먼저 확인하세요. 배포 및 확인 방법은 [배포 문서](docs/09-deployment/README.md)를 참고하세요.

</details>

<details>
<summary>팀 시나리오나 API 테스트에 로그인 안내가 표시됩니다</summary>

Supabase가 설정된 환경에서는 로그인한 프로젝트의 데이터를 사용합니다. 로그인 상태와 개발용 `.env` 설정을 확인하세요.

</details>

해결되지 않으면 [이슈](https://github.com/ph-1dnjs/checkly/issues)에 운영체제, 앱 버전과 재현 방법을 남겨 주세요.

## 기여하기

버그 제보, 문서 개선과 기능 제안을 환영합니다. 변경 전에 [코드 컨벤션](docs/03-conventions/README.md)과 [개발 가이드](docs/08-development-guide/README.md)를 확인해 주세요.

변경 후에는 관련 테스트와 다음 기본 검증을 실행합니다.

```bash
npm run build
npm test
```

Pull Request에는 변경 내용과 확인 방법을 적어 주세요.
