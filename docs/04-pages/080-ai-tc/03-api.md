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
| `replay(runId, assisted)` / `replaySaved(plan, assisted)` | `ai-tc:replay` / `ai-tc:replay-saved` | 현재 실행 또는 같은 TC·환경의 로컬 절차 재실행 |
| `savedNeeds(plan)` | `ai-tc:saved-needs` | 일치하는 저장 절차에서 데이터 항목 이름 조회. 값은 반환하지 않음 |
| `decide(runId, decision, reply?)` | `ai-tc:decide` | 대기 조치와 일반 인계의 선택 답변을 전달 |
| `browserEvent(runId, event)` | `ai-tc:browser-event` | 대기 중 같은 페이지의 클릭·입력·스크롤·탐색. 휠은 포인터 위치와 가로·세로 이동량을 전달 |
| `cancel(runId)` | `ai-tc:cancel` | 취소(멱등) |
| `review(input)` | `ai-tc:review` | 결과 판정 수정·이유 |
| `approveAssertion(input)` / `applyRepair(input)` | `ai-tc:approve-assertion` / `ai-tc:apply-repair` | 문구 검증 승인·취소 / 수정 후보 대상 임시 적용 |
| `onPrepareUsage` | `ai-tc:prepare-usage` | 준비 호출별 제공자 사용량 또는 미확인 |
| `capture(runId, captureId)` | `ai-tc:capture` | 근거 캡처 data URL |
| `current()` | `ai-tc:current` | 마지막 실행 상태(화면 재진입용) |
| `onState` / `onPreview` | `ai-tc:state` / `ai-tc:preview` | 실행 상태 전체, 실시간 화면(캡처 켬일 때만) |

결과 엑셀의 요약은 TC별 집계 판정 건수를 표시합니다. 실패 상세는 Fail로 판정된 기대 결과마다 TC 출처·제목·사유와 시나리오 ID·사전 조건·테스트 단계, 실제 관찰, 근거, 관련 실패 동작과 캡처 파일명을 담습니다. 캡처 파일 자체는 엑셀에 포함되지 않고 산출물 폴더에 남습니다. 각 시트는 헤더 고정과 필터를 제공하며 판정은 색상으로 구분합니다.

## 모델 호출

- Claude Code: `claude -p --output-format json --no-session-persistence --restricted --strict-mcp-config --tools "" --permission-mode default`. 캡처를 보낼 때만 `--tools Read`로 실행 폴더의 `screen.jpg` 한 장을 읽게 합니다.
- Codex: `codex exec --json --skip-git-repo-check [-i screen.jpg] --sandbox read-only -`.
- 프롬프트는 stdin. 호출당 120초 제한. 모델에는 TC 원문·데이터 입력값·업로드 파일 이름·URL·제목·접근성 트리(비밀번호·토큰 칸 값은 가림)만 보냅니다.
- 실행 중과 결과에 제공자가 보고한 입력·출력·캐시 토큰을 표시한다. Codex 캐시 읽기는 입력에 포함되며 Claude 캐시 읽기·생성은 별도다. 준비 사용량은 화면 세션 누계를 실행 시작 시 별도로 결과에 기록하며 실행 사용량에 합산하지 않는다. 선택하지 않은 TC의 준비·재시도도 포함될 수 있다. 결과가 없거나 Claude 캐시 정보가 누락된 호출은 미확인이다.
- 자동 준비는 최대 5개씩 요청하고 캐시에 없는 TC만 모델에 보낸다. 묶음 오류나 응답 누락은 작은 묶음으로 재시도하며 반환된 결과만 저장한다. 강제 재생성은 일반 캐시 요청과 분리한다.
- 가져오기 화면에서 AI 데이터 자동 준비를 끄면 준비 단계의 AI 호출을 건너뛴다. 저장된 절차의 데이터 항목을 불러온 뒤 필요한 값을 직접 입력해 빠른 실행을 선택할 수 있다.
- 실행 결과의 TC별 호출 기록에는 목적, 형식 재시도 순번, 프롬프트·접근성 트리 문자 수, 이미지 전송 여부, 사용량과 응답 사용·폐기·오류 및 사유를 기록한다. 준비 호출별 TC ID·요청 사유·완료/누락/오류·프롬프트 문자 수·사용량은 현재 화면 세션에 표시하고 준비 중이 아닐 때 초기화할 수 있다. 원문은 기록하지 않으며 문자 수는 토큰 수가 아니다.

## 로컬 산출물

`userData/ai-tc/runs/<시각>-<runId 앞 8자리>/`

| 파일 | 내용 |
| --- | --- |
| `result.json` | 실행 상태 전체(판정·근거·동작 이력·환경). TC가 끝날 때와 판정 수정 때마다 덮어씀 |
| `cap-NN.jpg` | 판정 근거 캡처 |
| `screen.jpg` | 마지막 관찰 화면(모델 전송용) |
| `video/*.webm` | 영상 기록을 켰을 때 임시 저장. 결과 화면에서 별도 다운로드할 수 있으며 다음 실행 또는 앱 정상 종료 시 원본 삭제 |

`userData/ai-tc/recordings/<해시>.json`에는 Pass인 TC별 동작·검증 조건을 저장한다. 함께 실행한 TC 중 하나를 다시 선택할 수 있지만 선행 확인 방식이 달라지면 일치하지 않는다. 해시는 TC 원문·환경 등으로 계산하며 입력값과 업로드 경로는 절차에 저장하지 않는다. 저장된 절차의 요소 이름·URL·검증 문구에는 화면 정보가 포함될 수 있다. 로드 시 형식을 검증하고 TC·환경이 일치하지 않으면 찾지 못한다. 입력 데이터 이름과 값은 실행 전에 별도 확인한다. 파일 자동 삭제·암호화는 없다.

보존 기간·자동 삭제·암호화와 앱 안 과거 실행 목록은 아직 없습니다. 앱을 다시 켜면 결과 화면은 비어 있지만 동일 TC·환경을 준비해 저장된 절차를 실행할 수 있습니다. 저장 실패는 상태에 표시합니다.
