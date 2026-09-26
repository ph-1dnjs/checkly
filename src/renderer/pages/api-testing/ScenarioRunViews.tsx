// Read-only views of a scenario's call flow (preview) and its latest run result.
import { useEffect, useRef, useState } from "react";
import type { ApiCatalog, ApiScenarioPreview, ApiScenarioResult } from "../../../app/api-testing/shared/workspace";
import { scenarioStepInputs, type Scenario } from "../../../app/api-testing/shared/scenario";
import { ScenarioStepSummary } from "./ScenarioStepSummary";
import { JsonCode } from "./JsonCode";
import { configuredFields } from "./settings-summary-model";

/** Korean labels for run statuses, shared by scenario and suite results. */
export const runStatusName = (status: string) => ({ passed: "통과", failed: "실패", blocked: "설정 필요", cancelled: "취소", skipped: "건너뜀" })[status as "passed"] ?? status;

export function operationForStep(step: Scenario["steps"][number], catalogs: Record<string, ApiCatalog | null>, bindings: Record<string, string>) {
  return catalogs[bindings[step.server] ?? step.server]?.operations.find(operation => "operationId" in step.api
    ? operation.operationId === step.api.operationId
    : operation.path === step.api.path && operation.method.toUpperCase() === step.api.method.toUpperCase());
}

export function ScenarioRunFlow({ preview, catalogs, bindings, focusRequest }: { preview: ApiScenarioPreview; catalogs: Record<string, ApiCatalog | null>; bindings: Record<string, string>; focusRequest: { index: number; request: number } | null }) {
  const flow = useRef<HTMLElement>(null);
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!focusRequest) return;
    const step = preview.scenario.steps[focusRequest.index];
    if (!step) return;
    setOpenSteps(previous => new Set(previous).add(step.id));
    const target = flow.current?.querySelectorAll<HTMLDetailsElement>('.api-run-step')[focusRequest.index];
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  }, [focusRequest, preview.scenario]);
  const setStepOpen = (stepId: string, open: boolean) => setOpenSteps(previous => {
    const next = new Set(previous);
    if (open) next.add(stepId);
    else next.delete(stepId);
    return next;
  });
  const setAllStepsOpen = (open: boolean) => setOpenSteps(open ? new Set(preview.scenario.steps.map(step => step.id)) : new Set());
  return <section ref={flow} className="api-run-flow" aria-label="시나리오 실행 흐름">
    <header className="api-run-section-heading"><div><h3>실행 흐름</h3><small>{preview.scenario.steps.length}개 API · 순서대로 호출</small></div><div className="api-run-section-actions"><button type="button" onClick={() => setAllStepsOpen(true)}>모두 펼치기</button><button type="button" onClick={() => setAllStepsOpen(false)}>모두 접기</button></div></header>
    <ol className="api-run-step-list">
      {preview.scenario.steps.map((step, index) => {
        const operation = operationForStep(step, catalogs, bindings);
        const reference = operation
          ? `${operation.method.toUpperCase()} ${operation.path}`
          : "operationId" in step.api ? step.api.operationId : `${step.api.method} ${step.api.path}`;
        const [method, ...pathParts] = reference.split(" ");
        const counts = [
          { area: "request", label: "요청", title: "요청값", count: configuredFields(preview.scenario, index).length },
          { area: "response", label: "저장", title: "응답에서 저장", count: step.extract.length },
          { area: "expect", label: "검증", title: "검증", count: step.expect?.length ?? 0 },
        ];
        const missingGlobals = new Set((preview.executionIssues ?? []).flatMap(issue => /전역변수 '([A-Za-z][A-Za-z0-9_]*)'/.exec(issue)?.[1] ?? []));
        return <details key={step.id} open={openSteps.has(step.id)} onToggle={event => setStepOpen(step.id, event.currentTarget.open)} className={`api-run-step api-selected-${method.toLowerCase()}`}>
          <summary>
            <span className="api-run-step-chevron" aria-hidden="true">▸</span>
            <span className="api-run-step-index" aria-hidden="true">{index + 1}</span>
            <div className="api-run-step-main">
              <div className="api-run-step-reference"><span className="api-method" data-method={method}>{method}</span><code title={pathParts.join(" ")}>{pathParts.join(" ")}</code></div>
              <small>{step.name ?? operation?.summary ?? step.id}</small>
            </div>
            <span className="api-run-step-counts">{counts.filter(item => item.count > 0).map(item => <button type="button" key={item.area} aria-label={`${index + 1}단계 ${item.title} ${item.count}개 보기`} title={`${item.title} ${item.count}개 보기`} onClick={event => {
              event.preventDefault(); event.stopPropagation();
              const details = event.currentTarget.closest("details");
              if (!details) return;
              details.open = true;
              setStepOpen(step.id, true);
              const target = details.querySelector<HTMLElement>(`[data-summary-area="${item.area}"]`);
              target?.scrollIntoView({ block: "center", behavior: "smooth" });
              target?.focus({ preventScroll: true });
            }}>{item.label} {item.count}</button>)}</span>
          </summary>
          <div className="api-run-step-preview-body">
            <div className="api-step-summary-view"><ScenarioStepSummary scenario={preview.scenario} stepIndex={index} operation={operation} catalog={catalogs[bindings[step.server] ?? step.server]} missingGlobals={missingGlobals} /></div>
          </div>
        </details>;
      })}
    </ol>
  </section>;
}

