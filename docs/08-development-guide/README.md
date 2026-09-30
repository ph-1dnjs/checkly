# 개발 가이드

병렬 작업과 커밋·병합 절차는 [협업 가이드](./collaboration.md)를 참고합니다.

## 시나리오 액션 추가

1. `src/renderer/shared/model/action.ts`의 Action·label과 `scenario.ts`의 표시·예상 시간 함수를 갱신합니다.
2. `parseMarkdown`과 `useScenarioState.ts`의 `scenarioToMarkdown`을 함께 구현해 round-trip을 맞춥니다.
3. `ScenarioEditorPage`의 마커 입력을 추가합니다.
4. `src/app/ipc/qaTypes.ts`의 QaStep과 `qaExecution.ts`의 inspectScenario/executeScenario를 갱신합니다.
5. picker·run·report 표시와 테스트·문서를 확인합니다.

새 액션의 성공 기준은 Markdown → Scenario → Markdown에서 지원 필드가 유지되고 inspect와 실행의 target 규칙 차이가 명시되는 것입니다. 기존 구현의 fill/select 대기 직렬화와 select 연결 검사에는 차이가 있으므로 [편집 제한](../04-pages/020-scenario-editor/04-edge-cases.md)을 기준으로 회귀를 확인합니다.

## 새 IPC 추가

1. 권한이 필요한 동작을 해당 `src/app/ipc` 서비스에 구현하고 `main.ts`에 `도메인:동작` 채널을 등록합니다.
2. `preload.ts`에 필요한 API만 노출합니다.
3. `src/renderer/shared/model/electron-api.ts`의 `Window.electronAPI` 타입을 맞춥니다.
4. 호출부에서 성공·취소·실패를 구분합니다.
5. 경로·외부 입력은 main에서 검증합니다.
6. [IPC 문서](../07-api/README.md)를 갱신합니다.

## 새 화면 추가

1. `pages/{기능}`에 named-export 페이지를 만듭니다.
2. `Route` union과 App 조건 렌더링을 갱신합니다.
3. 필요하면 하단 탐색 또는 이동 버튼을 연결합니다.
4. 공유 상태는 App, 표시 상태는 페이지에 둡니다.
5. CSS와 `styles/index.css` import를 확인합니다.
6. `docs/04-pages`에 기능 문서 5개를 추가합니다.

## 저장·실행 변경

- 기본 원문과 사용자가 가져온 외부 파일은 별도 저장 대상입니다.
- marker key/matching을 바꾸면 기존 JSON 호환성을 확인합니다.
- userData 경로는 renderer에서 조립하지 않습니다.
- worker/context/Page의 생성·정리와 popup 활성 Page를 확인합니다.
- 수동 Promise는 성공·실패·timeout·취소에서 모두 해제합니다.
- 실패한 시나리오 뒤에도 큐를 계속 실행하는 현재 정책을 바꾸면 명시합니다.
- preview timer, 영상 finalize, 경로 검증, HTML escape를 확인합니다.

## 테스트

`tests/editor-empty-markdown.spec.ts`와 `tests/scenario-duplication.spec.ts`는 테스트 내부의 electronAPI mock으로 빈 원문·복제를 검사합니다. 기존 `tests/app.spec.ts`에는 localStorage fallback을 기대하는 시나리오가 있으므로 전체 E2E가 현재 구현을 모두 검증한다고 가정하지 않습니다. native 실행·파일 저장은 mock 테스트 범위 밖입니다.

```bash
npm run build
npm test
```

native dialog, userData 복원, 실제 locator·popup, 수동 timeout, WebM·ffmpeg·Downloads, 패키지 업데이트는 `npm run dev` 또는 패키지 앱에서 별도 확인합니다.

## 문서 점검

- 화면 기능: `docs/04-pages`
- parser·service: `docs/06-functions`
- IPC: `docs/07-api`
- 패키징: `docs/01-quick-start`, `09-deployment`

코드에 없는 정책을 문서만으로 추가하지 않습니다.
