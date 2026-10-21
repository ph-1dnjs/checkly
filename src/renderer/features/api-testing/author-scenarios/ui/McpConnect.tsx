import { useEffect, useState } from "react";
import type { ApiMcpSetup, ApiMcpSetupFormat, ApiMcpStatus, ApiProject, ApiTestingBridge } from "../../../../../app/api-testing/shared/workspace";
import { Icon } from "../../../../shared/ui/Icon";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
  .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
  .replace(/^Error: /, "");

/**
 * MCP: the user's own AI (Claude Code, Codex…) works with Checkly directly instead of copying a guide.
 * It connects to the environment picked on the page; the page keeps the status and follows environment changes.
 */
export function McpConnect({ project, environmentId, bridge, status, onStatus }: {
  project: ApiProject; environmentId: string; bridge: ApiTestingBridge;
  status: ApiMcpStatus; onStatus: (status: ApiMcpStatus) => void;
}) {
  const [setup, setSetup] = useState<ApiMcpSetup | null>(null);
  const [copied, setCopied] = useState(false);
  const [client, setClient] = useState<ApiMcpSetupFormat>("claude");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connected = status.enabled && status.projectId === project.id;
  // Registration is a one-time step: open it until the connection has been used.
  const [showSetup] = useState(() => !connected);
  useEffect(() => {
    let live = true;
    void bridge.getMcpSetup().then(value => { if (live) setSetup(value); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [bridge]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const change = async () => {
    setBusy(true); setError("");
    try { onStatus(await (connected ? bridge.stopMcp(project.id) : bridge.startMcp({ projectId: project.id, environmentId }))); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await bridge.copyMcpSetup(client); setCopied(true); }
    catch (e) { setError(errorMessage(e)); }
  };
  const guide = CLIENTS[client];
  const environmentName = project.environments.find(e => e.id === (connected ? status.environmentId : environmentId))?.name ?? "";
  return <section className="api-ai-mcp" aria-labelledby="api-mcp-heading">
    <div className="api-ai-mcp-head">
      <button type="button" role="switch" aria-checked={connected} aria-label="MCP 연결" className={`api-switch${connected ? " is-on" : ""}`} disabled={busy || !environmentId} onClick={() => void change()}><i /></button>
      <strong id="api-mcp-heading">MCP 연결</strong>
      {connected ? <span role="status" className="api-mcp-live"><i aria-hidden="true" />연결됨 · {environmentName}</span> : <span className="api-mcp-off">꺼짐</span>}
    </div>
    <p className="api-field-help">내 AI 앱이 Checkly 명세를 보고 시나리오를 저장·실행합니다. 화면의 API 환경({environmentName})을 따릅니다.</p>

    {setup && <details className="api-ai-mcp-setup" open={showSetup}>
      <summary>처음 한 번: AI 앱에 등록</summary>
      <div role="radiogroup" aria-label="MCP AI 클라이언트" className="api-ai-mcp-clients">
        {(Object.keys(CLIENTS) as ApiMcpSetupFormat[]).map(key => <label key={key} className="api-check-row">
          <input type="radio" name={`api-mcp-client-${project.id}`} checked={client === key} onChange={() => { setClient(key); setCopied(false); }} />{CLIENTS[key].name}
        </label>)}
      </div>
      <div className="api-ai-mcp-code">
        <pre aria-label={`${guide.name} MCP 설정`}>{client === "codex" ? setup.codexCommand : client === "claude" ? setup.claudeCommand : setup.configJson}</pre>
        <button type="button" className="api-icon-button" aria-label={guide.copy} title={copied ? "복사했습니다" : "복사"} onClick={() => void copy()}><Icon name={copied ? "check" : "content_copy"} size={16} /></button>
      </div>
      <p className="api-field-help">{guide.help}</p>
    </details>}

    {connected && <details><summary>고급: HTTP 직접 연결</summary>
      <label>서버 주소<input aria-label="MCP 서버 주소" readOnly value={status.url} /></label>
      <details><summary>연결 토큰 보기</summary><label>Bearer 토큰<input aria-label="MCP 연결 토큰" readOnly value={status.token} /></label></details>
      <p className="api-field-help">Streamable HTTP 클라이언트용입니다. 연결을 다시 켜면 주소·토큰이 바뀝니다.</p>
    </details>}
    {error && <p role="alert" className="api-warning">{error}</p>}
  </section>;
}

// Listed in order; Claude Code covers both the CLI and the desktop app's Code tab.
const CLIENTS: Record<ApiMcpSetupFormat, { name: string; copy: string; help: string }> = {
  claude: { name: "Claude Code", copy: "Claude Code 설치 명령 복사", help: "터미널에서 한 번 실행하고, Claude Code 새 세션의 /mcp에서 checkly를 확인하세요." },
  codex: { name: "Codex", copy: "Codex 설치 명령 복사", help: "터미널에서 한 번 실행하고 Codex를 다시 여세요." },
  json: { name: "기타(JSON)", copy: "설정 JSON 복사", help: "AI 앱의 MCP 설정(mcpServers)에 붙여넣고 앱을 다시 여세요. node를 못 찾으면 command를 Node 절대 경로로 바꾸세요." },
};
