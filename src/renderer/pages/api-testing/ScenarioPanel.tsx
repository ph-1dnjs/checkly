import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiCatalog, ApiProject, ApiScope, ApiTestingBridge, ApiScenarioInputRequest, ApiScenarioPreview, ApiScenarioResult, SavedApiScenario, SavedApiSuite } from "../../../app/api-testing/shared/workspace";
import { parseScenario, scenarioStepInputs, type Json, type Scenario } from "../../../app/api-testing/shared/scenario";
import { useSensitiveValues } from "./sensitive-values";
import { useRunAction } from "./useRunAction";
import type { OnRunAction } from "./useRunAction";
import { ScenarioBuilder } from "./ScenarioBuilder";
import { ApiDocumentation } from "./ApiDocumentation";
import { DeleteAction } from "./DeleteAction";
import { ProgressBar } from "../../shared/ui/ProgressBar";
import { LoadingSpinner } from "../../shared/ui/LoadingSpinner";
import DOMPurify from "dompurify";
import { Remarkable } from "remarkable";
import { GlobalVariableSetupLink, useGlobalVariableAccess } from "./global-variable-access";
import { readLastRun, writeLastRun, type ScenarioLastRun } from "./scenario-last-run";
import { ScenarioStepSummary } from "./ScenarioStepSummary";
import { JsonCode } from "./JsonCode";
import { configuredFields } from "./settings-summary-model";
import { SuitePanel } from "./SuitePanel";
import { globalProducerScenarios } from "./global-options";
import { ScenarioSidebarTree } from "./ScenarioSidebarTree";
import { SidebarMetadataFields } from "./SidebarMetadataFields";

const descriptionMarkdown = new Remarkable({ html: true, breaks: true });

const errorText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

function sidebarSearchText(item: SavedApiScenario | SavedApiSuite): string {
  let description = "";
  if ("source" in item) {
    try { description = parseScenario(item.source).description ?? ""; }
    catch { /* Invalid drafts are still searchable by their saved name and group. */ }
  }
  return [item.name, item.id, ...(item.groupPath ?? []), description].join(" ").toLocaleLowerCase();
}

function operationForStep(step: Scenario["steps"][number], catalogs: Record<string, ApiCatalog | null>, bindings: Record<string, string>) {
  return catalogs[bindings[step.server] ?? step.server]?.operations.find(operation => "operationId" in step.api
    ? operation.operationId === step.api.operationId
    : operation.path === step.api.path && operation.method.toUpperCase() === step.api.method.toUpperCase());
}

function ScenarioRunFlow({ preview, catalogs, bindings, focusRequest }: { preview: ApiScenarioPreview; catalogs: Record<string, ApiCatalog | null>; bindings: Record<string, string>; focusRequest: { index: number; request: number } | null }) {
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
          { area: "request", label: "입력 연결", count: configuredFields(preview.scenario, index).filter(field => !field.direct).length },
          { area: "response", label: "응답 저장", count: step.extract.length },
          { area: "expect", label: "검증", count: step.expect?.length ?? 0 },
        ];
        const missingGlobals = new Set((preview.executionIssues ?? []).flatMap(issue => /전역변수 '([A-Za-z][A-Za-z0-9_]*)'/.exec(issue)?.[1] ?? []));
        return <details key={step.id} open={openSteps.has(step.id)} onToggle={event => setStepOpen(step.id, event.currentTarget.open)} className={`api-run-step api-selected-${method.toLowerCase()}`}>
          <summary>
            <span className="api-run-step-chevron" aria-hidden="true">▸</span>
            <span className="api-run-step-index" aria-hidden="true">{index + 1}</span>
            <div className="api-run-step-main">
              <div className="api-run-step-reference"><span className="api-method" data-method={method}>{method}</span><code>{pathParts.join(" ")}</code></div>
              <small>{step.name ?? operation?.summary ?? step.id}</small>
            </div>
            <span className="api-run-step-counts">{counts.filter(item => item.count > 0).map(item => <button type="button" key={item.area} aria-label={`${index + 1}단계 ${item.label} ${item.count}개 보기`} onClick={event => {
              event.preventDefault(); event.stopPropagation();
              const details = event.currentTarget.closest("details");
              if (!details) return;
              details.open = true;
              setStepOpen(step.id, true);
              const target = details.querySelector<HTMLElement>(`[data-summary-area="${item.area}"]`);
              target?.scrollIntoView({ block: "center", behavior: "smooth" });
              target?.focus({ preventScroll: true });
            }}>{item.label} {item.count}</button>)}</span>
            <span className="api-run-step-preview-label">미리보기</span>
          </summary>
          <div className="api-run-step-preview-body">
            <div className="api-summary-card api-run-step-preview-summary"><ScenarioStepSummary scenario={preview.scenario} stepIndex={index} operation={operation} catalog={catalogs[bindings[step.server] ?? step.server]} missingGlobals={missingGlobals} /></div>
          </div>
        </details>;
      })}
    </ol>
  </section>;
}

