import { useEffect, useState, type FormEvent } from "react";
import { aiFixFailures, aiFixPrompt, aiFixResponse } from "../model/ai-fix";
import { Icon } from "../../../../shared/ui/Icon";
import type { ApiEnvironmentScope, ApiScenarioResult, ApiTestingBridge } from "../../../../../app/api-testing/shared/workspace";
import { backendFolderCount, chatTool } from "../../../../entities/api-testing";

import { Button } from "../../../../shared/ui/Button";
const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

/** Where AI에게 요청 goes: a new light 바로 만들기, or the terminal conversation already open. */
export type AiAskTarget = "quick" | "terminal";

/** The AI button on a saved scenario; `label` names it ("AI에게 요청", or "AI로 고치기" on a failed run). */
export function AiAskButton({ label, disabled, primary = false, onClick }: { label: string; disabled: boolean; primary?: boolean; onClick: () => void }) {
  return <Button variant={primary ? "primary" : "secondary"} className={`api-ai-ask-open${primary ? " is-primary" : ""}`} aria-haspopup="dialog" disabled={disabled} onClick={onClick}><Icon name="auto_fix_high" size={15} />{label}</Button>;
}

/**
 * AI에게 요청 about a saved scenario, as a modal: a question or a change, and (when the last run failed, by choice)
 * where it failed. Only the scenario YAML, the user's words, the failed step and HTTP status and, when allowed,
 * the start of that step's response go to the AI. It goes to a new 바로 만들기 or into the open terminal conversation.
 */
