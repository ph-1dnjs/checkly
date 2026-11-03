# IPC·데이터·보존

## IPC (`window.electronAPI.aiTc`)

| 메서드 | 채널 | 설명 |
| --- | --- | --- |
| `importWorkbook()` | `ai-tc:import` | 파일 선택 → `{ workbook }` 또는 `{ error }`, 취소 시 `null` |
| `prepare()` | `ai-tc:prepare` | 선택 TC의 입력 데이터 생성 및 임시 PNG·텍스트 업로드 파일 생성 |
| `pickUpload()` | `ai-tc:pick-upload` | 업로드 파일 선택 → `{ token, name }`. 경로는 main에만 둠 |
| `exportResult(runId)` | `ai-tc:export` | 끝난 실행을 .xlsx(요약·실패 상세·TC 결과·기대 결과·동작 이력)로 저장 |
| `openFolder(runId)` | `ai-tc:open-folder` | 산출물 폴더 열기 |
| `tools()` | `ai-tc:tools` | 설치된 CLI(`claude`·`codex`)와 버전 |
| `start(plan)` | `ai-tc:start` | zod로 계획 검증 후 실행 시작. 실행 중이면 거부 |
| `decide(runId, decision, reply?)` | `ai-tc:decide` | 대기 조치와 일반 인계의 선택 답변을 전달 |
| `browserEvent(runId, event)` | `ai-tc:browser-event` | 대기 중 같은 페이지의 클릭·입력·스크롤·탐색 |
| `cancel(runId)` | `ai-tc:cancel` | 취소(멱등) |
| `review(input)` | `ai-tc:review` | 결과 판정 수정·이유 |
| `capture(runId, captureId)` | `ai-tc:capture` | 근거 캡처 data URL |
| `current()` | `ai-tc:current` | 마지막 실행 상태(화면 재진입용) |
| `onState` / `onPreview` | `ai-tc:state` / `ai-tc:preview` | 실행 상태 전체, 실시간 화면(캡처 켬일 때만) |

결과 엑셀의 요약은 TC별 집계 판정 건수를 표시합니다. 실패 상세는 Fail로 판정된 기대 결과마다 TC 출처·제목·사유와 시나리오 ID·사전 조건·테스트 단계, 실제 관찰, 근거, 관련 실패 동작과 캡처 파일명을 담습니다. 캡처 파일 자체는 엑셀에 포함되지 않고 산출물 폴더에 남습니다. 각 시트는 헤더 고정과 필터를 제공하며 판정은 색상으로 구분합니다.

## 모델 호출

- Claude Code: `claude -p --output-format json --no-session-persistence --restricted --strict-mcp-config --tools "" --permission-mode default`. 캡처를 보낼 때만 `--tools Read`로 실행 폴더의 `screen.jpg` 한 장을 읽게 합니다.
- Codex: `codex exec --json --skip-git-repo-check [-i screen.jpg] --sandbox read-only -`.
- 프롬프트는 stdin. 호출당 120초 제한. 모델에는 TC 원문·데이터 입력값·업로드 파일 이름·URL·제목·접근성 트리(비밀번호·토큰 칸 값은 가림)만 보냅니다.

## 로컬 산출물

`userData/ai-tc/runs/<시각>-<runId 앞 8자리>/`

| 파일 | 내용 |
| --- | --- |
| `result.json` | 실행 상태 전체(판정·근거·동작 이력·환경). TC가 끝날 때와 판정 수정 때마다 덮어씀 |
| `cap-NN.jpg` | 판정 근거 캡처 |
| `screen.jpg` | 마지막 관찰 화면(모델 전송용) |
| `video/*.webm` | 영상 기록을 켰을 때 임시 저장. 결과 화면에서 별도 다운로드할 수 있으며 다음 실행 또는 앱 정상 종료 시 원본 삭제 |

보존 기간·자동 삭제·암호화와 앱 안 과거 실행 목록은 아직 없습니다. 앱을 다시 켜면 결과 화면은 비어 있고 파일만 남습니다. 저장 실패는 결과 화면에 표시합니다.
