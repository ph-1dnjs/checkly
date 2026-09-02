# 개발 가이드

## 시나리오 액션 추가

1. `shared/model/scenario.ts`의 타입, label·표시·예상 시간 함수를 갱신합니다.
2. `parseMarkdown`과 `App.scenarioToMarkdown`을 함께 구현해 round-trip을 맞춥니다.
3. `ScenarioEditorPage`의 마커 입력을 추가합니다.
4. main의 `QaStep`, `inspectScenario`, `executeScenario`를 갱신합니다.
5. picker·run·report 표시와 테스트·문서를 확인합니다.

성공 기준은 Markdown → Scenario → Markdown에서 의미가 유지되고 inspect와 실제 실행의 target 규칙이 일치하는 것입니다.

## 새 IPC 추가

1. 권한이 필요한 동작을 `main.ts`에 구현하고 `도메인:동작` 채널을 등록합니다.
2. `preload.ts`에 필요한 API만 노출합니다.
3. `App.tsx`의 `Window.electronAPI` 타입을 맞춥니다.
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

현재 E2E 파일은 단계 삭제 후 번호 재정렬, Markdown 저장, 수동 입력 재개와 값 미노출, marker 값 수정·미연결 재연결을 검증하도록 작성되어 있습니다. 다만 테스트가 기대하는 localStorage fallback과 브라우저용 Electron API mock은 renderer 코드에서 확인되지 않으므로 실제 통과 여부를 확인해야 합니다.

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
