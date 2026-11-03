import { useState, type FormEvent } from "react";
import type { Json } from "../../../../../app/api-testing/shared/scenario";
import { resolveDateTimeInput } from "../../../../../app/api-testing/shared/scenario";
import type { ApiEnvironmentScope, ApiScenarioInputRequest, ApiTestingBridge } from "../../../../../app/api-testing/shared/workspace";

import { Button } from "../../../../shared/ui/Button";
import { Input } from "../../../../shared/ui/Input";
const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

function parseInput(request: ApiScenarioInputRequest, raw: string, relativeDateTime: boolean): Json {
  if (request.type === "string") return raw;
  if (request.type === "datetime") {
    if (!relativeDateTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) {
      const local = new Date(raw);
      if (Number.isFinite(local.getTime())) return local.toISOString();
    }
    return resolveDateTimeInput(raw);
  }
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
  const [relativeDateTime, setRelativeDateTime] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(""); setSubmitting(true);
    try {
      const parsed = parseInput(request, value, relativeDateTime);
      if (request.required && (parsed === null || parsed === "")) throw new Error("필수 입력값을 입력하세요");
      await bridge.submitScenarioInput(scope, { requestId: request.requestId, runId: request.runId, stepId: request.stepId, name: request.name, value: parsed });
      onSubmitted();
    } catch (cause) {
      setError(errorText(cause));
      setSubmitting(false);
    }
  };
  return <div className="api-input-modal-backdrop" role="presentation"><form className="api-input-modal" role="dialog" aria-modal="true" aria-labelledby="api-input-title" onSubmit={event => void submit(event)}>
    <header><div><p className="api-input-kicker">실행 중 입력 · {context ? `${context} · ` : ""}{request.index + 1}/{request.totalSteps}단계</p><h2 id="api-input-title">{request.label ?? request.name}</h2></div></header>
    {/* The first step has nothing before it to report on. */}
    <p>{request.index > 0 ? "앞 단계까지 실행했습니다. " : ""}이 단계의 API를 호출하기 전에 값을 입력하세요.</p>
    <p className="api-input-note">이번 실행에만 쓰고 시나리오에는 저장하지 않습니다. 요청에 들어간 값은 실행 결과에 보입니다.</p>
    {request.type === "datetime" ? <>
      <fieldset className="api-input-datetime-mode" disabled={submitting}>
        <legend>날짜·시간 입력</legend>
        <label><input type="radio" name="api-input-datetime-mode" checked={!relativeDateTime} onChange={() => { setRelativeDateTime(false); setValue(""); }} />직접 선택</label>
        <label><input type="radio" name="api-input-datetime-mode" checked={relativeDateTime} onChange={() => { setRelativeDateTime(true); setValue("now"); }} />현재 시각 기준</label>
      </fieldset>
      <label>{relativeDateTime ? "기준 시각" : "날짜·시간"}{request.required ? " *" : ""}<Input autoFocus aria-label={request.label ?? request.name} autoComplete="off" type={relativeDateTime ? "text" : "datetime-local"} value={value} disabled={submitting} placeholder={relativeDateTime ? "now, now+3d, now-2h" : undefined} onChange={event => setValue(event.target.value)} /></label>
      <small className="api-field-help">현재 시각 기준은 now, now+3d(3일 뒤), now-2h(2시간 전)처럼 입력하세요. 서버에는 UTC ISO 8601 시각으로 전달합니다.</small>
    </> : <label>입력값{request.type !== "string" ? ` (${request.type} JSON)` : ""}{request.required ? " *" : ""}<Input autoFocus aria-label={request.label ?? request.name} autoComplete="off" type={request.type === "number" ? "number" : "text"} step={request.type === "number" ? "any" : undefined} value={value} disabled={submitting} placeholder={request.type === "string" ? "값 입력" : `${request.type} JSON 입력`} onChange={event => setValue(event.target.value)} /></label>}
    {error && <p className="api-warning" role="alert">{error}</p>}
    <footer className="api-actions"><Button variant="secondary" disabled={submitting} onClick={onCancel}>실행 중단</Button><Button variant="primary" type="submit" disabled={submitting}>{submitting ? "전달 중…" : "입력 완료 · 계속"}</Button></footer>
  </form></div>;
}
