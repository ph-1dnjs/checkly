# 시나리오 선택·실행

로그인한 프로젝트의 DB 문서를 읽고 시나리오 블록을 실행 큐로 전달한다. 폴더·파일 접근은 없다.

- [개요](01-overview.md)
- [사용자 흐름](02-userflow.md)
- [데이터·IPC](03-api.md)
- [예외 처리](04-edge-cases.md)

구현은 `ScenarioPickerPage`, `useScenarioState`, `useScenarioEnvironment`, `web-scenario/store.ts`에 있다.
