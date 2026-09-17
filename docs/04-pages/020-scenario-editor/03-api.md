# IPC·데이터·저장 정책

> **범위**: `useScenarioState` → `window.electronAPI` → preload → main → `fileStorage`/`qaExecution`. 외부 HTTP API가 아닌 Electron IPC 계약입니다.

## IPC 계약

| 공개 함수 / IPC | 입력 → 출력 | 시점·효과 |
| --- | --- | --- |
| loadScenarioMarkdown / `scenario:load` | 없음 → string 또는 null | 앱 시작, 기본 파일 읽기 |
| saveScenarioMarkdown / `scenario:save` | Markdown → void | 불러오기·명시 저장·마커 저장 |
| importScenarioFile / `scenario:import-file` | 없음 → `{markdown,filePath}` 또는 null | md/markdown 파일 dialog, main 활성 경로 변경 |
| saveImportedScenarioFile / `scenario:save-imported-file` | Markdown → path 또는 null | main의 활성 경로 덮어쓰기; 활성 경로 없으면 null |
| exportScenarioFile / `scenario:export-file` | Markdown → path 또는 null | 기본 이름 scenario.md로 저장 dialog; 성공하면 활성 경로 변경 |
| selectUploadFile / `qa:select-upload-file` | 없음 → path 또는 null | 업로드 파일 경로 선택; 파일을 앱 저장소로 복사하지 않음 |
| loadMarkerPositions / `marker-positions:load` | 없음 → JSON string 또는 null | 앱 시작 |
| saveMarkerPositions / `marker-positions:save` | JSON string → void | 로드 완료 후 좌표 store 변경 시 자동 저장 |
| inspectScenario / `qa:inspect` | Scenario → `{id,connected}[]` | 별도 headless 기본 URL 검사 |

브리지·등록 근거: [preload.ts](../../../src/app/preload.ts), [main.ts](../../../src/app/main.ts). `loadScenarioMarkdown`·`loadMarkerPositions`는 파일 없음과 권한 오류를 구분하지 않고 null로 반환합니다. 반면 `importScenarioFile`은 선택 파일의 읽기 실패를 reject하며, 쓰기도 reject합니다. dialog 취소는 null입니다.

## 메모리 모델

| 값 | 역할·수명 |
| --- | --- |
| sourceMarkdown | 현재 전체 원문; 실행 스냅샷·복제도 여기에 반영 |
| savedMarkdown | 마지막 성공한 로드/불러오기/저장 원문; dirty 비교 기준 |
| scenario | 현재 마커 편집 객체; sourceMarkdown과 별도로 변경 가능 |
| previews | 원문을 parseMarkdown한 Scenario 배열 |
| executableScenarios | previews에 좌표·occurrence 등을 재결합한 배열 |
| scenarioFilePath / activeScenarioFilePath | renderer/main의 활성 외부 파일 경로; 각각 메모리이며 재시작 시 소실 |
| positionStore / positionsLoaded | 전체 좌표 사전 / 초기 로드 완료 가드 |

`Scenario`는 id/title/url/steps와 선택 tag, `Step`은 id/action/target과 선택 필드 connected/value/prompt/required/condition/waitSeconds/occurrence/x/y/color를 가집니다. `connected`와 좌표는 실행 성공 여부나 클릭 실행 좌표가 아닙니다. 자동 실행은 target locator를 사용합니다.

## 영속 저장

모든 `userData` 경로는 Electron `app.getPath('userData')` 기준입니다. 프로젝트 디렉터리나 localStorage가 기준 저장소가 아닙니다.

| 데이터 | 파일·형식 | 쓰기·복원 정책 |
| --- | --- | --- |
| 기본 원문 | `userData/scenarios.md`, UTF-8 | 명시 저장/불러오기 때 전체 덮어쓰기. 앱 시작에 전체 원문과 첫 시나리오 복원 |
| 외부 원문 | 선택한 `.md`/`.markdown`, UTF-8 | 활성 경로가 있으면 덮어쓰기. 재시작 후 연결 복원 없음 |
| 마커 | `userData/marker-positions.json`, JSON | 로드 완료 이후 store 변경마다 전체 덮어쓰기 |
| 업로드 파일 | 사용자가 선택한 원래 경로 | 경로만 value에 기록. 파일 자체 관리·복사 없음 |

좌표 키는 `제목 + "\n" + URL`입니다. 각 항목에는 action, target, value, prompt, condition, waitSeconds, occurrence, x, y, color를 저장하며, x/y가 없는 단계는 저장 배열에서 제외합니다. 복원은 action/target/value/prompt/condition/waitSeconds가 같은 **첫 항목**을 찾아 occurrence/x/y/color를 덮어씁니다. 단계 ID·순서·occurrence는 매칭 키가 아닙니다. 같은 제목/URL이나 같은 속성의 반복 단계는 구분이 어려울 수 있습니다.

마커 편집 객체의 제목·URL 변경은 새 키를 만들며 기존 키의 정리 로직은 없습니다. 텍스트에서 제목·URL 또는 단계 매칭 속성을 바꾸면 이전 좌표와 매칭되지 않아 기본 pin 위치로 표시될 수 있습니다. 로드 완료 전에는 좌표 쓰기를 막지만, JSON 파싱 실패 후에도 finally에서 로드 완료로 전환되어 빈 store 기반 쓰기가 진행될 수 있습니다.

`JSON.parse` 후 타입 단언만 수행하고 좌표 사전의 구조·배열·수치 범위를 검증하지 않습니다. 문법상 유효한 JSON이라도 `null`이나 잘못된 항목 타입이면 복원·렌더링에서 오류가 날 수 있습니다.

외부 활성 경로는 renderer와 main에 각각 존재합니다. import는 **파일 읽기 전에** main의 경로를 바꾸므로 읽기에 실패하면 renderer는 이전 경로, main은 실패한 새 경로를 가리킬 수 있습니다. 저장 IPC는 renderer 경로를 전달받지 않고 main 경로를 사용합니다.

## 저장 일관성과 정보 취급

- 텍스트 저장은 **외부 파일 → 기본 파일**, 마커 저장은 **기본 파일 → 외부 파일** 순서입니다. 트랜잭션·롤백·원자적 교체·쓰기 직렬화·동시 편집 충돌 감지는 없습니다. 중간 실패 시 두 파일의 내용이 다를 수 있습니다.
- 좌표 파일은 독립 자동 저장입니다. 원문 미저장/저장 취소가 좌표 저장 취소를 뜻하지 않습니다.
- 원문 입력값과 업로드 절대 경로는 평문으로 저장됩니다. 좌표 JSON에도 value/prompt/condition 등 메타데이터가 들어갑니다. 별도 암호화·마스킹·자동 보존기한은 구현되어 있지 않습니다.
- 수동 입력의 실제 제출값은 원문으로 자동 반영하지 않습니다. 실행 화면 캡처·영상에 관한 제한은 [실행 저장 정책](../040-scenario-run/03-api.md)을 봅니다.
