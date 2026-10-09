import { useEffect, useState, type FormEvent } from "react";
import { aiFixFailures, aiFixResponse } from "../model/ai-fix";
import { Icon } from "../../../../shared/ui/Icon";
import type { ApiEnvironmentScope, ApiScenarioResult, ApiTestingBridge } from "../../../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

/** Where AI에게 요청 goes: a new light 바로 만들기, or the terminal conversation already open. */
export type AiAskTarget = "quick" | "terminal";

/** The AI button on a saved scenario; `label` names it ("AI에게 요청", or "AI로 고치기" on a failed run). */
export function AiAskButton({ label, disabled, primary = false, onClick }: { label: string; disabled: boolean; primary?: boolean; onClick: () => void }) {
  return <button type="button" className={`api-ai-ask-open${primary ? " is-primary" : ""}`} aria-haspopup="dialog" disabled={disabled} onClick={onClick}><Icon name="auto_fix_high" size={15} />{label}</button>;
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
  const [target, setTarget] = useState<AiAskTarget>("quick");
  // The terminal is offered only while its conversation is open (the CLI must be there to read the request).
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void bridge.getAiTerminal(scope.projectId).then(current => { if (active) setTerminalOpen(Boolean(current?.running)); }).catch(() => undefined);
    return () => { active = false; };
  }, [bridge, scope.projectId]);
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
      if (target === "terminal") await bridge.askAiTerminal(request);
      else await bridge.startAiQuick(request);
      onSent(target);
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
        <legend>어디에 물어볼까요?</legend>
        <label className="api-check-row"><input type="radio" name="api-ai-ask-target" checked={target === "quick"} onChange={() => setTarget("quick")} />새로 가볍게<small>바로 만들기 새 대화</small></label>
        <label className="api-check-row"><input type="radio" name="api-ai-ask-target" checked={target === "terminal"} disabled={!terminalOpen} onChange={() => setTarget("terminal")} />터미널 대화에 이어서<small>{terminalOpen ? "지금 열린 대화가 이어서 답합니다" : "열린 터미널 대화가 없습니다"}</small></label>
      </fieldset>
      <p className="api-input-note">시나리오 YAML{withFailure ? `과 실패한 단계·상태 코드${withResponse ? ", 응답 앞부분(토큰·비밀번호 같은 값은 가림)" : ""}` : ""}, 적은 말만 AI에 보냅니다. 질문이면 답만 하고, 고친 결과는 AI 작성 도우미에서 확인하고 저장합니다.</p>
      {error && <p className="api-warning" role="alert">{error}</p>}
      <footer className="api-actions"><button type="button" disabled={sending} onClick={onCancel}>취소</button><button type="submit" className="api-primary" disabled={sending || disabled || !ready}>{sending ? "보내는 중…" : "AI에 보내기"}</button></footer>
    </form>
  </div>;
}
