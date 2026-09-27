import { useState, type FormEvent } from "react";
import type { Json } from "../../../app/api-testing/shared/scenario";
import type { ApiEnvironmentScope, ApiScenarioInputRequest, ApiTestingBridge } from "../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

function parseInput(request: ApiScenarioInputRequest, raw: string): Json {
  if (request.type === "string") return raw;
  if (!raw.trim()) return null;
  try { return JSON.parse(raw) as Json; }
  catch { throw new Error(`${request.type} 입력은 JSON 형식으로 입력하세요`); }
}

/**
 * Asks for a value a running scenario needs before its next call. Shared by the scenario
 * and suite runners; mount it with `key={request.requestId}` so each request starts empty.
 */
export function RunInputModal({ request, scope, bridge, context, onSubmitted, onCancel }: {
  request: ApiScenarioInputRequest;
  scope: ApiEnvironmentScope;
  bridge: ApiTestingBridge;
  /** Where the run is, e.g. the suite scenario name. */
  context?: string;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(""); setSubmitting(true);
    try {
      const parsed = parseInput(request, value);
      if (request.required && (parsed === null || parsed === "")) throw new Error("필수 입력값을 입력하세요");
      await bridge.submitScenarioInput(scope, { requestId: request.requestId, runId: request.runId, stepId: request.stepId, name: request.name, value: parsed });
      onSubmitted();
    } catch (cause) {
      setError(errorText(cause));
      setSubmitting(false);
    }
  };
  return <div className="api-input-modal-backdrop" role="presentation"><form className="api-input-modal" role="dialog" aria-modal="true" aria-labelledby="api-input-title" onSubmit={event => void submit(event)}>
    <header><div><p className="api-input-kicker">실행 중 입력 · {context ? `${context} · ` : ""}{request.index + 1}/{request.totalSteps}단계</p><h2 id="api-input-title">{request.label ?? request.name}</h2></div><span>{request.stepId}</span></header>
    <p>앞 단계 실행이 완료되었습니다. 다음 API를 호출하기 전에 값을 입력하세요.</p>
    <p className="api-input-note">입력값은 이번 실행의 <code>vars.{request.name}</code>으로만 전달되며 YAML이나 실행 결과에 원문으로 저장되지 않습니다.</p>
    <label>{request.name}{request.required ? " *" : ""}<input autoFocus autoComplete="off" data-value-visibility={request.sensitive ? "sensitive" : undefined} type={request.type === "number" ? "number" : "text"} value={value} disabled={submitting} placeholder={request.type === "string" ? "값 입력" : `${request.type} JSON 입력`} onChange={event => setValue(event.target.value)} /></label>
    {error && <p className="api-warning" role="alert">{error}</p>}
    <footer className="api-actions"><button type="button" disabled={submitting} onClick={onCancel}>실행 중단</button><button type="submit" className="api-primary" disabled={submitting}>{submitting ? "전달 중…" : "입력 완료 · 계속"}</button></footer>
  </form></div>;
}
