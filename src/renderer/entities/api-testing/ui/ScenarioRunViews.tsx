// Read-only view of a scenario's steps together with its latest run result.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ApiCatalog, ApiScenarioPreview, ApiScenarioResult } from "../../../../app/api-testing/shared/workspace";
import { describeCheck, type Scenario } from "../../../../app/api-testing/shared/scenario";
import { missingGlobalIssue } from "../../../../app/api-testing/shared/preflight-issues";
import { ScenarioStepSummary } from "./ScenarioStepSummary";
import { JsonCode } from "./JsonCode";
import { configuredFields } from "../lib/settings-summary-model";
import { Icon } from "../../../shared/ui/Icon";

type RunStep = ApiScenarioResult["steps"][number];
type ScenarioStep = Scenario["steps"][number];

/** A request or response: the body first, the headers folded below it (they are rarely what is checked). */
function PayloadParts({ body, headers, empty }: { body?: unknown; headers?: Record<string, string>; empty: string }) {
  const headerCount = Object.keys(headers ?? {}).length;
  if (body === undefined && !headerCount) return <p className="api-run-payload-empty">{empty}</p>;
  return <>
    {body === undefined ? <p className="api-run-payload-empty">본문 없음</p> : <JsonCode value={body} />}
    {headerCount > 0 && <details className="api-run-headers"><summary>헤더 {headerCount}개</summary><JsonCode value={headers} /></details>}
  </>;
}

