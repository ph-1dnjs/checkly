# Checkly API testing MCP

Checkly 데스크톱 앱의 API 테스트를 외부 AI에서 사용하는 독립 stdio 프로그램입니다. Node.js 18 이상이 필요하며 별도의 런타임 의존성은 없습니다. 프로젝트·명세·시나리오·실행 권한과 데이터는 실행 중인 Checkly 앱이 관리합니다.

## 현재 상태

로컬 패키지입니다. npm에 게시하지 않았으며 이름 `@checkly-local/api-testing-mcp`는 임시 이름입니다. 실수로 공개되지 않도록 `private: true`를 설정했습니다. 공개 배포 전 패키지 이름·소유권·라이선스를 정하고 이 설정을 변경해야 합니다.

## 로컬 설치

저장소 루트에서:

```sh
npm pack ./packages/checkly-mcp
npm install -g ./checkly-local-api-testing-mcp-0.1.0.tgz
```

설치 후 다른 디렉터리에서도 `checkly-mcp --help`로 사용법을 확인할 수 있습니다. 글로벌 npm 실행 경로가 클라이언트의 PATH에 있어야 합니다.

Codex 등록:

```sh
codex mcp add checkly -- checkly-mcp
```

다른 로컬 stdio MCP 클라이언트는 다음 command/args를 설정합니다. JSON을 받는 클라이언트는 기존 설정에 `checkly` 항목을 합칩니다.

```json
{
  "mcpServers": {
    "checkly": { "command": "checkly-mcp", "args": [] }
  }
}
```

Checkly → API 테스트 → AI 작성 도우미 → **MCP로 연결** 탭에서 **MCP 연결 켜기**를 누른 뒤 AI 클라이언트를 엽니다. 연결은 화면 위에서 고른 API 환경을 따릅니다. “checkly의 API 목록을 보여 줘”로 시작할 수 있습니다. 켜 둔 연결은 앱을 다시 열어도 자동으로 켜집니다. 토큰·포트 변경 때문에 재설치할 필요는 없습니다. 최초 연결 때 앱이 꺼져 있었다면 AI 클라이언트에서 MCP를 다시 연결하세요.

## 접속 정보 탐색

패키지 설치 위치나 현재 작업 디렉터리와 무관하게 OS 사용자 설정 폴더의 `checkly-mcp/connection.json`을 읽습니다.

- macOS: `~/Library/Application Support/checkly-mcp/connection.json`
- Windows: `%APPDATA%/checkly-mcp/connection.json`
- Linux: `$XDG_CONFIG_HOME/checkly-mcp/connection.json` (미설정 시 `~/.config`)

하나의 OS 사용자에서 Checkly 연결 하나를 사용합니다. 다른 실행 인스턴스의 활성 연결을 덮어쓰지 않습니다. 임시 접속 파일은 POSIX에서 0600이며 정상 종료·연결 해제 시 삭제합니다. 기존 주소에 토큰으로 인증한 MCP 초기화 요청을 보내 Checkly 식별 정보를 확인합니다. 접속이 거절되거나 다른 서비스인 경우 남은 파일을 교체합니다. 시간 초과·인증 실패는 기존 연결을 보존하고 안내합니다. 깨진 JSON은 `.corrupt-<식별자>` 파일로 보관하고 자동 복구합니다. 확인 중 파일이 바뀌면 교체하지 않고 다시 시도하도록 안내합니다.

격리된 테스트나 별도 프로필에서는 앱과 MCP에 동일한 `CHECKLY_MCP_CONNECTION_FILE` 절대 경로를 지정하거나 MCP 실행에 `--connection /absolute/path/connection.json`을 전달합니다. 기존 위치 인자도 호환됩니다.

연결 프로그램은 각 요청마다 접속 정보를 다시 읽습니다. 실패한 쓰기·실행 요청은 자동 재시도하지 않습니다. 응답을 잃은 경우 앱 상태를 확인한 뒤 다시 요청하세요. 원격 URL·리디렉션 연결은 허용하지 않으며 stdout에는 MCP 메시지만 출력합니다.

## 개발 검증

저장소 루트에서 `npx tsx --test tests/api-testing/mcp.test.ts tests/api-testing/mcp-package.test.ts`를 실행합니다. 패키지 테스트는 임시 디렉터리에 실제 npm tarball을 설치하고 설치된 프로그램으로 앱 서버에 연결합니다. 사용자 글로벌 설치나 AI 설정은 변경하지 않습니다.