export function AiAskRequest({ scope, scenarioId, scenarioName, failedRun, includeFailure, bridge, disabled, onSent, onCancel }: {
  scope: ApiEnvironmentScope; scenarioId: string; scenarioName: string;
  /** The scenario's last run when it failed. */
  failedRun?: ApiScenarioResult;
  /** Opened from the failed run: its failure goes with the request from the start. */
  includeFailure: boolean;
  bridge: ApiTestingBridge; disabled: boolean; onSent: (target: AiAskTarget) => void; onCancel: () => void;
}) {
  const [message, setMessage] = useState("");
  const failures = failedRun ? aiFixFailures(failedRun) : [];
  const response = failedRun ? aiFixResponse(failedRun) : undefined;
  const [withFailure, setWithFailure] = useState(includeFailure && failures.length > 0);
  const [withResponse, setWithResponse] = useState(false);
  // The terminal is offered only while its conversation is open (the CLI must be there to read the request).
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [chatReady, setChatReady] = useState(false);
  const [mcpConnected, setMcpConnected] = useState(false);
  const [checkingDestinations, setCheckingDestinations] = useState(true);
  const [delivery, setDelivery] = useState<AiAskTarget | "copy">("copy");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([
      bridge.getAiTerminal(scope.projectId).catch(() => null),
      bridge.getAiChatStatus().catch(() => ({ tools: [] })),
      bridge.getAiChatSettings(scope.projectId).catch(() => ({ folders: {} })),
      bridge.getMcpStatus().catch(() => ({ enabled: false } as const)),
    ]).then(([terminal, status, settings, mcp]) => {
      if (!active) return;
      const ready = Boolean(chatTool(settings, status.tools)) && backendFolderCount(settings) > 0;
      setTerminalOpen(Boolean(terminal?.running));
      setChatReady(ready);
      setMcpConnected(mcp.enabled && mcp.projectId === scope.projectId && mcp.environmentId === scope.environmentId);
      setCheckingDestinations(false);
    });
    return () => { active = false; };
  }, [bridge, scope.projectId, scope.environmentId]);
  const ready = Boolean(message.trim()) || (withFailure && failures.length > 0);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (sending || !ready) return;
    setSending(true); setError("");
    const request = {
      scope, request: message.trim(),
      about: { scenarioId, ...(withFailure ? { failures, ...(withResponse && response ? { response } : {}) } : {}) },
    };
    try {
      if (delivery === "copy") {
        await navigator.clipboard.writeText(aiFixPrompt({
          scenarioName,
          request: request.request,
          failures: withFailure ? failures : [],
          ...(withFailure && withResponse && response ? { response } : {}),
        }));
        setMessage("수정 프롬프트를 복사했습니다. 백엔드 프로젝트를 연 AI 대화에 붙여넣으세요.");
        setSending(false);
        return;
      }
      if (delivery === "terminal") await bridge.askAiTerminal(request);
      else await bridge.startAiQuick(request);
      onSent(delivery);
    } catch (e) { setError(errorText(e)); setSending(false); }
  };
  return <div className="api-input-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !sending) onCancel(); }}>
    <form className="api-input-modal api-ai-ask" role="dialog" aria-modal="true" aria-labelledby="api-ai-ask-title" onSubmit={event => void send(event)}
      onKeyDown={event => { if (event.key === "Escape" && !sending) { event.stopPropagation(); onCancel(); } }}>
      <header><div><p className="api-input-kicker">AI에게 요청</p><h2 id="api-ai-ask-title">{scenarioName}</h2></div></header>
      <textarea rows={3} autoFocus aria-label="AI에게 할 말" value={message} disabled={sending}
        placeholder={withFailure ? "AI에게 할 말 (선택) 예: 주소만 바꾸면 돼요" : "질문이나 바꿀 점 예: 이 단계는 왜 이 값을 써? / 실패 경우도 추가해 줘"}
        onChange={e => setMessage(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
      {failures.length > 0 && <div className="api-ai-ask-failure">
        <label className="api-check-row"><input type="checkbox" checked={withFailure} disabled={sending} onChange={e => setWithFailure(e.target.checked)} />최근 실행 실패 내용 포함</label>
        {withFailure && <>
          <ul>{failures.map(failure => <li key={failure}>{failure}</li>)}</ul>
          {response && <label className="api-check-row"><input type="checkbox" checked={withResponse} disabled={sending} onChange={e => setWithResponse(e.target.checked)} />실패한 단계의 응답 내용도 보내기</label>}
        </>}
      </div>}
      <fieldset className="api-ai-ask-target" disabled={sending}>
        <legend>어디에서 이어갈까요?</legend>
        <label className="api-check-row"><input type="radio" name="api-ai-ask-target" checked={delivery === "quick"} disabled={!chatReady} onChange={() => setDelivery("quick")} />앱에서 AI와 대화<small>{chatReady ? "백엔드 코드 폴더를 볼 수 있는 새 대화" : "AI와 백엔드 코드 폴더를 먼저 연결하세요"}</small></label>
        <label className="api-check-row"><input type="radio" name="api-ai-ask-target" checked={delivery === "terminal"} disabled={!chatReady || !terminalOpen} onChange={() => setDelivery("terminal")} />열린 터미널 대화에 이어서<small>{!chatReady ? "AI와 백엔드 코드 폴더를 먼저 연결하세요" : terminalOpen ? "지금 열린 대화가 이어서 답합니다" : "열린 터미널 대화가 없습니다"}</small></label>
        <label className="api-check-row"><input type="radio" name="api-ai-ask-target" checked={delivery === "copy"} onChange={() => setDelivery("copy")} />외부 AI에 수정 프롬프트 복사<small>{mcpConnected ? "MCP 연결됨 · 외부 AI 대화에 붙여넣으세요" : "백엔드 프로젝트를 연 Claude Code나 Codex에 붙여넣으세요"}</small></label>
      </fieldset>
      {checkingDestinations && <p className="api-field-help" role="status">AI 연결 상태를 확인하는 중…</p>}
      <p className="api-input-note">{delivery === "copy" ? `실패 단계와 상태 코드${withResponse ? ", 민감한 응답 값은 가린 앞부분" : ""}을 포함한 프롬프트를 복사합니다. 시나리오 YAML과 실제 요청값은 포함하지 않습니다.` : `시나리오 YAML과 적은 말을 AI에 보냅니다${withFailure ? `. 실패 단계·상태 코드${withResponse ? ", 민감한 응답 값은 가린 앞부분" : ""}도 포함합니다` : ""}. 실제 요청값은 보내지 않습니다.`}</p>
      {error && <p className="api-warning" role="alert">{error}</p>}
      <footer className="api-actions"><Button variant="secondary" disabled={sending} onClick={onCancel}>취소</Button><Button variant="primary" type="submit" disabled={sending || disabled || !ready || (delivery !== "copy" && !chatReady) || (delivery === "terminal" && !terminalOpen)}>{sending ? "처리 중…" : delivery === "copy" ? "수정 프롬프트 복사" : "AI에 보내기"}</Button></footer>
    </form>
  </div>;
}
