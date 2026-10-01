// Read-only views of a scenario's call flow (preview) and its latest run result.
import { useEffect, useRef, useState } from "react";
import type { ApiCatalog, ApiScenarioPreview, ApiScenarioResult } from "../../../../app/api-testing/shared/workspace";
import { describeCheck, type Scenario } from "../../../../app/api-testing/shared/scenario";
import { ScenarioStepSummary } from "./ScenarioStepSummary";
import { JsonCode } from "./JsonCode";
import { configuredFields } from "../lib/settings-summary-model";

type RunStep = ApiScenarioResult["steps"][number];
type ScenarioStep = Scenario["steps"][number];

/** Each response check of a run step, in the editor's words: ✓/✗, what was checked, and the actual value on failure. */
function RunChecks({ runStep, step }: { runStep: RunStep; step?: ScenarioStep }) {
  if (!runStep.checks?.length) return null;
  const failed = runStep.checks.filter(check => !check.passed).length;
  return <section className="api-run-checks" aria-label="검증 결과">
    <h4>검증 <small>{failed ? `${runStep.checks.length - failed}/${runStep.checks.length} 통과` : `${runStep.checks.length}개 모두 통과`}</small></h4>
    <ul>{runStep.checks.map((check, index) => {
      const expectation = check.expect === undefined ? undefined : step?.expect?.[check.expect];
      const { target, rule } = describeCheck(expectation);
      return <li key={index} className={check.passed ? "is-passed" : "is-failed"}>
        <span aria-hidden="true">{check.passed ? "✓" : "✗"}</span>
        {expectation && expectation.source !== "status" ? <code>{target}</code> : <span>{target}</span>}<span className="api-run-check-rule">{rule}</span>
        {!check.passed && check.actual !== undefined && <span className="api-run-check-actual">실제 <code>{check.actual}</code></span>}
      </li>;
    })}</ul>
  </section>;
}

/** Korean labels for run statuses, shared by scenario and suite results. */
import { runStatusName } from "../model/run-status";
import { ServerTag, usesManyServers } from "./ServerTag";

export function operationForStep(step: Scenario["steps"][number], catalogs: Record<string, ApiCatalog | null>, bindings: Record<string, string>) {
  return catalogs[bindings[step.server] ?? step.server]?.operations.find(operation => "operationId" in step.api
    ? operation.operationId === step.api.operationId
    : operation.path === step.api.path && operation.method.toUpperCase() === step.api.method.toUpperCase());
}

export function ScenarioRunFlow({ preview, catalogs, bindings, focusRequest, onConfigureGlobal, serverNames = {} }: { onConfigureGlobal: (name: string) => void; preview: ApiScenarioPreview; catalogs: Record<string, ApiCatalog | null>; bindings: Record<string, string>; focusRequest: { index: number; request: number } | null; /** Server id → name, for the per-step server tag. */ serverNames?: Record<string, string> }) {
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
  // Name the server on each step only when the scenario calls more than one.
  const multiServer = usesManyServers(preview.scenario.steps);
  return <section ref={flow} className="api-run-flow" aria-label="시나리오 실행 흐름">
    {/* The view switch above already names this view and its step count. */}
    <header className="api-run-section-heading api-run-flow-tools"><div className="api-run-section-actions"><button type="button" onClick={() => setAllStepsOpen(true)}>모두 펼치기</button><button type="button" onClick={() => setAllStepsOpen(false)}>모두 접기</button></div></header>
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
              <small>{multiServer && <ServerTag server={step.server} names={serverNames} />}{step.name ?? operation?.summary ?? step.id}</small>
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
            <div className="api-step-summary-view"><ScenarioStepSummary onConfigureGlobal={onConfigureGlobal} scenario={preview.scenario} stepIndex={index} operation={operation} catalog={catalogs[bindings[step.server] ?? step.server]} missingGlobals={missingGlobals} /></div>
          </div>
        </details>;
      })}
    </ol>
  </section>;
}

export const shouldExpandResult = (step: ApiScenarioResult["steps"][number]) => Boolean(step.error) || ["failed", "error", "blocked"].includes(step.status.toLowerCase());

/**
 * The path a step actually called (`/items/4`) for its spec template (`/items/{itemId}`): the
 * template's number of trailing segments from the request URL, so a gateway prefix drops off.
 */
function calledPath(url: string | undefined, template: string): string {
  if (!url || !template.startsWith("/")) return template;
  try {
    const segments = new URL(url).pathname.split("/").slice(1);
    const count = template.split("/").length - 1;
    return segments.length >= count ? `/${segments.slice(-count).join("/")}` : template;
  } catch { return template; }
}

/** When the run ended: the time for today's runs, date and time otherwise. */
const completedLabel = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString() : date.toLocaleString();
};

