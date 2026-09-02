# 코드 컨벤션

이 문서는 현재 TypeScript/React 코드와 설정에서 확인한 관례를 정리합니다. 새로운 규칙을 제안하지 않으며, 명시적 요구가 없으면 변경 대상과 가장 가까운 코드의 스타일을 우선합니다.

## 적용 우선순위

1. 사용자 요구사항
2. 저장소에 제공된 `AGENTS.md` 지침
3. TypeScript·Vite·Playwright 설정
4. 이 문서
5. 인접 코드의 현재 패턴

관련 없는 리팩터링, 이름 변경, 파일 이동, 포맷 통일을 함께 수행하지 않습니다.

## 기본 관례

| 항목          | 현재 관례                                        |
| ----------- | -------------------------------------------- |
| 언어          | TypeScript, `strict: true`, ES2022           |
| 렌더러 모듈      | ESNext/Bundler resolution                    |
| Electron 모듈 | CommonJS/Node resolution                     |
| 컴포넌트        | PascalCase 파일·named export                   |
| 타입          | 관련 모듈 상단 또는 `shared/model/scenario.ts`       |
| 스타일         | `src/renderer/styles/` CSS, 동적 위치·색만 inline |

자동 포맷터나 ESLint 설정은 없습니다. 기존 파일에는 작은따옴표·세미콜론 사용 방식이 혼재하므로 수정 파일의 형식을 유지합니다.

## import와 프로세스 경계

- 상대 import를 사용하며 path alias와 barrel export는 없습니다.
- 타입만 가져오면 `import type`을 사용합니다.
- renderer는 Node.js·Electron·Playwright를 직접 import하지 않습니다.
- main/preload는 renderer 컴포넌트나 DOM 코드를 import하지 않습니다.
- native 기능은 `main.ts` → `preload.ts` → `App.tsx`의 `electronAPI` 타입과 호출부를 함께 변경합니다.
- renderer에 raw `ipcRenderer`, 파일 API, Playwright 객체를 노출하지 않습니다.

## 파일 배치

| 위치 | 대상 |
| --- | --- |
| `src/app/main.ts` | BrowserWindow, IPC, 파일·Playwright·ffmpeg 서비스 |
| `src/app/preload.ts` | 허용할 command와 event 구독 |
| `src/renderer/app/App.tsx` | 화면 조립, 공유 상태, 다중 실행 |
| `src/renderer/pages/{기능}` | 화면 UI와 화면 전용 상태 |
| `src/renderer/widgets` | 여러 화면 흐름에서 재사용하는 조합 UI |
| `src/renderer/shared/model` | 공통 타입, 순수 parser·formatter |
| `src/renderer/styles` | 전역·화면별 CSS |

`features`, `entities`는 현재 비어 있으므로 단일 변경을 위해 새 레이어를 도입하지 않습니다.

## 상태와 컴포넌트

- React 함수 컴포넌트와 named export를 사용합니다.
- 앱 공유 상태는 `App`, 화면 전용 표시 상태는 페이지가 소유합니다.
- 계산 값은 `useMemo` 또는 함수, 비동기 callback의 최신 제어 값은 `useRef`를 사용합니다.
- 외부 상태 관리 라이브러리를 단일 기능 때문에 추가하지 않습니다.
- CSS는 [DESIGN.md](../../DESIGN.md)의 토큰과 인접 화면 규칙을 따릅니다.

## 시나리오 모델 변경

action이나 필드를 추가할 때 다음을 함께 맞춥니다.

1. `Action`, `Step`, label·표시·예상 시간
2. `parseMarkdown` 파싱
3. `App.scenarioToMarkdown` 직렬화
4. 마커 편집 폼
5. main의 `QaStep`, `inspectScenario`, `executeScenario`
6. picker·run·report 표시
7. 테스트와 기능·함수 문서

파서와 직렬화가 비대칭이면 마커 모드에서 텍스트 모드로 돌아올 때 정보가 사라집니다.

## 오류·검증·문서

- renderer IPC 오류는 현재 3초 토스트로 안내합니다.
- QA 단계 오류는 실패 로그와 리포트로 정규화합니다.
- 취소는 `cancelled`로 실패와 구분합니다.
- 종료·캡처 경쟁 조건처럼 의도된 경우만 좁은 `catch`에서 무시합니다.

```bash
npm run build
npm test
```

페이지 기능, Markdown 문법, IPC, 저장 위치, 실행·오류 정책을 바꾸면 관련 개발 문서를 함께 갱신합니다.

