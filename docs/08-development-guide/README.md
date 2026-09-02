# 개발 가이드

## 시나리오 액션 추가

1. `shared/model/scenario.ts`의 `Action`, `Step`, 표시·파싱 로직을 함께 갱신합니다.
2. `App`의 Markdown 직렬화와 편집 callback을 확인합니다.
3. `ScenarioEditorPage`의 마커 대화상자 입력을 추가합니다.
4. `main.ts`의 `executeScenario`와 `inspectScenario`에 실행·검사 동작을 추가합니다.
5. 실행 화면의 대기/실패 표시 및 기능 문서를 갱신합니다.

## 새 화면 추가

1. `pages/{기능}/`에 named-export 페이지를 만듭니다.
2. `Route` union과 `App`의 조건 렌더링, `BottomNavigation`을 필요한 경우 함께 수정합니다.
3. CSS를 관련 styles 파일에 추가하고 `index.css`의 import 관계를 확인합니다.
4. UI 흐름이 독립적이면 `04-pages/`에 기능 문서 다섯 개를 추가합니다.

## 검증

```bash
npm run build
npm test
```

Electron native 대화상자·Playwright 실행은 브라우저 E2E만으로 충분히 검증되지 않을 수 있으므로, 변경 시 개발 모드에서 해당 흐름을 수동 확인합니다.

