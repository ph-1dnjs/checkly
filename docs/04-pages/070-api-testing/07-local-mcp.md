# 로컬 MCP

API 테스트 → **AI 작성 도우미** → **MCP로 연결** 탭에서 설정한다. MCP를 못 쓰는 AI는 옆 **가이드 복사** 탭을 쓴다. Node.js 18 이상이 필요하고 Windows 명령은 PowerShell 기준이다.

1. **MCP 연결 켜기**: 화면 위 **API 환경**에서 고른 환경으로 연결한다. 화면에서 환경을 바꾸면 연결도 그 환경으로 바뀌고(주소·토큰 새로 만듦), 이전 환경 기준 `run_scenario`는 거부된다. 연결 중이면 상단에 **MCP 연결 중 · 환경** 표시가 보인다. 클라이언트가 처음 연결할 때 앱 MCP가 켜져 있어야 한다. 켜 둔 연결은 앱을 다시 열어도 같은 프로젝트·환경으로 자동으로 켜진다. 사용자가 **끄기**를 누르면 다음에도 꺼진 채로 열린다.
2. **처음 한 번: AI 클라이언트에 등록** (연결 중이면 접혀 있음): 클라이언트를 고르고 설정을 복사해 등록한다.
   - Claude Code (기본 선택): 터미널에서 `claude mcp add --scope user checkly -- node '<앱 데이터>/api-testing/mcp/checkly-mcp.cjs' --connection '<OS 설정 폴더>/checkly-mcp/connection.json'`. 사용자 범위라 모든 폴더와 Claude 데스크톱 앱의 Code 탭에서 쓴다.
   - Codex: 터미널에서 `codex mcp add checkly -- node …` (같은 인자)
   - 기타(JSON): 설정 JSON(`mcpServers.checkly`의 command/args)을 클라이언트 설정에 추가한다. 예: Claude 데스크톱 앱 채팅은 `claude_desktop_config.json`.
3. **AI 클라이언트를 다시 열고 사용**: Claude Code는 새 세션에서 `/mcp`로 연결을 확인한다.

앱이 실제 경로를 채워 준다. npm 배포 패키지를 다운로드하지 않으며 앱에 포함된 연결 프로그램을 로컬에 준비한다. Node가 클라이언트의 PATH에 없으면 command를 Node 실행 파일의 절대 경로로 바꾼다.

설치 명령이나 AI 설정은 다시 바꾸지 않는다. 앱을 끈 상태에서 클라이언트가 최초 연결에 실패했다면 앱에서 MCP를 켠 후 클라이언트의 MCP 연결을 다시 시작한다. 이미 연결된 stdio 프로세스는 요청마다 접속 정보를 읽으므로 HTTP 주소·토큰 변경을 자동 반영한다. 실패한 쓰기/실행 요청은 중복 실행을 피하기 위해 자동 재전송하지 않는다.

고급 설정의 HTTP 직접 연결도 유지한다. 직접 연결은 이전과 같이 주소·토큰 변경 시 클라이언트 설정 갱신이 필요하다.

- 처음에는 꺼져 있다. 켠 연결은 앱 데이터의 `api-testing/mcp/auto-start.json`에 프로젝트·환경 ID만 기억하고(토큰 없음) 다음 실행 때 다시 켠다. 사용자가 끄면 이 파일을 지운다. 앱 종료·로그인 변경은 연결을 끊지만 기억은 유지하며, 로그인 변경 후 새 로그인에서 보이는 프로젝트면 다시 연결한다. 다시 켤 때마다 주소·토큰은 새로 만든다.
- OS 사용자 설정 폴더의 `checkly-mcp/connection.json`에 활성 연결의 주소와 임시 토큰을 원자적으로 기록한다. POSIX 파일 권한은 0600, 디렉터리는 0700이다. 같은 OS 사용자 권한을 가진 로컬 연결 프로그램이 읽으며 Codex 설정이나 팀 DB에는 토큰을 넣지 않는다. Windows는 사용자 프로필 디렉터리 ACL을 따른다.
- 연결을 끄거나 앱을 정상 종료하면 접속 정보 파일을 제거한다. 남은 파일은 PID 대신 인증된 MCP 초기화 응답으로 확인한다. 접속 거절·다른 서비스·토큰 거부(401·403)이면 교체하고, 시간 초과이면 보존하고 파일 경로를 안내한다. 깨진 JSON은 `.corrupt-<식별자>`로 보관한 뒤 복구한다. 확인 중 파일이 바뀌면 보존한다.
- `packages/checkly-mcp/bin/checkly-mcp.cjs`는 외부 의존성 없는 stdio 어댑터이며 배포 앱에도 포함한다. 연결 설정을 열 때 앱 데이터에 최신 버전을 준비하므로 저장소 경로에 의존하지 않는다. stdout은 MCP 메시지 전용이며 연결 오류에 토큰·내부 경로를 노출하지 않는다.

