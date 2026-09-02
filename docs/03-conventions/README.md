# 코드 컨벤션

현재 TypeScript/React 코드에서 확인한 관례만 정리합니다.

| 항목 | 현재 관례 |
| --- | --- |
| 언어 | TypeScript, `strict: true`, ES2022 |
| 렌더러 모듈 | ESNext/Bundler resolution |
| Electron 모듈 | CommonJS/Node resolution |
| 컴포넌트 | PascalCase 파일·named export |
| 타입 | 관련 모듈 상단 또는 `shared/model/scenario.ts` |
| 스타일 | 컴포넌트 내부 style이 아닌 `src/renderer/styles/` CSS |

상대 import를 사용하며 path alias나 barrel export는 없습니다. JSX에서는 큰 화면 컴포넌트가 props callback으로 `App`의 상태 변경을 위임받는 방식이 주로 쓰입니다.

## 배치 기준

- 새 앱 경계/IPC handler는 `src/app/`에 둡니다.
- 화면 단위 UI는 `src/renderer/pages/{기능}/`에 둡니다.
- 둘 이상의 화면이 쓰는 UI만 `widgets/`로 올립니다.
- 시나리오 타입·파싱·표시 함수는 `shared/model/scenario.ts`에 둡니다.
- Node.js·Playwright 객체는 렌더러에 직접 노출하지 않고 preload IPC를 추가합니다.

변경 전에는 `npm run build`, 가능하면 `npm test`를 실행합니다. 별도의 lint 스크립트와 브랜치·커밋 규칙은 저장소에서 확인되지 않았습니다.

