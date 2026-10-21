# 데이터·IPC

`window.electronAPI.webScenarios.list()`가 현재 프로젝트의 문서 본문·마커·작성 정보를 한 번에 가져온다. `recordScenarios`는 UUID를 파서 source로 넘겨 블록 ID를 생성하고 마커를 결합한다.

`auth.getProjectSettings()`로 환경을 읽는다. 인증, RLS, 저장 충돌, 비로그인 정책은 [편집 저장 정책](../020-scenario-editor/03-api.md)을 따른다. 기존 `scenario:list-folder`, `scenario:choose-folder`, `scenario:read-file` 채널은 제거됐다.
