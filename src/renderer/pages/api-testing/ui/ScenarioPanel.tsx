import { runStatusName } from "../../../entities/api-testing";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ApiCatalog, ApiProject, ApiScope, ApiTestingBridge, ApiScenarioInputRequest, ApiScenarioPreview, ApiScenarioResult, SavedApiScenario, SavedApiSuite } from "../../../../app/api-testing/shared/workspace";
import { parseScenario, stringifyScenario, type Json, type Scenario } from "../../../../app/api-testing/shared/scenario";
import { useSensitiveValues } from "../../../entities/api-testing";
import { useRunAction } from "../../../shared/hooks/useRunAction";
import type { OnRunAction } from "../../../shared/model/run-action";
import { ApiDocumentation } from "./ApiDocumentation";
import { DeleteAction } from "../../../entities/api-testing";
import { ProgressBar } from "../../../shared/ui/ProgressBar";
import { LoadingSpinner } from "../../../shared/ui/LoadingSpinner";
import { GlobalVariableSetupLink } from "../../../entities/api-testing";
import { useGlobalVariableAccess } from "../../../features/api-testing/configure-globals";
import { readLastRun, writeLastRun, type ScenarioLastRun } from "../../../entities/api-testing";
import { SuitePanel } from "./SuitePanel";
import { RunInputModal } from "../../../features/api-testing/submit-run-input";
import { globalProducerScenarios } from "../../../entities/api-testing";
import { ScenarioSidebarTree } from "../../../entities/api-testing";
import { Icon } from "../../../shared/ui/Icon";
import { operationForStep, ScenarioRunFlow, ScenarioRunResult } from "../../../entities/api-testing";
import { YamlCode } from "../../../entities/api-testing";

const errorText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

function sidebarSearchText(item: SavedApiScenario | SavedApiSuite): string {
  let description = "";
  if ("source" in item) {
    try { description = parseScenario(item.source).description ?? ""; }
    catch { /* Invalid drafts are still searchable by their saved name and group. */ }
  }
  return [item.name, item.id, ...(item.groupPath ?? []), description].join(" ").toLocaleLowerCase();
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
  /** Opens the AI authoring tab (a shortcut from the empty detail). */
  onOpenAi?: () => void;
  onEditScenario?: (item: SavedApiScenario) => void;
  onExecuteSaved?: (item: SavedApiScenario) => void;
  runSaved?: SavedApiScenario | null;
  onRunSavedConsumed?: () => void;
  openSaved?: SavedApiScenario | null;
  onOpenSavedConsumed?: () => void;
  onBackToScenarios?: () => void;
  /** Environment and value controls shown in the composer toolbar, which replaces the page header. */
  composeContext?: ReactNode;
};