const shouldExpandResult = (step: ApiScenarioResult["steps"][number]) => Boolean(step.error) || ["failed", "error", "blocked"].includes(step.status.toLowerCase());

function ScenarioRunResult({ result, preview, catalogs, bindings, focusRequest }: { result: ApiScenarioResult; preview: ApiScenarioPreview | null; catalogs: Record<string, ApiCatalog | null>; bindings: Record<string, string>; focusRequest: { stepId: string; request: number } | null }) {
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
    <header className="api-run-result-heading"><div className="api-run-result-title"><span className="api-run-result-dot" aria-hidden="true" /><h2>실행 결과 · {result.status}</h2></div><div className="api-run-result-meta"><span>{result.steps.length}개 API</span><strong className={`api-run-result-status is-${result.status.toLowerCase()}`}>{result.status.toUpperCase()}</strong></div></header>
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
            <details className="api-run-payload" open><summary>요청</summary>{runStep.request ? <JsonCode value={runStep.request} known={knownSecrets} /> : <p className="api-run-payload-empty">이 단계는 요청을 전송하지 않았습니다.</p>}</details>
            <details className="api-run-payload" open><summary>응답 {runStep.inputs ? `· 입력 ${runStep.inputs.filter(input => input.provided).length}/${runStep.inputs.length}` : runStep.input ? `· 입력 ${runStep.input.provided ? "완료" : "없음"}` : ""}</summary>{runStep.headers !== undefined || runStep.body !== undefined ? <JsonCode value={{ headers: runStep.headers, body: runStep.body }} known={knownSecrets} /> : <p className="api-run-payload-empty">응답이 없습니다.</p>}</details>
          </div>
        </details>;
      })}
    </div>
  </>;
}

export type ScenarioPanelProps = {
  project: ApiProject;
  scope: ApiScope;
  bridge: ApiTestingBridge;
  onBusy: (busy: boolean) => void;
  onRunAction: OnRunAction;
  mode?: "run" | "editor";
  startCreateRequest?: number;
  editScenarioId?: string | null;
  onCreateConsumed?: () => void;
  onComposerOpenChange?: (open: boolean) => void;
  onUnsavedChange?: (dirty: boolean) => void;
  onCreateScenario?: () => void;
  onEditScenario?: (item: SavedApiScenario) => void;
  onExecuteSaved?: (item: SavedApiScenario) => void;
  runSaved?: SavedApiScenario | null;
  onRunSavedConsumed?: () => void;
  onBackToScenarios?: () => void;
};

