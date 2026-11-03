# AI TC 실행 — 개발·정책 문서

> **범위·기준**: 2026-11-03 작업 트리. Excel TC를 가져와 AI가 Playwright Chromium을 관찰·조작해 기대 결과별로 판정하는 기능입니다. 목표 정책은 [AI 브라우저 TC 실행 정책안](../../ai-browser-tc-policy.md)이며, 이 문서는 그중 실제 구현된 동작과 구현하며 확정한 값을 적습니다.

## 문서 목록

1. [기능·실행 정책](01-overview.md)
2. [사용자 흐름·상태 전이](02-userflow.md)
3. [IPC·데이터·보존](03-api.md)
4. [예외 처리·제한·검증](04-edge-cases.md)

## 코드 근거

| 코드 | 책임 |
| --- | --- |
| [model.ts](../../../src/app/ipc/ai-tc/model.ts) | main·renderer 공용 순수 규칙: 열 매핑, 목록 분리, 행 오류, 선행 참조·정렬, 판정 집계, 허용 도메인, 상한 |
| [excel.ts](../../../src/app/ipc/ai-tc/excel.ts) | ExcelJS로 `.xlsx` 읽기, 병합·수식·숨김 처리 |
| [ai.ts](../../../src/app/ipc/ai-tc/ai.ts) | 프롬프트, Claude Code·Codex CLI 1회 호출, 응답 스키마 검증 |
| [runner.ts](../../../src/app/ipc/ai-tc/runner.ts) | 실행 루프, 사용자 대기, 도메인·팝업 제어, 캡처·결과 저장, 취소 |
| [index.ts](../../../src/app/ipc/ai-tc/index.ts), [bridge.ts](../../../src/app/ipc/ai-tc/bridge.ts) | IPC 등록·노출 |
| [useAiTc.ts](../../../src/renderer/app/hooks/useAiTc.ts) | 가져오기·선택·준비 검증·실행 계획·이벤트 구독·하단 버튼 |
| [pages/ai-tc](../../../src/renderer/pages/ai-tc/) | 가져오기·준비·실행·결과 화면 |
| [tests/ai-tc](../../../tests/ai-tc/) | `npm run test:ai-tc` — 규칙, 엑셀, headless Chromium + 가짜 모델 실행기 |