export function ScenarioPanel({ project, scope, bridge, onBusy, onRunAction, mode = "run", startCreateRequest = 0, editScenarioId, onCreateConsumed, onComposerOpenChange, onUnsavedChange, onCreateScenario, onOpenAi, onEditScenario, onExecuteSaved, runSaved, onRunSavedConsumed, openSaved, onOpenSavedConsumed, onBackToScenarios, composeContext }: ScenarioPanelProps) {
  const editorMode = mode === "editor";
  const globalAccess = useGlobalVariableAccess();
  const sensitiveValues = useSensitiveValues();
  const checkedGlobalRevision = useRef(globalAccess.revision);
  const [query, setQuery] = useState("");
  const [scenariosExpanded, setScenariosExpanded] = useState(true);
  const [suitesExpanded, setSuitesExpanded] = useState(true);
  const [suiteSelection, setSuiteSelection] = useState<string | null>(null);
  const [suites, setSuites] = useState<SavedApiSuite[]>([]);
  const [saved, setSaved] = useState<SavedApiScenario[]>([]);
  const [savedLoaded, setSavedLoaded] = useState(false);
  // Scenarios with steps whose API is gone from this environment's specs (a dot in the list).
  const [specWarnings, setSpecWarnings] = useState<Map<string, string>>(new Map());
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
  const [yamlOpen, setYamlOpen] = useState(false);
  const [yamlCopied, setYamlCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [checkedSource, setCheckedSource] = useState("");
  const [pendingInput, setPendingInput] = useState<ApiScenarioInputRequest | null>(null);
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
    void bridge.listScenarios(project.id).then(v => { if (live.current) { setSaved(v); setSavedLoaded(true); } }).catch(e => { if (live.current) setError(errorText(e)); });
    void bridge.listSuites(project.id).then(v => { if (live.current) setSuites(v); }).catch(e => { if (live.current) setError(errorText(e)); });
    return () => { live.current = false; void bridge.cancel(scope); };
  }, []);
  useEffect(() => {
    if (editorMode) return;
    let active = true;
    void bridge.checkScenarioSpecs(scenarioScope).then(impact => {
      if (active) setSpecWarnings(new Map(impact.missing.map(item => [item.scenarioId, `명세에 없는 API를 쓰는 단계: ${item.steps.join(", ")}`])));
    }).catch(() => {});
    return () => { active = false; };
  }, [scope.projectId, scope.environmentId, saved]);
  useEffect(() => {
    if (editorMode) return;
    let active = true;
    void Promise.all(project.servers.map(async server => [server.id, await bridge.getCatalog({ ...scope, serverId: server.id })] as const))
      .then(entries => { if (active) setCatalogs(Object.fromEntries(entries)); })
      .catch(() => { if (active) setCatalogs({}); });
    return () => { active = false; };
  }, [bridge, editorMode, project.servers, scope.environmentId, scope.projectId]);
  useEffect(() => {
    if (!running) {
      setPendingInput(null);
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
    setCurrent(null); setSource(""); setScenarioGroupPath([]); setDirty(false); setPreview(null); setResult(null); setBindings({}); setInputs({}); setNotice(""); setError("");
    setComposer({});
  };
  useEffect(() => {
    if (!editorMode || !startCreateRequest) return;
    openNewScenario();
    onCreateConsumed?.();
  }, [editorMode, startCreateRequest]);
  useEffect(() => {
    // Reopened editor URL without a scenario (e.g. after a reload): start a new one.
    if (editorMode && !editScenarioId && !startCreateRequest) openNewScenario();
  }, []);
  const openComposer = (item: SavedApiScenario, data: ApiScenarioPreview, mapping = bindings) => {
    const steps = data.scenario.steps.map(step => ({ ...step, server: mapping[step.server] ?? step.server }));
    setComposer({ saved: item, scenario: { ...data.scenario, steps } });
  };
  const load = async (item: SavedApiScenario) => {
    setComposer(null); setCurrent(item); setSource(item.source); setScenarioGroupPath(item.groupPath ?? []); setDirty(false); setBindings(item.bindings); setInputs({}); setResult(null); setPreview(null); setError(""); setNotice(""); working(true);
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
    // Wait for the first list load; an empty list still means "not found".
    if (!editorMode || !editScenarioId || !savedLoaded) return;
    if (openedEditId.current === editScenarioId) return;
    const item = saved.find(candidate => candidate.id === editScenarioId);
    if (item) { openedEditId.current = editScenarioId; void load(item); }
    else setError("수정할 시나리오를 찾지 못했습니다.");
  }, [editorMode, editScenarioId, saved, savedLoaded]);
  const canSave = Boolean(preview && checkedSource === source && preview.issues.length === 0);
  useEffect(() => {
    if (checkedGlobalRevision.current === globalAccess.revision) return;
    checkedGlobalRevision.current = globalAccess.revision;
    if (preview && !busy) void check().catch(e => setError(errorText(e)));
  }, [globalAccess.revision]);
  const canUse = Boolean(canSave && !current?.draft && !preview?.executionIssues?.length);
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
    if (editorMode || !openSaved) return;
    onOpenSavedConsumed?.();
    void load(openSaved);
  }, [openSaved]);
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
    const initialEdit = composer.saved && composer.scenario ? { saved: composer.saved, scenario: composer.scenario } : undefined;
    return <ApiDocumentation
      key={composer.saved?.id ?? "new"}
      mode="compose"
      initialEdit={initialEdit}
      project={project}
      catalog={activeCatalog ?? null}
      scope={scope}
      bridge={bridge}
      baseUrl={project.environments.find(environment => environment.id === scope.environmentId)?.baseUrls[scope.serverId] ?? ""}
      busy={busy}
      onBusy={onBusy}
      onRunAction={onRunAction}
      onExecuteSaved={onExecuteSaved}
      onUnsavedChange={onUnsavedChange}
      onCloseComposer={() => { setComposer(null); setDirty(false); setResult(null); onBackToScenarios?.(); }}
      sidebarGroupPath={scenarioGroupPath}
      sidebarGroupPaths={availableGroupPaths}
      onSidebarGroupPathChange={value => { setScenarioGroupPath(value); setDirty(true); }}
      onNewScenario={() => { setScenarioGroupPath([]); }}
      toolbarContext={composeContext}
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
  if (editorMode) return <section className="api-scenario-composer-loading" aria-label="시나리오 작성">
    {error ? <><p className="api-warning" role="alert">{error}</p><button type="button" onClick={onBackToScenarios}>← 시나리오 목록</button></> : <LoadingSpinner label="시나리오를 여는 중…" />}
  </section>;
  const duplicate = async (item: SavedApiScenario) => {
    if (!preview) return;
    working(true); setError(""); setNotice("");
    try {
      const steps = preview.scenario.steps.map(step => ({ ...step, server: bindings[step.server] ?? step.server }));
      const base = `${preview.scenario.name.replace(/ 사본(?: \d+)?$/, "")} 사본`;
      const names = new Set(saved.map(scenario => scenario.name));
      let name = base;
      for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
      const copy = { ...preview.scenario, steps, id: `scenario-${crypto.randomUUID()}`, name };
      const save = item.draft || preview.issues.length ? bridge.saveScenarioDraft : bridge.saveScenario;
      const created = await save(scenarioScope, stringifyScenario(copy, true), {}, undefined, { groupPath: item.groupPath ?? [] });
      const next = await bridge.listScenarios(project.id);
      if (!live.current) return;
      setSaved(next);
      working(false);
      await load(created);
      setNotice(`‘${created.name}’으로 복제했습니다. 수정에서 이름과 값을 바꾸세요.`);
    } catch (e) { if (live.current) setError(errorText(e)); }
    finally { if (live.current) working(false); }
  };
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchesSidebarItem = (item: SavedApiScenario | SavedApiSuite) => sidebarSearchText(item).includes(normalizedQuery);
  const sidebarScenarios = saved.filter(matchesSidebarItem);
  const sidebarSuites = suites.filter(matchesSidebarItem);

  return <div className="api-columns api-scenarios api-scenario-run">
    <aside aria-label="저장된 시나리오와 스위트">
      <input data-value-visibility="public" aria-label="시나리오·스위트 검색" placeholder="이름·설명·그룹 검색" value={query} onChange={event => setQuery(event.target.value)} />
      <section className="api-sidebar-section">
        <header><button type="button" className="api-sidebar-section-toggle" aria-expanded={scenariosExpanded} onClick={() => setScenariosExpanded(value => !value)}><span className="api-sidebar-section-label">시나리오<small>{sidebarScenarios.length}{sidebarScenarios.length !== saved.length ? ` / ${saved.length}` : ""}</small></span><Icon name="expand_more" size={18} className="api-sidebar-chevron" /></button><button type="button" className="api-sidebar-add" disabled={busy} onClick={openNewScenario}>+ 새 시나리오</button></header>
        {scenariosExpanded && <ScenarioSidebarTree kind="scenario" expandAll={Boolean(normalizedQuery)} warnings={specWarnings} items={sidebarScenarios} selectedId={suiteSelection === null ? current?.id : null} disabled={busy} onSelect={item => { setSuiteSelection(null); void load(item); }} />}
      </section>
      <section className="api-sidebar-section api-sidebar-suite-section">
        <header><button type="button" className="api-sidebar-section-toggle" aria-expanded={suitesExpanded} onClick={() => setSuitesExpanded(value => !value)}><span className="api-sidebar-section-label">스위트<small>{sidebarSuites.length}{sidebarSuites.length !== suites.length ? ` / ${suites.length}` : ""}</small></span><Icon name="expand_more" size={18} className="api-sidebar-chevron" /></button><button type="button" className="api-sidebar-add" disabled={busy} onClick={() => setSuiteSelection("")}>+ 새 스위트</button></header>
        {suitesExpanded && <ScenarioSidebarTree kind="suite" expandAll={Boolean(normalizedQuery)} items={sidebarSuites} selectedId={suiteSelection || null} disabled={busy} onSelect={item => setSuiteSelection(item.id)} />}
      </section>
    </aside>
    {suiteSelection !== null ? <SuitePanel key={suiteSelection} project={project} scope={scope} bridge={bridge} scenarios={saved} suites={suites} selectedId={suiteSelection} onSuitesChange={setSuites} onSelectedIdChange={setSuiteSelection} onBusy={working} /> : <>
    <article className="api-request-panel api-scenario-detail">
      {(current || preview) && <header className="api-detail-heading"><div><h2>{preview?.scenario.name ?? current?.name}</h2><p className="api-description">{preview?.scenario.description ?? ""}</p></div>{current && <div className="api-actions api-detail-actions"><span className="api-action-group" role="group" aria-label="실행"><button type="button" ref={runButton} className="api-primary" disabled={busy || !canUse} onClick={() => void runScenario()}>{running ? "실행 중…" : result ? "다시 실행" : "실행"}</button>{running && <button type="button" onClick={() => void bridge.cancel(scope)}>실행 중단</button>}</span><span className="api-action-group" role="group" aria-label="편집"><button type="button" disabled={busy} onClick={() => onEditScenario?.(current)}>수정</button><button type="button" disabled={busy || !preview} title="이 시나리오를 복사해 새 시나리오로 저장합니다" onClick={() => void duplicate(current)}>복제</button></span><span className="api-action-group" role="group" aria-label="관리"><DeleteAction key={current.id} label="시나리오 삭제" disabled={busy} description={`‘${current.name}’${current.draft ? " 초안" : ""}을 프로젝트에서 삭제합니다. API 명세와 전역변수는 유지됩니다.`} onDelete={async () => {
        await bridge.deleteScenario(project.id, current.id, current.updatedAt);
        setSaved(await bridge.listScenarios(project.id)); setCurrent(null); setSource(""); setScenarioGroupPath([]); setDirty(false); setPreview(null); setResult(null); setBindings({}); setInputs({}); setNotice("시나리오를 삭제했습니다."); onRunAction(null);
      }} /></span></div>}</header>}
      {!current && <div className="api-empty"><h3>시나리오를 고르거나 새로 만드세요</h3><p>왼쪽 목록에서 고르면 실행 흐름과 최근 결과를 여기서 봅니다.</p>
        <div className="api-actions">{onCreateScenario && <button type="button" className="api-primary" disabled={busy} onClick={onCreateScenario}>새 시나리오 만들기</button>}{onOpenAi && <button type="button" disabled={busy} onClick={onOpenAi}>AI로 만들기</button>}</div>
      </div>}
      {preview && <>
        <section className="api-run-summary" aria-label="시나리오 실행 준비">
          {!!preview.executionIssues?.length && <div role="alert" className="api-warning"><strong>실행 전 설정 필요</strong><ul>{preview.executionIssues.map(issue => {
            const variable = /전역변수 '([A-Za-z][A-Za-z0-9_]*)' 값이 없습니다/.exec(issue)?.[1];
            const stepNumber = /^(\d+)단계/.exec(issue)?.[1];
            const producers = variable ? globalProducerScenarios(variable, saved, preview.scenario.id, scope.environmentId) : [];
            return <li key={issue}>{variable ? <>{stepNumber && Number(stepNumber) <= preview.scenario.steps.length && <><button type="button" className="api-issue-step-link" onClick={() => focusPreview(Number(stepNumber) - 1)}>{stepNumber}단계</button> · </>}<code>{variable}</code> 값 없음 <GlobalVariableSetupLink onConfigure={globalAccess.open} name={variable} />{producers.length > 0 && <span> · 이 값을 추출하는 시나리오: {producers.join(", ")}. 먼저 실행한 뒤 다시 확인하세요.</span>}</> : issue}</li>;
          })}</ul><button type="button" disabled={busy} onClick={() => void check().catch(e => setError(errorText(e)))}>설정 다시 확인</button></div>}
          {result && result.status !== "passed" && <div role="alert" className="api-warning"><strong>최근 실행 · {runStatusName(result.status)}</strong><ul>{result.steps.map((step, index) => step.error && <li key={step.id}><button type="button" className="api-result-error-link" disabled={running} onClick={() => focusResult(step.id)}>{index + 1}단계 · {step.name}: {step.error}</button></li>)}</ul></div>}
          {current?.draft && <p className="api-run-notice">초안은 아직 실행할 수 없습니다. <strong>수정</strong>에서 요청값과 검증을 보완한 뒤 <strong>저장</strong>을 누르세요.</p>}
          {preview.issues.length > 0 && <details className="api-run-issues" open={Boolean(current?.draft)}><summary>보완이 필요한 항목 {preview.issues.length}개</summary><ul>{preview.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></details>}
          {current?.draft && preview.issues.length === 0 && <p className="api-run-notice">현재 검사는 통과했지만 아직 초안으로 저장되어 있습니다. <strong>수정</strong>에서 <strong>저장</strong>을 누르면 실행할 수 있습니다.</p>}
          {Object.keys(preview.scenario.inputs).length > 0 && <fieldset disabled={busy}><legend>실행 입력</legend><p className="api-field-help">실행할 때만 사용하는 값입니다. 저장된 시나리오에는 원문이 남지 않습니다.</p>{Object.entries(preview.scenario.inputs).map(([key, definition]) => <label key={key}>{key}{definition.required ? " *" : ""} · {definition.type}<input aria-label={`시나리오 입력 ${key}`} data-value-visibility={definition.sensitive ? "sensitive" : undefined} autoComplete="off" type="text" value={inputs[key] ?? ""} onChange={e => setInputs({ ...inputs, [key]: e.target.value })} /></label>)}</fieldset>}
        </section>
        {/* One row: which view, and what this scenario is (step count, environment, readiness). */}
        <div className="api-run-view-bar">
          <div className="api-run-view-switch" role="group" aria-label="시나리오 보기"><button type="button" aria-pressed={runView === "preview" || !result} onClick={() => setRunView("preview")}>실행 흐름</button><button type="button" aria-pressed={runView === "result" && Boolean(result)} disabled={!result || running} onClick={() => setRunView("result")}>최근 실행</button></div>
          <p className="api-spec-meta">{preview.scenario.steps.length}개 API · 순서대로 호출 · {project.environments.find(e => e.id === scope.environmentId)?.name}<span className={`api-run-status${current?.draft ? " is-draft" : canUse ? " is-ready" : " is-review"}`}>{current?.draft ? "초안" : canUse ? "실행 가능" : "설정 필요"}</span></p>
        </div>
        <div hidden={runView === "result" && Boolean(result)}><ScenarioRunFlow onConfigureGlobal={globalAccess.open} key={current?.id} preview={preview} catalogs={catalogs} bindings={bindings} focusRequest={focusRequest} /></div>
      </>}
      {notice && <p role="status">{notice}</p>}{error && <p className="api-warning" role="alert">{error}</p>}
      {(running || result) && <section hidden={!running && runView === "preview"} className={`api-response${running ? " api-response-running" : ""}`} aria-label={running ? "시나리오 실행 중" : "시나리오 실행 결과"}>
        {running ? <><h2>실행 중</h2><ProgressBar label={pendingInput ? "입력 대기 중" : "시나리오 실행 중"} detail={pendingInput ? `${pendingInput.index + 1}/${pendingInput.totalSteps}단계 · ${pendingInput.label ?? pendingInput.name}` : preview ? `${preview.scenario.steps.length}개 API · 순서대로 실행 중` : "순서대로 실행 중"} /></> : result && <>{lastRun && <p className="api-spec-meta">마지막 실행 {new Date(lastRun.completedAt).toLocaleString()} · 새로고침하면 사라집니다</p>}<ScenarioRunResult result={result} preview={lastRun?.preview ?? preview} catalogs={catalogs} bindings={lastRun?.bindings ?? bindings} focusRequest={resultFocusRequest} /></>}
      </section>}
      {preview && <details key={current?.id} className="api-scenario-yaml" onToggle={event => setYamlOpen(event.currentTarget.open)}>
        <summary>YAML 보기</summary>
        {yamlOpen && (() => {
          const yaml = stringifyScenario(preview.scenario, false, step => operationForStep(step, catalogs, bindings), Object.fromEntries(project.servers.map(server => [server.id, server.name])));
          return <>
            <div className="api-scenario-yaml-tools"><small>AI에게 보여주거나 공유할 때 쓰는 간단한 형태입니다.</small><button type="button" onClick={() => void navigator.clipboard.writeText(yaml).then(() => { setYamlCopied(true); window.setTimeout(() => setYamlCopied(false), 1200); })}>{yamlCopied ? "복사됨" : "YAML 복사"}</button></div>
            <YamlCode label="시나리오 YAML" source={yaml} />
          </>;
        })()}
      </details>}
    </article>
    {pendingInput && <RunInputModal key={pendingInput.requestId} request={pendingInput} scope={scenarioScope} bridge={bridge} onSubmitted={() => setPendingInput(null)} onCancel={() => { setPendingInput(null); void bridge.cancel(scope); }} />}</>}
  </div>;
}