/** Each response check of a run step, in the editor's words: ✓/✗, what was checked, and the actual value on failure. */
function RunChecks({ runStep, step, scenario }: { runStep: RunStep; step?: ScenarioStep; scenario?: Scenario }) {
  if (!runStep.checks?.length) return null;
  const failed = runStep.checks.filter(check => !check.passed).length;
  return <section className="api-run-checks" aria-label="검증 결과">
    <h4>검증 <small>{failed ? `${runStep.checks.length - failed}/${runStep.checks.length} 통과` : `${runStep.checks.length}개 모두 통과`}</small></h4>
    <ul>{runStep.checks.map((check, index) => {
      const expectation = check.expect === undefined ? undefined : step?.expect?.[check.expect];
      const { target, rule } = describeCheck(expectation, scenario);
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

/** Values a step takes from earlier steps, and what it saves for later ones, in one short line. */
function valueFlowText(scenario: Scenario, index: number) {
  const linked = configuredFields(scenario, index).filter(field => !field.direct && !field.global && field.label !== "실행 중 입력").map(field => `${field.field} ← ${field.label}`);
  const saved = scenario.steps[index].extract.map(extract => `→ ${extract.target.replace(/^vars\./, "").replace(/^globals\./, "전역변수 ")}`);
  return [...linked, ...saved].join(" · ");
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
export const completedLabel = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString() : date.toLocaleString();
};

type StepTab = "settings" | "request" | "response";
const stepTabLabels: Record<StepTab, string> = { settings: "설정", request: "요청", response: "응답" };

export type ScenarioStepsProps = {
  preview: ApiScenarioPreview;
  /** The latest run, matched to the steps by id; null before the first run and while running. */
  result: ApiScenarioResult | null;
  /** The scenario as it was for that run (its checks are described in those words). */
  resultPreview?: ApiScenarioPreview | null;
  catalogs: Record<string, ApiCatalog | null>;
  bindings: Record<string, string>;
  focusRequest: { stepId: string; request: number } | null;
  running?: boolean;
  /** Right side of the heading: when it last ran, or whether it can run. */
  meta?: ReactNode;
  onStop?: () => void;
  onConfigureGlobal: (name: string) => void;
  /** Server id → name, for the per-step server tag. */
  serverNames?: Record<string, string>;
};

/**
 * A scenario's steps in one list: what each step calls and sets up and, once it ran, how that went.
 * Failed steps open on their response; the others stay one line until opened.
 */
export function ScenarioSteps({ preview, result, resultPreview, catalogs, bindings, focusRequest, running = false, meta, onStop, onConfigureGlobal, serverNames = {} }: ScenarioStepsProps) {
  const list = useRef<HTMLDivElement>(null);
  const steps = preview.scenario.steps;
  const runSteps = new Map((result?.steps ?? []).map(step => [step.id, step] as const));
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  const [tabs, setTabs] = useState<Record<string, StepTab>>({});
  useEffect(() => {
    setOpenSteps(new Set((result?.steps ?? []).filter(shouldExpandResult).map(step => step.id)));
    setTabs({});
  }, [result]);
  useEffect(() => {
    if (!focusRequest) return;
    const index = steps.findIndex(step => step.id === focusRequest.stepId);
    if (index < 0) return;
    setOpenSteps(previous => new Set(previous).add(focusRequest.stepId));
    const target = list.current?.querySelectorAll<HTMLElement>(".api-scn-step")[index];
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    target?.querySelector<HTMLElement>(".api-scn-step-head")?.focus({ preventScroll: true });
  }, [focusRequest]);
  const toggle = (stepId: string) => setOpenSteps(previous => {
    const next = new Set(previous);
    if (next.has(stepId)) next.delete(stepId);
    else next.add(stepId);
    return next;
  });
  const allOpen = steps.length > 0 && steps.every(step => openSteps.has(step.id));
  // Name the server on each step only when the scenario calls more than one.
  const multiServer = usesManyServers(steps);
  const missingGlobals = new Set((preview.executionIssues ?? []).flatMap(issue => missingGlobalIssue(issue)?.name ?? []));
  const checksScenario = resultPreview?.scenario ?? preview.scenario;
  return <section className="api-scn-steps" aria-label="시나리오 단계">
    <header className="api-scn-steps-heading">
      <h3>단계</h3><span className="api-scn-steps-count">{steps.length}</span>
      <span className="api-scn-steps-meta">{meta}</span>
      {running && onStop && <button type="button" className="api-scn-stop" onClick={onStop}>실행 중단</button>}
      <button type="button" className="api-scn-text-button" disabled={!steps.length} onClick={() => setOpenSteps(allOpen ? new Set() : new Set(steps.map(step => step.id)))}>{allOpen ? "모두 접기" : "모두 펼치기"}</button>
    </header>
    {running && <div className="api-scn-progress" role="progressbar" aria-label="시나리오 실행 중"><span /></div>}
    <div ref={list} className="api-scn-step-list">
      {steps.map((step, index) => {
        const runStep = runSteps.get(step.id);
        const operation = operationForStep(step, catalogs, bindings);
        const reference = operation
          ? `${operation.method.toUpperCase()} ${operation.path}`
          : "operationId" in step.api ? step.api.operationId : `${step.api.method} ${step.api.path}`;
        const [method, ...pathParts] = reference.split(" ");
        const template = pathParts.join(" ");
        const status = runStep?.status.toLowerCase();
        const called = calledPath(runStep?.request?.url, template);
        // Never sent because an earlier step failed: one line instead of empty request and response boxes.
        const skipped = status === "skipped" && !runStep?.request && runStep?.httpStatus === undefined;
        const failed = Boolean(runStep && shouldExpandResult(runStep));
        const open = openSteps.has(step.id);
        const name = runStep?.name ?? step.name ?? operation?.summary ?? step.id;
        const flowText = valueFlowText(preview.scenario, index);
        const counts = [
          { label: "요청", count: configuredFields(preview.scenario, index).length },
          { label: "저장", count: step.extract.length },
          { label: "검증", count: step.expect?.length ?? 0 },
        ].filter(item => item.count > 0).map(item => `${item.label} ${item.count}`);
        const passedChecks = runStep?.checks?.filter(check => check.passed).length ?? 0;
        const metaText = runStep
          ? [runStep.httpStatus ? `HTTP ${runStep.httpStatus}` : runStatusName(status!), ...(runStep.checks?.length ? [`검증 ${passedChecks}/${runStep.checks.length}`] : []), ...(skipped ? [] : [`${runStep.durationMs}ms`])].join(" · ")
          : counts.join(" · ");
        const showPayload = Boolean(runStep && !skipped);
        const tab = tabs[step.id] ?? (showPayload ? "response" : "settings");
        const tabList: StepTab[] = showPayload ? ["settings", "request", "response"] : ["settings"];
        const bodyId = `api-scn-step-${index}`;
        return <div key={step.id} className={`api-scn-step${status ? ` is-${status}` : ""}${failed ? " is-problem" : ""}${open ? " is-open" : ""}`}>
          <button type="button" className="api-scn-step-head" aria-expanded={open} aria-controls={bodyId} aria-label={`${index + 1}단계 ${name}`} title={called !== template ? `명세 경로 ${template}` : name} onClick={() => toggle(step.id)}>
            <span className="api-scn-step-index">{index + 1}</span>
            <span className="api-method" data-method={method}>{method}</span>
            <span className="api-scn-step-main">
              <span className="api-scn-step-path"><code>{called}</code>{multiServer && <ServerTag server={step.server} names={serverNames} />}</span>
              {open && <small>{name}</small>}
            </span>
            {failed && <span className="api-scn-step-fail" title={runStep?.error}><span aria-hidden="true" />{status === "blocked" ? runStatusName(status) : "실패"}</span>}
            <span className="api-scn-step-meta">{metaText}</span>
            <Icon name="expand_more" size={18} className="api-scn-step-caret" />
          </button>
          <div id={bodyId} className="api-scn-step-body" hidden={!open}>
            {flowText && <p className="api-scn-step-flow">값 연결 <code>{flowText}</code></p>}
            {runStep?.error && <p className="api-warning">{runStep.error}</p>}
            {runStep && <RunChecks runStep={runStep} step={(resultPreview ?? preview).scenario.steps.find(candidate => candidate.id === runStep.id)} scenario={checksScenario} />}
            {skipped && <p className="api-run-payload-empty">앞 단계가 실패해 이 단계는 실행하지 않았습니다.</p>}
            {tabList.length > 1 && <div className="api-scn-tabs" role="tablist" aria-label={`${index + 1}단계 보기`}>{tabList.map(item => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTabs(previous => ({ ...previous, [step.id]: item }))}>{stepTabLabels[item]}</button>)}</div>}
            <div className="api-scn-tab-panel api-step-summary-view" role={tabList.length > 1 ? "tabpanel" : undefined} hidden={tab !== "settings"}>
              <ScenarioStepSummary onConfigureGlobal={onConfigureGlobal} scenario={preview.scenario} stepIndex={index} operation={operation} catalog={catalogs[bindings[step.server] ?? step.server]} missingGlobals={missingGlobals} />
            </div>
            {showPayload && runStep && <>
              <div className="api-scn-tab-panel api-run-payload" role="tabpanel" aria-label="요청" hidden={tab !== "request"}>
                {runStep.request && <p className="api-run-payload-meta"><strong>{runStep.request.method.toUpperCase()}</strong> <code>{runStep.request.url}</code></p>}
                {!runStep.request ? <p className="api-run-payload-empty">이 단계는 요청을 전송하지 않았습니다.</p> : <PayloadParts body={runStep.request.body} headers={runStep.request.headers} empty="헤더·본문 없음" />}
              </div>
              <div className="api-scn-tab-panel api-run-payload" role="tabpanel" aria-label="응답" hidden={tab !== "response"}>
                <p className="api-run-payload-meta">{runStep.httpStatus !== undefined && <strong className={runStep.httpStatus < 400 ? "is-ok" : "is-error"}>HTTP {runStep.httpStatus}</strong>}<span>{runStep.durationMs}ms</span>{runStep.inputs ? <span>입력 {runStep.inputs.filter(input => input.provided).length}/{runStep.inputs.length}</span> : runStep.input ? <span>입력 {runStep.input.provided ? "완료" : "없음"}</span> : null}</p>
                {runStep.headers !== undefined || runStep.body !== undefined ? <PayloadParts body={runStep.body} headers={runStep.headers} empty="본문 없음" /> : <p className="api-run-payload-empty">응답이 없습니다.</p>}
              </div>
            </>}
          </div>
        </div>;
      })}
    </div>
  </section>;
}