- `127.0.0.1`에만 바인딩하며 Host·Origin·Bearer 인증을 검사한다. 브라우저 Origin 요청은 허용하지 않는다.
- 연결 하나에 프로젝트·환경 하나만 허용한다. 다른 프로젝트·환경은 앱에서 끄고 다시 선택한다.
- 로그인 변경·앱 종료·연결 끄기는 MCP 실행을 취소하고 연결과 실행 기록을 제거한다.
- 기존 `ApiWorkspace`를 공유한다. 시나리오 수정 충돌 검사, 팀 권한, 프로젝트별 실행 잠금도 기존 정책을 따른다. DB 변경 없음.
- SDK는 첫 요청에 로드한다. 요청 최대 256KB, 반환 JSON 최대 240,000자, 시나리오 YAML 최대 200,000자다. 목록은 `list_apis`로 가볍게 훑고 상세 스키마는 필요한 API만 `get_api_spec`으로 조회한다. 서버가 하나인 프로젝트는 `serverId`를 생략할 수 있다.

## 도구

| 도구 | 동작 |
| --- | --- |
| `get_context` | 허용 프로젝트·환경·서버, 전역변수 이름/타입·값 존재 여부(`hasValue`)와 만드는(extract)·쓰는 시나리오 이름. 값은 주지 않음 |
| `list_apis` | 메서드·경로·태그·요약만, 한 번에 최대 200개(`nextOffset`). `query` 키워드(경로·요약·태그, 모두 포함)·`tag` 필터. 필터가 없으면 태그별 개수도 준다 |
| `get_api_spec` | `apis: ['METHOD /path']`로 지정한 API(최대 20개)의 파라미터·요청/응답 스키마. 없는 API는 `notFound` |
| `list_scenarios` | 목록과 요약(설명·단계 수·사용 API·만드는 전역변수). `query` 키워드로 비슷한 시나리오 찾기. 본문 제외 |
| `get_scenario` | 개별 YAML·수정 버전 |
| `delete_scenario` | 삭제. 앱에 확인 창이 뜨고 사용자가 **삭제**를 눌러야 지운다. 45초 무응답·취소·연결 종료 시 지우지 않음. `expectedUpdatedAt` 필요 |
| `validate_scenario` | 저장 없이 형식·명세·실행 준비 검사. YAML·참조 문법 오류도 도구 오류 대신 `valid: false`와 `issues`로 반환 |
| `save_scenario` | 생성 또는 수정. 수정 시 기존 id·expectedUpdatedAt 필요. 저장 대기 중 연결이 끝나면 저장하지 않음 |
| `run_scenario` | 저장된 시나리오 실행, 즉시 runId 반환. `get_context`의 projectId·environmentId가 현재 연결과 다르면 거부 |
| `get_run` | 상태·HTTP 상태·시간·실패 종류·검증 성공 여부 |
| `cancel_run` | 이 연결에서 시작한 실행만 취소 |

외부 AI가 실행 중에 사용자에게 값을 물어보는 대화 기능은 없다. 필요한 입력은 `run_scenario.inputs`로 제공하며 빠진 필수값은 기존 실행기의 입력 실패로 처리한다. 실행 결과의 본문·헤더·변수·검증 실제 값·원문 오류는 반환하지 않는다. 단, `get_scenario`의 저장된 YAML과 명세 설명에는 사용자가 직접 넣은 값이 포함될 수 있으므로 자격 증명은 `globals` 또는 `inputs`로 참조한다.

시나리오 생성은 자동으로 현재 편집 중인 초안을 덮어쓰지 않는다. 앱의 시나리오 목록을 다시 열어 저장 결과를 확인한다. MCP 실행 결과는 현재 연결에서 최대 30개 요약을 보관한다. 같은 실행의 전체 결과(요청·응답 원문 포함)는 앱의 시나리오 화면 "최근 실행"에 **외부 AI(MCP)** 표시와 함께 남아, AI가 받지 못하는 실패 원인을 사람이 앱에서 확인한다. 앱 화면처럼 새로고침하면 사라진다.

## 검증 명령

- `npx tsx --test tests/api-testing/mcp.test.ts tests/api-testing/workspace.test.ts`
- `npm run build` 후 `npx tsx tests/api-testing/mcp.desktop.e2e.ts` (Electron E2E 준비용 빌드)

공용 의존성에 공식 `@modelcontextprotocol/sdk`를 추가한 것은 실제 MCP 클라이언트와의 Streamable HTTP 프로토콜 호환을 위한 것이다. API 키나 AI 모델 호출은 추가하지 않는다.

## 독립 패키지

`packages/checkly-mcp`는 별도 package.json과 `checkly-mcp` bin을 가진 로컬 설치용 패키지다. `npm pack ./packages/checkly-mcp`로 배포 파일을 만든 뒤 `npm install -g ./checkly-local-api-testing-mcp-0.1.0.tgz`로 설치하고, `codex mcp add checkly -- checkly-mcp`로 등록한다. npm 공개 배포는 하지 않았다. 자세한 탐색 경로·다른 클라이언트 설정은 [패키지 README](../../../packages/checkly-mcp/README.md)를 참고한다.

IPC는 끄기 요청의 프로젝트가 현재 연결과 같은지 확인한다. 명세 응답에는 serverId와 serverName을 함께 제공한다.
