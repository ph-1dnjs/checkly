# [개요] 시나리오 선택

> **범위**: 저장 폴더 복원 또는 새 폴더 선택부터 단일·다중 실행 요청까지입니다.

폴더 경로는 `userData/scenario-folder.json`에 저장됩니다. main은 바로 아래의 `.md`, `.markdown`만 수정 시각 내림차순으로 반환하며 하위 폴더는 재귀 탐색하지 않습니다.

renderer는 모든 파일을 읽고 `parseMarkdown`한 뒤, 단계가 하나 이상인 Scenario를 가진 파일만 표시합니다. 파일별 Scenario 배열은 화면 메모리 cache에 둡니다.

선택 key는 `filePath::scenario.id`입니다. 실행 배열은 클릭 시간 순서가 아니라 파일 목록 순서와 각 파일의 시나리오 순서로 생성됩니다.

tag, 단계 수, connected 상태를 표시하고 펼치면 action과 target 설명을 보여 줍니다. picker는 `qa:inspect`를 하지 않으므로 connected는 parser 초기값입니다.

