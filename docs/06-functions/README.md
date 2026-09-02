# 함수와 로직

| 이름 | 유형 | 위치 | 책임 |
| --- | --- | --- | --- |
| `parseMarkdown` | parser | `src/renderer/shared/model/scenario.ts` | Markdown 시나리오를 `Scenario[]`로 변환 |
| `actionText` | formatter | `src/renderer/shared/model/scenario.ts` | 단계의 표시 문자열 생성 |
| `estimateDurationSeconds` | estimator | `src/renderer/shared/model/scenario.ts` | 단계 유형별 예상 시간 합산 |
| `executeScenario` | service | `src/app/main.ts` | Playwright 실행, 진행 이벤트, 리포트·영상 처리 |
| `inspectScenario` | service | `src/app/main.ts` | 대상 페이지에서 단계 대상 존재 여부 확인 |
| `mergeRunVideos` | service | `src/app/main.ts` | 허용된 실행 영상만 ffmpeg로 병합 |

`parseMarkdown`은 제목(`시나리오:` 또는 `Scenario:`), `url:`, Given/When/Then/And 형태를 읽습니다. 지원 액션은 이동, 입력, 파일 업로드, 수동 입력·제어·결과 확인, 클릭, 선택, 텍스트 확인입니다.

`executeScenario`의 부수 효과는 Chromium 실행, `userData` 파일 기록, IPC 이벤트 전송입니다. 렌더러는 IPC 결과를 화면 상태로 변환할 뿐 Playwright API를 직접 호출하지 않습니다.