export function ScenarioPanel({ project, scope, bridge, onBusy, onRunAction, mode = "run", startCreateRequest = 0, editScenarioId, onCreateConsumed, onComposerOpenChange, onUnsavedChange, onCreateScenario, onEditScenario, onExecuteSaved, runSaved, onRunSavedConsumed, onBackToScenarios }: ScenarioPanelProps) {
  const editorMode = mode === "editor";
  const globalAccess = useGlobalVariableAccess();
  const sensitiveValues = useSensitiveValues();
  const checkedGlobalRevision = useRef(globalAccess.revision);
  const [editing, setEditing] = useState(editorMode);
  const [visual, setVisual] = useState(false);
  const [query, setQuery] = useState("");
  const [scenariosExpanded, setScenariosExpanded] = useState(true);
  const [suitesExpanded, setSuitesExpanded] = useState(true);
  const [suiteSelection, setSuiteSelection] = useState<string | null>(null);
  const [suites, setSuites] = useState<SavedApiSuite[]>([]);
  const [saved, setSaved] = useState<SavedApiScenario[]>([]);
  const [current, setCurrent] = useState<SavedApiScenario | null>(null);
  const [source, setSource] = useState("");
  const [scenarioGroupPath, setScenarioGroupPath] = useState<string[]>([]);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ApiScenarioPreview | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ApiScenarioResult | null>(null);
  const [runView, setRunView] = useState<"preview" | "result">("preview");
  const [focusRequest, setFocusRequest] = useState<{ index: number; request: number } | null>(null);
  const [resultFocusRequest, setResultFocusRequest] = useState<{ stepId: string; request: number } | null>(null);
  const focusResult = (stepId: string) => {
    setRunView("result");
    setResultFocusRequest(previous => ({ stepId, request: (previous?.request ?? 0) + 1 }));
  };
  const focusPreview = (index: number) => {
    setRunView("preview");
    setFocusRequest(previous => ({ index, request: (previous?.request ?? 0) + 1 }));
  };
  const [lastRun, setLastRun] = useState<ScenarioLastRun | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [checkedSource, setCheckedSource] = useState("");
  const [pendingInput, setPendingInput] = useState<ApiScenarioInputRequest | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState("");
  const [inputSubmitting, setInputSubmitting] = useState(false);
  const [catalogs, setCatalogs] = useState<Record<string, ApiCatalog | null>>({});
  const [composer, setComposer] = useState<{ saved?: SavedApiScenario; scenario?: Scenario } | null>(null);
  const [dirty, setDirty] = useState(false);
  const live = useRef(true);
  const runButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    onComposerOpenChange?.(composer !== null || (editorMode && dirty));
    return () => onComposerOpenChange?.(false);
  }, [composer, dirty, editorMode, onComposerOpenChange]);
  useEffect(() => {
    onUnsavedChange?.(dirty);
    return () => onUnsavedChange?.(false);
  }, [dirty, onUnsavedChange]);
  useEffect(() => {
    live.current = true;
    void bridge.listScenarios(project.id).then(v => { if (live.current) setSaved(v); }).catch(e => { if (live.current) setError(errorText(e)); });
    void bridge.listSuites(project.id).then(v => { if (live.current) setSuites(v); }).catch(e => { if (live.current) setError(errorText(e)); });
    return () => { live.current = false; void bridge.cancel(scope); };
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all(project.servers.map(async server => [server.id, await bridge.getCatalog({ ...scope, serverId: server.id })] as const))
      .then(entries => { if (active) setCatalogs(Object.fromEntries(entries)); })
      .catch(() => { if (active) setCatalogs({}); });
    return () => { active = false; };
  }, [bridge, project.servers, scope.environmentId, scope.projectId]);
  useEffect(() => {
    if (!running) {
      setPendingInput(null);
      setInputSubmitting(false);
      return;
    }
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await bridge.getPendingScenarioInput({ projectId: scope.projectId, environmentId: scope.environmentId });
        if (active) setPendingInput(next);
      } catch {
        // 실행 종료와 동시에 브리지가 닫히는 경우에는 결과 오류로 덮어쓰지 않는다.
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), 250);
      }
    };
    void poll();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [bridge, running, scope.projectId, scope.environmentId]);
  useEffect(() => {
    setInputValue("");
    setInputError("");
    setInputSubmitting(false);
  }, [pendingInput?.requestId]);
  const working = (v: boolean) => { setBusy(v); onBusy(v); };
  const scenarioScope = { projectId: scope.projectId, environmentId: scope.environmentId };
  const check = async (yaml = source, mapping = bindings) => {
    const data = await bridge.previewScenario(scenarioScope, yaml, mapping);
    if (live.current) { setPreview(data); setCheckedSource(yaml); }
    return data;
  };
  const openNewScenario = () => {
    if (!editorMode) {
      onCreateScenario?.();
      return;
    }
    const url = new URL(window.location.href);
    if (url.hash) { url.hash = ""; window.history.replaceState(window.history.state, "", url.href); }
    setEditing(true); setVisual(false); setCurrent(null); setSource(""); setScenarioGroupPath([]); setDirty(false); setPreview(null); setResult(null); setBindings({}); setInputs({}); setNotice(""); setError("");
    setComposer({});
  };
  useEffect(() => {
    if (!editorMode || !startCreateRequest) return;
    openNewScenario();
    onCreateConsumed?.();
  }, [editorMode, startCreateRequest]);
  const openComposer = (item: SavedApiScenario, data: ApiScenarioPreview, mapping = bindings) => {
    const steps = data.scenario.steps.map(step => ({ ...step, server: mapping[step.server] ?? step.server }));
    setComposer({ saved: item, scenario: { ...data.scenario, steps } });
  };
  const load = async (item: SavedApiScenario) => {
    setComposer(null); setEditing(false); setCurrent(item); setSource(item.source); setScenarioGroupPath(item.groupPath ?? []); setDirty(false); setBindings(item.bindings); setInputs({}); setResult(null); setPreview(null); setError(""); setNotice(""); working(true);
    const previous = readLastRun(scope.projectId, scope.environmentId, item.id);
    setRunView(previous ? "result" : "preview"); setFocusRequest(null); setResultFocusRequest(null);
    setLastRun(previous); setResult(previous?.result ?? null);
    try {
      const data = await check(item.source, item.bindings);
      if (editorMode) openComposer(item, data, item.bindings);
    } catch (e) { setError(errorText(e)); } finally { working(false); }
  };
  const openedEditId = useRef<string | null>(null);
  useEffect(() => {
    if (!editorMode || !editScenarioId || !saved.length) return;
    if (openedEditId.current === editScenarioId) return;
    const item = saved.find(candidate => candidate.id === editScenarioId);
    if (item) { openedEditId.current = editScenarioId; void load(item); }
    else setError("수정할 시나리오를 찾지 못했습니다.");
  }, [editorMode, editScenarioId, saved]);
  const canSave = Boolean(preview && checkedSource === source && preview.issues.length === 0);
  useEffect(() => {
    if (checkedGlobalRevision.current === globalAccess.revision) return;
    checkedGlobalRevision.current = globalAccess.revision;
    if (preview && !busy) void check().catch(e => setError(errorText(e)));
  }, [globalAccess.revision]);
  const canUse = Boolean(canSave && !current?.draft && !preview?.executionIssues?.length);
  const parseScenarioInput = (request: ApiScenarioInputRequest, raw: string): Json => {
    if (request.type === "string") return raw;
    if (!raw.trim()) return null;
    try { return JSON.parse(raw) as Json; }
    catch { throw new Error(`${request.type} 입력은 JSON 형식으로 입력하세요`); }
  };
  const submitPendingInput = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingInput) return;
    setInputError(""); setInputSubmitting(true);
    try {
      const value = parseScenarioInput(pendingInput, inputValue);
      if (pendingInput.required && (value === null || value === "")) throw new Error("필수 입력값을 입력하세요");
      await bridge.submitScenarioInput({ projectId: scope.projectId, environmentId: scope.environmentId }, {
        requestId: pendingInput.requestId, runId: pendingInput.runId, stepId: pendingInput.stepId, name: pendingInput.name, value,
      });
      setPendingInput(null);
    } catch (e) {
      setInputError(errorText(e));
      setInputSubmitting(false);
    }
  };
  const runScenario = async () => {
    if (!preview) return;
    working(true); setRunning(true); setError(""); setNotice("");
    try {
      const parsed = Object.fromEntries(Object.entries(preview.scenario.inputs).filter(([key, definition]) => definition.required || inputs[key] !== undefined && inputs[key] !== "").map(([key, definition]) => [key, definition.type === "string" ? inputs[key] ?? "" : JSON.parse(inputs[key] ?? "")])) as Record<string, Json>;
      const response = await bridge.runScenario(scenarioScope, source, bindings, parsed);
      rememberResult(response);
    } catch (e) {
      if (live.current) { setResult(null); setError(e instanceof SyntaxError ? "숫자·불리언·객체·배열 입력은 JSON 형식으로 입력하세요" : errorText(e)); }
    } finally {
      if (live.current) { working(false); setRunning(false); }
    }
  };
  const rememberResult = (response: ApiScenarioResult) => {
    if (!preview) return;
    const snapshot = { result: response, preview, bindings, completedAt: new Date().toISOString() };
    writeLastRun(scope.projectId, scope.environmentId, current?.id ?? preview.scenario.id, snapshot);
    if (live.current) { setResult(response); setLastRun(snapshot); setRunView("result"); setResultFocusRequest(null); }
    // Runs can extract new globals (e.g. accessToken); reload them for masking.
    sensitiveValues.refresh();
  };
  const autoRunStarted = useRef(false);
  useEffect(() => {
    if (!editorMode && runSaved) void load(runSaved);
  }, [runSaved]);
  useEffect(() => {
    if (!runSaved || editorMode || !canUse || busy || autoRunStarted.current) return;
    autoRunStarted.current = true;
    onRunSavedConsumed?.();
    if (Object.keys(preview?.scenario.inputs ?? {}).length) {
      setNotice("실행 입력을 확인한 뒤 시나리오 실행을 누르세요.");
    } else void runScenario();
  }, [runSaved, editorMode, canUse, busy]);
  const ignoreComposerAction = useRef<OnRunAction>(() => {});
  useRunAction(composer ? ignoreComposerAction.current : onRunAction, () => runButton.current?.click(), busy || !canUse, "시나리오 실행");
  const activeCatalog = catalogs[scope.serverId];
  const metadataEntries = [...saved, ...suites];
  const groupPathMap = new Map<string, string[]>();
  for (const item of metadataEntries) {
    const path = item.groupPath ?? [];
    for (let depth = 1; depth <= path.length; depth++) groupPathMap.set(JSON.stringify(path.slice(0, depth)), path.slice(0, depth));
  }
  const availableGroupPaths = [...groupPathMap.values()].sort((left, right) => left.join(" › ").localeCompare(right.join(" › "), "ko"));
  if (composer) {
    if (!activeCatalog) return <section className="api-scenario-composer-loading" aria-label="시나리오 작성"><LoadingSpinner label="선택한 서버의 API 문서를 준비하는 중…" /></section>;
    const initialEdit = composer.saved && composer.scenario ? { saved: composer.saved, scenario: composer.scenario } : undefined;
    return <ApiDocumentation
      key={composer.saved?.id ?? "new"}
      mode="compose"
      initialEdit={initialEdit}
      project={project}
      catalog={activeCatalog}
      scope={scope}
      bridge={bridge}
      baseUrl={project.environments.find(environment => environment.id === scope.environmentId)?.baseUrls[scope.serverId] ?? ""}
      busy={busy}
      onBusy={onBusy}
      onRunAction={onRunAction}
      onExecuteSaved={onExecuteSaved}
      onUnsavedChange={onUnsavedChange}
      onCloseComposer={() => { setComposer(null); setEditing(current !== null ? false : true); setDirty(false); setResult(null); onBackToScenarios?.(); }}
      sidebarGroupPath={scenarioGroupPath}
      sidebarGroupPaths={availableGroupPaths}
      onSidebarGroupPathChange={value => { setScenarioGroupPath(value); setDirty(true); }}
      onNewScenario={() => { setScenarioGroupPath([]); }}
      sidebarMetadata={{ groupPath: scenarioGroupPath }}
      onSaved={async item => {
        setCurrent(item);
        setSource(item.source);
        setScenarioGroupPath(item.groupPath ?? []);
        setBindings(item.bindings);
        setDirty(false);
        setError("");
        working(true);
        try { await check(item.source, item.bindings); }
        catch (e) { setError(errorText(e)); }
        finally { working(false); }
        const next = await bridge.listScenarios(project.id);
        if (live.current) setSaved(next);
      }}
    />;
  }
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesSidebarItem = (item: SavedApiScenario | SavedApiSuite) => sidebarSearchText(item).includes(normalizedQuery);
  const sidebarScenarios = saved.filter(matchesSidebarItem);
  const sidebarSuites = suites.filter(matchesSidebarItem);

  return <div className={`api-columns api-scenarios${editorMode ? " api-scenario-editor" : " api-scenario-run"}`}>
    <aside aria-label="저장된 시나리오와 스위트">
      <input data-value-visibility="public" aria-label={editorMode ? "시나리오 검색" : "시나리오·스위트 검색"} placeholder="이름·설명·그룹 검색" value={query} onChange={event => setQuery(event.target.value)} />
      <section className="api-sidebar-section">
        <header><button type="button" className="api-sidebar-section-toggle" aria-expanded={scenariosExpanded} onClick={() => setScenariosExpanded(value => !value)}><span>{scenariosExpanded ? "▾" : "▸"} 시나리오</span><small>{sidebarScenarios.length}{sidebarScenarios.length !== saved.length ? ` / ${saved.length}` : ""}</small></button><button type="button" className="api-sidebar-add" disabled={busy} onClick={openNewScenario}>+ 새 시나리오</button></header>
        {scenariosExpanded && <ScenarioSidebarTree kind="scenario" items={sidebarScenarios} selectedId={suiteSelection === null ? current?.id : null} disabled={busy} onSelect={item => { setSuiteSelection(null); void load(item); }} />}
      </section>
      {!editorMode && <section className="api-sidebar-section api-sidebar-suite-section">
        <header><button type="button" className="api-sidebar-section-toggle" aria-expanded={suitesExpanded} onClick={() => setSuitesExpanded(value => !value)}><span>{suitesExpanded ? "▾" : "▸"} 스위트</span><small>{sidebarSuites.length}{sidebarSuites.length !== suites.length ? ` / ${suites.length}` : ""}</small></button><button type="button" className="api-sidebar-add" disabled={busy} onClick={() => setSuiteSelection("")}>+ 새 스위트</button></header>
        {suitesExpanded && <ScenarioSidebarTree kind="suite" items={sidebarSuites} selectedId={suiteSelection || null} disabled={busy} onSelect={item => setSuiteSelection(item.id)} />}
      </section>}
    </aside>
    {suiteSelection !== null && !editorMode ? <SuitePanel key={suiteSelection} project={project} scope={scope} bridge={bridge} scenarios={saved} suites={suites} selectedId={suiteSelection} onSuitesChange={setSuites} onSelectedIdChange={setSuiteSelection} onBusy={working} /> : <>
    <article className="api-request-panel api-scenario-detail">
      {editorMode && current && <DeleteAction key={current.id} label="시나리오 삭제" disabled={busy} description={`‘${current.name}’${current.draft ? " 초안" : ""}을 프로젝트에서 삭제합니다. 현재 편집 내용도 닫힙니다. API 명세와 전역 변수는 유지됩니다.`} onDelete={async () => {
        await bridge.deleteScenario(project.id, current.id, current.updatedAt);
        setSaved(await bridge.listScenarios(project.id)); setCurrent(null); setSource(""); setScenarioGroupPath([]); setDirty(false); setPreview(null); setResult(null); setBindings({}); setInputs({}); setEditing(editorMode); setNotice("시나리오를 삭제했습니다."); onRunAction(null);
      }} />}
      <header className="api-detail-heading"><div><h2>{preview?.scenario.name ?? current?.name ?? (editorMode ? "새 시나리오" : "시나리오를 선택하세요")}</h2><p className="api-description">{preview?.scenario.description ?? (editorMode ? "API 문서에서 호출 순서를 정하고 요청값·응답 연결을 설정하세요." : "")}</p></div>{current && <div className="api-actions"><button disabled={busy} aria-expanded={editorMode ? editing : undefined} onClick={() => editorMode ? setEditing(!editing) : onEditScenario?.(current)}>{editorMode ? editing ? "편집 닫기" : "편집" : "수정"}</button>{!editorMode && <><button type="button" ref={runButton} className="api-primary" disabled={busy || !canUse} onClick={() => void runScenario()}>{running ? "실행 중…" : result ? "다시 실행" : "실행"}</button>{running && <button type="button" onClick={() => void bridge.cancel(scope)}>취소</button>}</>}</div>}</header>
      {!current && !editorMode && <div className="api-empty"><h3>실행할 시나리오를 선택하세요</h3><p>저장된 시나리오를 선택하면 실행·결과·리포트를 이곳에서 확인합니다.</p><button disabled={busy} onClick={onCreateScenario}>+ 새 시나리오 작성</button></div>}
      {current && editorMode && preview && !editing && <button disabled={busy} onClick={() => openComposer(current, preview)}>Swagger 방식으로 편집</button>}
      {editorMode && editing && <section className="api-source-editor" aria-label="시나리오 편집">
      {!visual && <button type="button" className="api-primary" disabled={busy} onClick={openNewScenario}>Swagger 방식으로 작성</button>}
      {visual ? <ScenarioBuilder source={source} bindings={bindings} project={project} scope={scope} bridge={bridge} onCancel={() => { setVisual(false); working(false); }} onApply={yaml => {
        setSource(yaml); setDirty(true); setPreview(null); setResult(null); setNotice(""); setError(""); setVisual(false);
        void check(yaml).catch(e => setError(errorText(e))).finally(() => working(false));
      }} /> : <>
      <h3>YAML 편집 · 가져오기</h3><p>YAML을 붙여넣거나 파일로 가져온 뒤 서버 연결과 호출 순서를 확인하세요. 엔드포인트 설명과 요청·응답 구조는 연결된 OpenAPI 명세에서 표시합니다. 저장과 실행은 별도 작업입니다.</p>
      <SidebarMetadataFields key={current?.id ?? "new-scenario-yaml"} groupPath={scenarioGroupPath} existingGroupPaths={availableGroupPaths} disabled={busy} onGroupPathChange={path => { setScenarioGroupPath(path); setDirty(true); }} />
      <p>비밀번호·토큰은 YAML에 직접 넣지 말고 <code>inputs</code> 또는 <code>globals</code>를 참조하세요.</p>
      <details><summary>지원 문법 예시</summary><pre>{`version: 1\nid: product/read\nname: 상품 조회\ndescription: 상품 상세 조회를 검증합니다.\nsteps:\n  - id: read\n    name: 상품 상세 조회\n    server: member\n    api:\n      method: GET\n      path: /items/{id}\n    request:\n      pathParams:\n        id: 7\n    expect:\n      - source: status\n        operator: equals\n        value: 200`}</pre></details>
      <label>시나리오 YAML<textarea aria-label="시나리오 YAML" rows={14} spellCheck={false} value={source} disabled={busy} onChange={e => { setSource(e.target.value); setDirty(true); setPreview(null); setResult(null); setNotice(""); }} /></label>
      <div className="api-actions"><button disabled={busy} onClick={async () => { working(true); setError(""); try { const text = await bridge.readScenarioFile(); if (text !== null) { setSource(text); setScenarioGroupPath([]); setDirty(true); setPreview(null); setResult(null); setCurrent(null); setInputs({}); setNotice(""); } } catch (e) { setError(errorText(e)); } finally { working(false); } }}>YAML 파일 가져오기</button><button disabled={busy || !source.trim()} onClick={async () => { working(true); setError(""); setNotice(""); try { await check(); } catch (e) { setError(errorText(e)); setPreview(null); } finally { working(false); } }}>검사·미리보기</button></div>
      {preview && <>        <fieldset disabled={busy}><legend>시나리오의 서버 연결</legend>{[...new Set(preview.scenario.steps.map(s => s.server))].map(key => <label key={key}>{key}<select aria-label={`서버 연결 ${key}`} value={bindings[key] ?? (project.servers.some(s => s.id === key) ? key : "")} onChange={async e => {
          const mapping = { ...bindings, [key]: e.target.value }; setBindings(mapping); setDirty(true); setPreview(null); working(true);
          try { await check(source, mapping); } catch (err) { setError(errorText(err)); } finally { working(false); }
        }}><option value="" disabled>프로젝트 서버 선택</option>{project.servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>)}</fieldset></>}
      </>}
      </section>}
      {preview && editorMode && <>
        {Object.keys(preview.scenario.inputs).length > 0 && <fieldset disabled={busy}><legend>이번 실행의 입력값</legend>{Object.entries(preview.scenario.inputs).map(([key, definition]) => <label key={key}>{key}{definition.required ? " *" : ""} · {definition.type}<input aria-label={`시나리오 입력 ${key}`} data-value-visibility={definition.sensitive ? "sensitive" : undefined} autoComplete="off" type="text" value={inputs[key] ?? ""} onChange={e => setInputs({ ...inputs, [key]: e.target.value })} /></label>)}</fieldset>}
        <div className="api-actions">{editorMode && <button disabled={busy || checkedSource !== source} onClick={async () => {
          working(true); setError(""); setNotice("");
          try { const item = await (canSave ? bridge.saveScenario : bridge.saveScenarioDraft)(scope, source, bindings, current?.id === preview.scenario.id ? current.updatedAt : undefined, { groupPath: scenarioGroupPath }); setCurrent(item); setScenarioGroupPath(item.groupPath ?? []); setDirty(false); setEditing(false); setSaved(await bridge.listScenarios(project.id)); setNotice(canSave ? "시나리오를 저장했습니다." : "초안으로 저장했습니다. 아래 항목을 보완하세요."); } catch (e) { setError(errorText(e)); } finally { working(false); }
        }}>{canSave ? "시나리오 저장" : "초안 저장"}</button>}<button ref={runButton} className="api-primary" disabled={busy || !canUse} onClick={async () => {
          working(true); setRunning(true); setError(""); setNotice("");
          try {
            const parsed = Object.fromEntries(Object.entries(preview.scenario.inputs).filter(([key, d]) => d.required || inputs[key] !== undefined && inputs[key] !== "").map(([key, d]) => [key, d.type === "string" ? inputs[key] ?? "" : JSON.parse(inputs[key] ?? "")]));
            const response = await bridge.runScenario(scenarioScope, source, bindings, parsed as Record<string, Json>);
            rememberResult(response);
          } catch (e) { if (live.current) { setResult(null); setError(e instanceof SyntaxError ? "숫자·불리언·객체·배열 입력은 JSON 형식으로 입력하세요" : errorText(e)); } }
          finally { if (live.current) { working(false); setRunning(false); } }
        }}>{running ? "실행 중…" : result ? "다시 실행" : "시나리오 실행"}</button>{running && <button onClick={() => void bridge.cancel(scope)}>실행 취소</button>}</div>

        {preview.issues.map(issue => <p className="api-warning" key={issue}>{issue}</p>)}
        <h3 className="api-section-title">호출 단계</h3>
        <ol className="api-step-preview api-accordion-editor">{preview.scenario.steps.map((s, index) => {
          const operation = operationForStep(s, catalogs, bindings);
          const method = (operation?.method ?? ("method" in s.api ? s.api.method : "API")).toUpperCase();
          const path = operation?.path ?? ("path" in s.api ? s.api.path : s.api.operationId);
          return <li key={s.id}>
            <details className={`api-step-accordion api-selected-${method.toLowerCase()}`}>
              <summary className="api-step-summary"><span>{index + 1}</span><span className="api-selected-method">{method}</span><code>{path}</code><span className="api-step-summary-name">{s.name || operation?.summary || s.id}</span></summary>
              <div className="api-step-body">
            {operation?.description && <details className="api-step-description swagger-ui"><summary>API 설명 보기</summary><div className="renderedMarkdown" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(descriptionMarkdown.render(operation.description)) }} /></details>}
            <details><summary>요청·검증·값 연결</summary><JsonCode value={{ request: s.request, expect: s.expect, extract: s.extract, valueBindings: preview.scenario.valueBindings }} /></details>
            {s.extract.map(e => <p key={e.target}>응답 {e.pointer ?? e.header} → <code>{e.target}</code></p>)}
              </div>
            </details>
          </li>;
        })}</ol>

      </>}
      {preview && !editorMode && <>
        <section className="api-run-summary" aria-label="시나리오 실행 준비">
          {!!preview.executionIssues?.length && <div role="alert" className="api-warning"><strong>실행 전 설정 필요</strong><ul>{preview.executionIssues.map(issue => {
            const variable = /전역변수 '([A-Za-z][A-Za-z0-9_]*)' 값이 없습니다/.exec(issue)?.[1];
            const stepNumber = /^(\d+)단계/.exec(issue)?.[1];
            const producers = variable ? globalProducerScenarios(variable, saved, preview.scenario.id, scope.environmentId) : [];
            return <li key={issue}>{variable ? <>{stepNumber && Number(stepNumber) <= preview.scenario.steps.length && <><button type="button" className="api-issue-step-link" onClick={() => focusPreview(Number(stepNumber) - 1)}>{stepNumber}단계</button> · </>}<code>{variable}</code> 값 없음 <GlobalVariableSetupLink name={variable} />{producers.length > 0 && <span> · 이 값을 추출하는 시나리오: {producers.join(", ")}. 먼저 실행한 뒤 다시 확인하세요.</span>}</> : issue}</li>;
          })}</ul><button type="button" disabled={busy} onClick={() => void check().catch(e => setError(errorText(e)))}>설정 다시 확인</button></div>}
          {result && result.status !== "passed" && <div role="alert" className="api-warning"><strong>최근 실행 · {result.status}</strong><ul>{result.steps.map((step, index) => step.error && <li key={step.id}><button type="button" className="api-result-error-link" disabled={running} onClick={() => focusResult(step.id)}>{index + 1}단계 · {step.name}: {step.error}</button></li>)}</ul></div>}
          <header className="api-run-summary-heading"><p className="api-spec-meta">{preview.scenario.steps.length}개 API · {project.environments.find(e => e.id === scope.environmentId)?.name}</p><span className={`api-run-status${current?.draft ? " is-draft" : canUse ? " is-ready" : " is-review"}`}>{current?.draft ? "초안" : canUse ? "실행 가능" : "설정 필요"}</span></header>
          {current?.draft && <p className="api-run-notice">초안은 아직 실행할 수 없습니다. <strong>수정</strong>에서 요청값과 검증을 보완한 뒤 <strong>저장</strong>을 누르세요.</p>}
          {preview.issues.length > 0 && <details className="api-run-issues" open={Boolean(current?.draft)}><summary>보완이 필요한 항목 {preview.issues.length}개</summary><ul>{preview.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></details>}
          {current?.draft && preview.issues.length === 0 && <p className="api-run-notice">현재 검사는 통과했지만 아직 초안으로 저장되어 있습니다. <strong>수정</strong>에서 <strong>저장</strong>을 누르면 실행할 수 있습니다.</p>}
          {Object.keys(preview.scenario.inputs).length > 0 && <fieldset disabled={busy}><legend>실행 입력</legend><p className="api-field-help">실행할 때만 사용하는 값입니다. 저장된 시나리오에는 원문이 남지 않습니다.</p>{Object.entries(preview.scenario.inputs).map(([key, definition]) => <label key={key}>{key}{definition.required ? " *" : ""} · {definition.type}<input aria-label={`시나리오 입력 ${key}`} data-value-visibility={definition.sensitive ? "sensitive" : undefined} autoComplete="off" type="text" value={inputs[key] ?? ""} onChange={e => setInputs({ ...inputs, [key]: e.target.value })} /></label>)}</fieldset>}
        </section>
        <div className="api-run-view-switch" role="group" aria-label="시나리오 보기"><button type="button" aria-pressed={runView === "preview" || !result} onClick={() => setRunView("preview")}>설정 미리보기</button><button type="button" aria-pressed={runView === "result" && Boolean(result)} disabled={!result || running} onClick={() => setRunView("result")}>최근 실행</button></div>
        <div hidden={runView === "result" && Boolean(result)}><ScenarioRunFlow key={current?.id} preview={preview} catalogs={catalogs} bindings={bindings} focusRequest={focusRequest} /></div>
      </>}
      {notice && <p role="status">{notice}</p>}{error && <p className="api-warning" role="alert">{error}</p>}
      {(running || result) && <section hidden={!editorMode && !running && runView === "preview"} className={`api-response${running ? " api-response-running" : ""}`} aria-label={running ? "시나리오 실행 중" : "시나리오 실행 결과"}>
        {running ? <><h2>실행 중</h2><ProgressBar label={pendingInput ? "입력 대기 중" : "시나리오 실행 중"} detail={pendingInput ? `${pendingInput.index + 1}/${pendingInput.totalSteps}단계 · ${pendingInput.label ?? pendingInput.name}` : preview ? `${preview.scenario.steps.length}개 API · 순서대로 실행 중` : "순서대로 실행 중"} /></> : result && <>{lastRun && <p className="api-spec-meta">마지막 실행 · {new Date(lastRun.completedAt).toLocaleString()} · 실행 당시 요청·응답 · 새로고침하면 결과가 사라집니다</p>}<ScenarioRunResult result={result} preview={lastRun?.preview ?? preview} catalogs={catalogs} bindings={lastRun?.bindings ?? bindings} focusRequest={resultFocusRequest} /></>}
      </section>}
    </article>
    {pendingInput && <div className="api-input-modal-backdrop" role="presentation"><form className="api-input-modal" role="dialog" aria-modal="true" aria-labelledby="api-input-title" onSubmit={event => void submitPendingInput(event)}>
      <header><div><p className="api-input-kicker">실행 중 입력 · {pendingInput.index + 1}/{pendingInput.totalSteps}단계</p><h2 id="api-input-title">{pendingInput.label ?? pendingInput.name}</h2></div><span>{pendingInput.stepId}</span></header>
      <p>앞 단계 실행이 완료되었습니다. 다음 API를 호출하기 전에 값을 입력하세요.</p>
      <p className="api-input-note">입력값은 이번 실행의 <code>vars.{pendingInput.name}</code>으로만 전달되며 YAML이나 실행 결과에 원문으로 저장되지 않습니다.</p>
      <label>{pendingInput.name}{pendingInput.required ? " *" : ""}<input autoFocus data-value-visibility={pendingInput.sensitive ? "sensitive" : undefined} type={pendingInput.type === "number" ? "number" : "text"} value={inputValue} disabled={inputSubmitting} placeholder={pendingInput.type === "string" ? "값 입력" : `${pendingInput.type} JSON 입력`} onChange={event => setInputValue(event.target.value)} /></label>
      {inputError && <p className="api-warning" role="alert">{inputError}</p>}
      <footer className="api-actions"><button type="button" disabled={inputSubmitting} onClick={() => { setPendingInput(null); void bridge.cancel(scope); }}>실행 취소</button><button type="submit" className="api-primary" disabled={inputSubmitting}>{inputSubmitting ? "전달 중…" : "입력 완료 · 계속"}</button></footer>
    </form></div>}</>}
  </div>;
}
