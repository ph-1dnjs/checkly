import { useState } from "react";
import { aiFixFailures, aiFixResponse } from "../model/ai-fix";
import { Icon } from "../../../../shared/ui/Icon";
import type { ApiEnvironmentScope, ApiScenarioResult, ApiTestingBridge } from "../../../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

/** The button on the failed-run line; shown only when the run has a failed step to tell the AI about. */
export function AiFixButton({ result, disabled, open, onClick }: { result: ApiScenarioResult; disabled: boolean; open: boolean; onClick: () => void }) {
  if (!aiFixFailures(result).length) return null;
  return <button type="button" className="api-ai-fix-open" aria-expanded={open} disabled={disabled} onClick={onClick}><Icon name="auto_fix_high" size={15} />AI로 고치기</button>;
}

/**
 * AI로 고치기 on a failed run: the saved YAML, where it failed and an optional message go to the in-app AI
 * (바로 만들기), which saves a fixed version for the user to check in the AI tab.
 */
export function AiFixRequest({ scope, scenarioId, result, bridge, disabled, onStarted, onCancel }: {
  scope: ApiEnvironmentScope; scenarioId: string; result: ApiScenarioResult; bridge: ApiTestingBridge; disabled: boolean; onStarted: () => void; onCancel: () => void;
}) {
  const [message, setMessage] = useState("");
  const [withResponse, setWithResponse] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const failures = aiFixFailures(result);
  const response = aiFixResponse(result);
  if (!failures.length) return null;
  const send = async () => {
    setSending(true); setError("");
    try {
      await bridge.startAiQuick({ scope, request: message.trim(), fix: { scenarioId, failures, ...(withResponse && response ? { response } : {}) } });
      onStarted();
    } catch (e) { setError(errorText(e)); setSending(false); }
  };
  return <section className="api-ai-fix" aria-label="AI로 고치기">
    <p className="api-field-help">시나리오 YAML과 실패한 단계·상태 코드만 AI에 보냅니다.</p>
    <ul>{failures.map(failure => <li key={failure}>{failure}</li>)}</ul>
    <textarea rows={2} aria-label="AI에게 할 말" placeholder="AI에게 할 말 (선택) 예: 주소만 바꾸면 돼요" value={message} disabled={sending} onChange={e => setMessage(e.target.value)} />
    {response && <label className="api-check-row"><input type="checkbox" checked={withResponse} disabled={sending} onChange={e => setWithResponse(e.target.checked)} />실패한 단계의 응답 내용도 보내기</label>}
    {error && <p className="api-warning" role="alert">{error}</p>}
    <div className="api-actions">
      <button type="button" className="api-primary" disabled={sending || disabled} onClick={() => void send()}>{sending ? "보내는 중…" : "AI에 보내기"}</button>
      <button type="button" disabled={sending} onClick={onCancel}>취소</button>
    </div>
  </section>;
}