export function ScenarioRunResult({ result, preview, catalogs, bindings, focusRequest, completedAt, serverNames = {} }: { result: ApiScenarioResult; preview: ApiScenarioPreview | null; catalogs: Record<string, ApiCatalog | null>; bindings: Record<string, string>; focusRequest: { stepId: string; request: number } | null; completedAt?: string; serverNames?: Record<string, string> }) {
  const stepsElement = useRef<HTMLDivElement>(null);
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
  const resultMultiServer = usesManyServers(preview?.scenario.steps ?? []);
  return <>
    <header className="api-run-result-heading"><div className="api-run-result-title"><h2>실행 결과</h2></div><div className="api-run-result-meta">{completedAt && <span title="이 결과는 앱을 새로고침하면 사라집니다">{completedLabel(completedAt)}</span>}<span>{result.steps.length}개 API</span><strong className={`api-run-result-status is-${result.status.toLowerCase()}`}>{runStatusName(result.status)}</strong></div></header>
    <div className="api-run-section-actions api-run-result-actions" role="group" aria-label="실행 결과 펼치기"><button type="button" onClick={() => setAllOpen(true)}>모두 펼치기</button><button type="button" onClick={() => setAllOpen(false)}>모두 접기</button></div>
    <div ref={stepsElement} className="api-run-result-steps">
      {result.steps.map((runStep, index) => {
        const scenarioStep = preview?.scenario.steps.find(step => step.id === runStep.id);
        const operation = scenarioStep ? operationForStep(scenarioStep, catalogs, bindings) : undefined;
        const reference = operation
          ? `${operation.method.toUpperCase()} ${operation.path}`
          : scenarioStep ? ("operationId" in scenarioStep.api ? scenarioStep.api.operationId : `${scenarioStep.api.method} ${scenarioStep.api.path}`) : runStep.id;
        const [method, ...pathParts] = reference.split(" ");
        const template = pathParts.join(" ");
        const status = runStep.status.toLowerCase();
        const called = calledPath(runStep.request?.url, template);
        return <details key={runStep.id} className={`api-run-result-step api-selected-${method.toLowerCase()} is-${status}`} open={shouldExpandResult(runStep)}>
          <summary><span className="api-run-result-chevron" aria-hidden="true">▸</span><span className="api-run-result-index">{index + 1}.</span><span className="api-method" data-method={method}>{method}</span><code title={called !== template ? `명세 경로 ${template}` : undefined}>{called}</code><small>{resultMultiServer && scenarioStep && <ServerTag server={scenarioStep.server} names={serverNames} />}{runStep.name}</small>{!!runStep.checks?.length && <small className={`api-run-result-check-badge${runStep.checks.some(check => !check.passed) ? "" : " is-passed"}`}>검증 {runStep.checks.filter(check => check.passed).length}/{runStep.checks.length}</small>}<strong className={`api-run-result-step-status${runStep.httpStatus ? " is-http" : ""}`}>{runStep.httpStatus ? `HTTP ${runStep.httpStatus}` : runStatusName(status)}</strong><span className="api-run-result-duration">{runStep.durationMs}ms</span></summary>
          <div className="api-run-result-step-body">
            {runStep.error && <p className="api-warning">{runStep.error}</p>}
            <RunChecks runStep={runStep} step={scenarioStep} />
            <details className="api-run-payload" open><summary>요청{runStep.request && <span className="api-run-payload-meta"><strong>{runStep.request.method.toUpperCase()}</strong> <code>{runStep.request.url}</code></span>}</summary>{!runStep.request ? <p className="api-run-payload-empty">이 단계는 요청을 전송하지 않았습니다.</p> : runStep.request.body === undefined && !Object.keys(runStep.request.headers ?? {}).length ? <p className="api-run-payload-empty">헤더·본문 없음</p> : <JsonCode value={{ body: runStep.request.body, headers: runStep.request.headers }} />}</details>
            <details className="api-run-payload" open><summary>응답<span className="api-run-payload-meta">{runStep.httpStatus !== undefined && <strong className={runStep.httpStatus < 400 ? "is-ok" : "is-error"}>HTTP {runStep.httpStatus}</strong>}<span>{runStep.durationMs}ms</span>{runStep.inputs ? <span>입력 {runStep.inputs.filter(input => input.provided).length}/{runStep.inputs.length}</span> : runStep.input ? <span>입력 {runStep.input.provided ? "완료" : "없음"}</span> : null}</span></summary>{runStep.headers !== undefined || runStep.body !== undefined ? <JsonCode value={{ body: runStep.body, headers: runStep.headers }} /> : <p className="api-run-payload-empty">응답이 없습니다.</p>}</details>
          </div>
        </details>;
      })}
    </div>
  </>;
}