export const shouldExpandResult = (step: ApiScenarioResult["steps"][number]) => Boolean(step.error) || ["failed", "error", "blocked"].includes(step.status.toLowerCase());

export function ScenarioRunResult({ result, preview, catalogs, bindings, focusRequest }: { result: ApiScenarioResult; preview: ApiScenarioPreview | null; catalogs: Record<string, ApiCatalog | null>; bindings: Record<string, string>; focusRequest: { stepId: string; request: number } | null }) {
  const stepsElement = useRef<HTMLDivElement>(null);
  // Values typed into sensitive inputs are masked wherever they appear in the trace.
  const sensitiveInputs = preview ? [
    ...Object.entries(preview.scenario.inputs).filter(([, definition]) => definition.sensitive).map(([name]) => name),
    ...preview.scenario.steps.flatMap(scenarioStepInputs).filter(input => input.sensitive).map(input => input.name),
  ] : [];
  const knownSecrets = sensitiveInputs.map(name => result.variables[name]).filter((value): value is string => typeof value === "string");
  const setAllOpen = (open: boolean) => {
    stepsElement.current?.querySelectorAll<HTMLDetailsElement>(".api-run-result-step").forEach(element => { element.open = open; });
  };
  useEffect(() => {
    stepsElement.current?.querySelectorAll<HTMLDetailsElement>(".api-run-result-step").forEach((element, index) => { element.open = shouldExpandResult(result.steps[index]); });
  }, [result]);
  useEffect(() => {
    if (!focusRequest) return;
    const index = result.steps.findIndex(step => step.id === focusRequest.stepId);
    const target = stepsElement.current?.querySelectorAll<HTMLDetailsElement>(".api-run-result-step")[index];
    if (!target) return;
    target.open = true;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
  }, [focusRequest, result]);
  return <>
    <header className="api-run-result-heading"><div className="api-run-result-title"><h2>실행 결과</h2></div><div className="api-run-result-meta"><span>{result.steps.length}개 API</span><strong className={`api-run-result-status is-${result.status.toLowerCase()}`}>{runStatusName(result.status)}</strong></div></header>
    <div className="api-run-section-actions api-run-result-actions" role="group" aria-label="실행 결과 펼치기"><button type="button" onClick={() => setAllOpen(true)}>모두 펼치기</button><button type="button" onClick={() => setAllOpen(false)}>모두 접기</button></div>
    <div ref={stepsElement} className="api-run-result-steps">
      {result.steps.map((runStep, index) => {
        const scenarioStep = preview?.scenario.steps.find(step => step.id === runStep.id);
        const operation = scenarioStep ? operationForStep(scenarioStep, catalogs, bindings) : undefined;
        const reference = operation
          ? `${operation.method.toUpperCase()} ${operation.path}`
          : scenarioStep ? ("operationId" in scenarioStep.api ? scenarioStep.api.operationId : `${scenarioStep.api.method} ${scenarioStep.api.path}`) : runStep.id;
        const [method, ...pathParts] = reference.split(" ");
        const status = runStep.status.toLowerCase();
        return <details key={runStep.id} className={`api-run-result-step api-selected-${method.toLowerCase()} is-${status}`} open={shouldExpandResult(runStep)}>
          <summary><span className="api-run-result-chevron" aria-hidden="true">▸</span><span className="api-run-result-index">{index + 1}.</span><span className="api-method" data-method={method}>{method}</span><code>{pathParts.join(" ")}</code><small>{runStep.name}</small><strong className="api-run-result-step-status">{runStep.httpStatus ? `HTTP ${runStep.httpStatus}` : runStep.status.toUpperCase()}</strong><span className="api-run-result-duration">{runStep.durationMs}ms</span></summary>
          <div className="api-run-result-step-body">
            {runStep.error && <p className="api-warning">{runStep.error}</p>}
            <details className="api-run-payload" open><summary>요청{runStep.request && <span className="api-run-payload-meta"><strong>{runStep.request.method.toUpperCase()}</strong> <code>{runStep.request.url}</code></span>}</summary>{runStep.request ? <JsonCode value={{ body: runStep.request.body, headers: runStep.request.headers }} known={knownSecrets} /> : <p className="api-run-payload-empty">이 단계는 요청을 전송하지 않았습니다.</p>}</details>
            <details className="api-run-payload" open><summary>응답<span className="api-run-payload-meta">{runStep.httpStatus !== undefined && <strong className={runStep.httpStatus < 400 ? "is-ok" : "is-error"}>HTTP {runStep.httpStatus}</strong>}<span>{runStep.durationMs}ms</span>{runStep.inputs ? <span>입력 {runStep.inputs.filter(input => input.provided).length}/{runStep.inputs.length}</span> : runStep.input ? <span>입력 {runStep.input.provided ? "완료" : "없음"}</span> : null}</span></summary>{runStep.headers !== undefined || runStep.body !== undefined ? <JsonCode value={{ body: runStep.body, headers: runStep.headers }} known={knownSecrets} /> : <p className="api-run-payload-empty">응답이 없습니다.</p>}</details>
          </div>
        </details>;
      })}
    </div>
  </>;
}
