import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import type { Scenario } from "../../../../app/api-testing/shared/scenario";
import type { ApiCatalog, ApiDocInput, ApiScope, ApiTestingBridge, ApiSidebarMetadata } from "../../../../app/api-testing/shared/workspace";
import { SelectedApiList } from "../../../features/api-testing/edit-scenario";
import { useRunAction } from "../../../shared/hooks/useRunAction";
import type { OnRunAction } from "../../../shared/model/run-action";
import { ScenarioBuilder } from "../../../features/api-testing/edit-scenario";
import type { ApiProject, SavedApiScenario } from "../../../../app/api-testing/shared/workspace";
import { apiReference } from "../../../features/api-testing/edit-scenario";
import { Icon } from "../../../shared/ui/Icon";
import { GlobalVariableSetupLink } from "../../../entities/api-testing";
import { useGlobalVariableAccess } from "../../../features/api-testing/configure-globals";
import { ScenarioSettingsSummary } from "../../../features/api-testing/edit-scenario";
import { globalProducerScenarios } from "../../../entities/api-testing";
import { SidebarMetadataFields } from "../../../entities/api-testing";
import { type SwaggerSystem, type Selection } from "../model/swagger-types";
import { updateDeepLinkHash, applyDeepLink, handleSwaggerClick } from "../lib/swagger-deep-link";
import { buildSpec } from "../lib/swagger-request";
import { submitMethods, createSwaggerPlugin } from "./swagger-plugin";
import { LoadingSpinner } from "../../../shared/ui/LoadingSpinner";

const StableSwaggerUI = memo(SwaggerUI);
const emptyCatalogs: Record<string, ApiCatalog | null> = {};

export function ApiDocumentation({ catalog, scope, bridge, baseUrl, busy, onBusy, onRunAction, project, initialEdit, onEditConsumed, mode = "document", onCloseComposer, onSaved, onUnsavedChange, onExecuteSaved, sidebarGroupPath, sidebarGroupPaths = [], onSidebarGroupPathChange, onNewScenario, sidebarMetadata, toolbarContext }: {
  catalog: ApiCatalog | null; scope: ApiScope; bridge: ApiTestingBridge; baseUrl: string; busy: boolean;
  onBusy: (value: boolean) => void; onRunAction: OnRunAction;
  project: ApiProject;
  initialEdit?: { saved: SavedApiScenario; scenario: Scenario };
  onEditConsumed?: () => void;
  mode?: "document" | "compose";
  onCloseComposer?: () => void;
  onSaved?: (item: SavedApiScenario) => void | Promise<void>;
  onExecuteSaved?: (item: SavedApiScenario) => void;
  onUnsavedChange?: (dirty: boolean) => void;
  sidebarGroupPath?: string[];
  sidebarGroupPaths?: string[][];
  onSidebarGroupPathChange?: (value: string[]) => void;
  onNewScenario?: () => void;
  sidebarMetadata?: ApiSidebarMetadata;
  toolbarContext?: ReactNode;
}) {
  const globalAccess = useGlobalVariableAccess();
  const composeOnly = mode === "compose";
  const ownsRunAction = !composeOnly && !initialEdit;
  const [composing, setComposing] = useState(composeOnly || Boolean(initialEdit));
  const [composeServerId, setComposeServerId] = useState(scope.serverId);
  const [composeCatalogState, setComposeCatalogState] = useState<{
    projectId: string; environmentId: string; values: Record<string, ApiCatalog | null>;
  } | null>(null);
  // Keep the draft mounted, but never show another environment's catalogs while loading.
  const currentCatalogState = composeCatalogState?.projectId === scope.projectId && composeCatalogState.environmentId === scope.environmentId ? composeCatalogState : null;
  const composeCatalogs = currentCatalogState?.values ?? emptyCatalogs;
  const composeCatalogLoading = composing && !currentCatalogState;
  useEffect(() => {
    setComposeServerId(current => project.servers.some(server => server.id === current) ? current : scope.serverId);
  }, [project.servers, scope.serverId]);
  useEffect(() => {
    if (!composing) return;
    let live = true;
    setComposeCatalogState(null);
    void Promise.all(project.servers.map(async server => {
      try { return [server.id, await bridge.getCatalog({ ...scope, serverId: server.id })] as const; }
      catch { return [server.id, null] as const; }
    })).then(entries => {
      if (live) setComposeCatalogState({ projectId: scope.projectId, environmentId: scope.environmentId, values: Object.fromEntries(entries) });
    });
    return () => { live = false; };
  }, [bridge, composing, project.servers, scope.environmentId, scope.projectId]);
  useEffect(() => { if (initialEdit) onEditConsumed?.(); }, []);
  // A saved scenario is opened to change values, so it starts on step 2; a new one picks APIs first.
  const [composeView, setComposeView] = useState<"select" | "edit">(initialEdit?.scenario.steps.length ? "edit" : "select");
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [Markdown, setMarkdown] = useState<ComponentType<any> | undefined>();
  const composeToolbar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!composing) return;
    const frame = requestAnimationFrame(() => composeToolbar.current?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [composing]);
  const [draft, setDraft] = useState<Scenario>(() => initialEdit?.scenario ?? ({ version: 1, id: `scenario-${crypto.randomUUID()}`, name: "", onFailure: "stop", inputs: {}, vars: {}, valueBindings: [], steps: [] }));
  const [saved, setSaved] = useState<SavedApiScenario | null>(initialEdit?.saved ?? null);
  const [saving, setSaving] = useState(false);
  const runAfterSave = useRef(false);
  const editorFormHost = useRef<HTMLDivElement>(null);
  const ignoreRunAction = useRef<OnRunAction>(() => {});
  const saveAndRun = () => {
    const form = editorFormHost.current?.querySelector("form");
    if (!form || !form.reportValidity()) return;
    runAfterSave.current = true;
    form.requestSubmit();
    runAfterSave.current = false;
  };
  useRunAction(composeOnly ? onRunAction : ignoreRunAction.current, saveAndRun, saving || composeView !== "edit" || !draft.steps.length || !onExecuteSaved, "시나리오 실행");
  const [notice, setNotice] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [producerScenarios, setProducerScenarios] = useState<SavedApiScenario[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const displayCatalog = composing
    ? composeCatalogs[composeServerId] ?? null
    : catalog;
  const displayBaseUrl = composing
    ? project.environments.find(environment => environment.id === scope.environmentId)?.baseUrls[composeServerId] ?? ""
    : baseUrl;
  const newScenario = () => {
    onNewScenario?.();
    const url = new URL(window.location.href);
    if (url.hash) { url.hash = ""; window.history.replaceState(window.history.state, "", url.href); }
    setActiveStepId(null);
    setComposeView("select");
    setDraft({ version: 1, id: `scenario-${crypto.randomUUID()}`, name: "", onFailure: "stop", inputs: {}, vars: {}, valueBindings: [], steps: [] });
    setSaved(null); setDirty(false); setIssues([]); setNotice(""); setConfirmClose(false);
    setEditorVersion(version => version + 1);
  };
  // Links point at step ids, so reordering keeps them; saved YAML renumbers {{steps.N}}.
  // A source moved after its use or deleted is reported by the scenario check.
  const changeDraft = (next: Scenario) => {
    setDraft(next); setDirty(true); setNotice(""); setIssues([]);
  };
  // Opening the composer is an editing state, not an in-flight operation. Keep
  // the shared busy flag for work that actually blocks the UI so the scenario
  // runner can become available again after a save.
  useEffect(() => { onBusy(saving); }, [saving, onBusy]);
  useEffect(() => {
    onUnsavedChange?.(composing && dirty);
    return () => onUnsavedChange?.(false);
  }, [composing, dirty, onUnsavedChange]);
  const composingRef = useRef(composing);
  composingRef.current = composing;
  const catalogRef = useRef(catalog);
  const baseUrlRef = useRef(baseUrl);
  const bridgeRef = useRef(bridge);
  const scopeRef = useRef(scope);
  const systemRef = useRef<SwaggerSystem | null>(null);
  const docInputsRef = useRef<Record<string, ApiDocInput>>({});
  useEffect(() => {
    docInputsRef.current = {};
    if (composeOnly) return;
    let live = true;
    void Promise.resolve().then(() => bridge.getDocInputs(scope)).then(inputs => { if (live) docInputsRef.current = inputs; }).catch(() => undefined);
    return () => { live = false; };
  }, [bridge, composeOnly, scope.projectId, scope.environmentId, scope.serverId]);
  const locateCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => locateCleanup.current?.(), []);
  const locateStep = (step: Scenario["steps"][number]) => {
    locateCleanup.current?.();
    if (composing && step.server !== composeServerId) {
      if (!project.servers.some(server => server.id === step.server)) {
        setNotice("이 단계의 서버를 프로젝트에서 찾을 수 없습니다.");
        return;
      }
      setComposeServerId(step.server);
      setActiveStepId(step.id);
      setNotice("왼쪽 API 문서를 이 단계의 서버로 전환했습니다.");
      return;
    }
    const system = systemRef.current;
    const operation = displayCatalog?.operations.find(op => "operationId" in step.api ? op.operationId === step.api.operationId : op.path === step.api.path && op.method.toUpperCase() === step.api.method);
    if (!system || !operation) { setNotice("현재 API 명세에서 이 API를 찾을 수 없습니다."); return; }
    setActiveStepId(step.id);
    system.layoutActions.updateFilter("");
    for (const tag of operation.tags?.length ? operation.tags : [operation.tag]) system.layoutActions.show(["operations-tag", tag], true);
    const root = document.querySelector(".api-swagger-renderer");
    if (!root) return;
    let highlighted: HTMLElement | undefined;
    const find = () => {
      const target = [...root.querySelectorAll<HTMLElement>(".opblock")].find(el => el.dataset.checklyPath === operation.path && el.dataset.checklyMethod?.toUpperCase() === operation.method.toUpperCase());
      if (!target) return false;
      highlighted = target;
      const tag = target.dataset.checklyDeepLinkTag, id = target.dataset.checklyDeepLinkOperation;
      if (tag && id) { system.layoutActions.show(["operations", tag, id], true); updateDeepLinkHash(["operations", tag, id], true); }
      target.scrollIntoView({ block: "center" });
      target.classList.add("api-located-operation");
      return true;
    };
    const observer = new MutationObserver(() => { if (find()) observer.disconnect(); });
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-checkly-path", "data-checkly-method"] });
    const frame = requestAnimationFrame(() => { if (find()) observer.disconnect(); });
    const timeout = window.setTimeout(() => { observer.disconnect(); highlighted?.classList.remove("api-located-operation"); }, 2500);
    locateCleanup.current = () => { cancelAnimationFrame(frame); window.clearTimeout(timeout); observer.disconnect(); highlighted?.classList.remove("api-located-operation"); };
  };
  const selectedRef = useRef<Selection | null>(null);
  const busyRef = useRef(busy);
  catalogRef.current = displayCatalog;
  baseUrlRef.current = displayBaseUrl;
  bridgeRef.current = bridge;
  scopeRef.current = scope;
  busyRef.current = busy;

  const publishSelection = (selection: Selection | null) => {
    selectedRef.current = selection;
    if (!ownsRunAction) return;
    if (!selection || composingRef.current) {
      onRunAction(null);
      return;
    }
    onRunAction({
      disabled: busyRef.current,
      run: () => {
        const current = systemRef.current;
        const selected = selectedRef.current;
        if (current && selected && !composingRef.current) void current.specActions.execute(selected);
      },
    });
  };
  const plugin = useMemo(() => createSwaggerPlugin({ catalogRef, baseUrlRef, bridgeRef, scopeRef, systemRef, selectedRef, busyRef, publishSelection, setBusy: onBusy, composingRef, docInputsRef }), []);
  const plugins = useMemo(() => [plugin], [plugin]);
  const onComplete = useMemo(() => (value: unknown) => {
    systemRef.current = value as SwaggerSystem;
    setMarkdown(() => (value as SwaggerSystem).getComponent("Markdown"));
    applyDeepLink(systemRef.current, window.location.hash);
  }, []);
  const spec = useMemo(() => displayCatalog ? buildSpec(displayCatalog, displayBaseUrl) : undefined, [displayBaseUrl, displayCatalog]);

  useLayoutEffect(() => {
    if (!composing) return;
    const root = document.querySelector<HTMLElement>(".api-swagger-renderer");
    if (!root) return;
    const created = new Set<HTMLButtonElement>();
    const addButton = (host: Element, data: Record<string, string>, label: string) => {
      if (host.querySelector(":scope > .api-operation-add")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "api-operation-add";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.disabled = saving;
      for (const [key, value] of Object.entries(data)) button.dataset[key] = value;
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.classList.add("app-icon", "api-operation-icon");
      icon.setAttribute("aria-hidden", "true");
      icon.setAttribute("focusable", "false");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.setAttribute("fill", "currentColor");
      icon.innerHTML = `<path d="M11 5h2v14h-2zM5 11h14v2H5z" />`;
      button.append(icon);
      host.append(button);
      created.add(button);
    };
    const install = () => {
      for (const block of root.querySelectorAll<HTMLElement>(".opblock")) {
        const path = block.dataset.checklyPath;
        const method = block.dataset.checklyMethod;
        const summary = block.querySelector<HTMLElement>(":scope > .opblock-summary");
        if (path && method && summary) addButton(summary, { checklyPath: path, checklyMethod: method }, "시나리오에 API 추가");
      }
    };
    install();
    const observer = new MutationObserver(install);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-checkly-path", "data-checkly-method", "data-checkly-param-name", "data-checkly-param-in"] });
    return () => { observer.disconnect(); for (const button of created) button.remove(); };
  }, [composeServerId, displayCatalog, composing, saving]);

  useEffect(() => {
    const handleNavigation = () => applyDeepLink(systemRef.current, window.location.hash);
    window.addEventListener("hashchange", handleNavigation);
    window.addEventListener("popstate", handleNavigation);
    const timer = window.setTimeout(handleNavigation, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", handleNavigation);
      window.removeEventListener("popstate", handleNavigation);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (ownsRunAction) onRunAction(null);
      if (busyRef.current) void bridge.cancel(scopeRef.current);
      onBusy(false);
    };
  }, [bridge, onBusy, onRunAction, ownsRunAction, scope.environmentId, scope.projectId, scope.serverId]);

  return <section className="api-documentation api-swagger-ui" aria-label="API 문서 목록" onClick={handleSwaggerClick}
    onClickCapture={event => {
      if (!composing || !(event.target instanceof Element)) return;
      const addButton = event.target.closest<HTMLElement>(".api-operation-add");
      if (addButton) {
        event.preventDefault(); event.stopPropagation();
        if (saving) return;
        const block = addButton.closest<HTMLElement>(".opblock");
        const operation = displayCatalog?.operations.find(o => o.path === block?.dataset.checklyPath && o.method.toLowerCase() === block?.dataset.checklyMethod?.toLowerCase());
        if (operation) changeDraft({ ...draft, steps: [...draft.steps, {
          id: `step-${crypto.randomUUID()}`, name: operation.summary || `${operation.method} ${operation.path}`,
          server: composeServerId, api: apiReference(operation), request: {}, extract: [],
        }] });
        return;
      }
      if (saving) return;
    }}>
    <div className={`api-actions${composing ? " api-compose-toolbar" : ""}`} ref={composeToolbar}>
      {composeOnly || initialEdit ? <button type="button" disabled={saving || (!composing && busy)} aria-pressed={composing} onClick={() => {
        if (composing && dirty) { setConfirmClose(true); return; }
        if (composing) {
          setComposing(false);
          onCloseComposer?.();
        } else {
          setComposing(true);
        }
        if (ownsRunAction) onRunAction(null);
      }} aria-label={composing ? "시나리오 목록으로" : undefined} title={composing ? "시나리오 목록으로" : undefined}>{composing ? <>← <span className="api-compose-wide">시나리오 </span>목록</> : "수정"}</button> : null}
      {composing && <div className="api-compose-heading">
        <strong className="api-compose-title" title={saved ? `시나리오 수정 · ${saved.name}` : "새 시나리오"}>{saved ? `시나리오 수정 · ${saved.name}` : "새 시나리오"}</strong>
        <span className="api-compose-status"><span role="status">{draft.steps.length ? `${draft.steps.length}개 단계` : "API를 선택하세요"}{draft.steps.length ? dirty ? " · 저장 안 됨" : saved ? saved.draft ? " · 초안 저장됨 (실행 불가)" : " · 저장됨" : "" : ""}</span>{saved && <button type="button" className="api-compose-link" disabled={saving || dirty} title={dirty ? "저장한 뒤 새 시나리오를 시작할 수 있습니다" : undefined} onClick={newScenario}>+ 이어서 새 시나리오</button>}</span>
      </div>}
      {composing && <nav className="api-compose-steps" aria-label="시나리오 작성 단계">
        <button type="button" aria-current={composeView === "select" ? "step" : undefined} disabled={saving} onClick={() => setComposeView("select")} title="API 추가·삭제와 순서 정하기"><span>1</span>API 선택</button>
        <Icon name="expand_more" size={14} className="api-compose-step-separator" />
        <button type="button" aria-current={composeView === "edit" ? "step" : undefined} disabled={saving || !draft.steps.length} onClick={() => setComposeView("edit")} title="요청값·응답 연결·검증 설정 후 저장"><span>2</span>값 설정</button>
      </nav>}
      {composing && toolbarContext}
    </div>
    {confirmClose && <div className="api-confirm-dialog-backdrop">
      <section className="api-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="api-compose-close-title">
        <h2 id="api-compose-close-title">저장하지 않은 변경사항</h2>
        <p>현재 시나리오 수정 내용이 저장되지 않았습니다. 닫으면 수정 내용이 사라집니다.</p>
        <div className="api-actions">
          <button type="button" autoFocus onClick={() => setConfirmClose(false)}>계속 작성</button>
          <button type="button" className="api-danger-action" onClick={() => { newScenario(); setComposing(false); onCloseComposer?.(); }}>변경사항 버리고 닫기</button>
        </div>
      </section>
    </div>}
    {!(composing && composeView === "edit") && <p className={`api-spec-meta${composing ? " api-compose-meta" : ""}`}>API 문서의 응답은 원문 그대로 보이고 저장되지 않습니다. 화면 공유에 주의하세요.</p>}
    <div className={composing ? `api-compose-layout${composeView === "select" ? " api-selection-layout" : " api-edit-layout"}` : undefined}>
    <div className="api-swagger-renderer" hidden={composing && composeView === "edit"} data-scroll="light">
      {composing && project.servers.length > 1 && <div className="api-compose-server-switch">
        <label>API 문서 서버<select aria-label="Swagger 서버" value={composeServerId} disabled={saving || composeCatalogLoading} onChange={event => {
          const nextServerId = event.target.value;
          setComposeServerId(nextServerId);
          setActiveStepId(null);
          setNotice("");
          window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#/`);
        }}>{project.servers.map(server => <option key={server.id} value={server.id}>{server.name}</option>)}</select></label>
        <code>{displayBaseUrl || "기본 주소 없음"}</code>
        {composeCatalogLoading && <small>명세를 불러오는 중…</small>}
      </div>}
      {displayCatalog ? <StableSwaggerUI
        key={`${scope.environmentId}:${composeServerId}:${displayCatalog.importedAt}`}
        spec={spec}
        plugins={plugins}
        onComplete={onComplete}
        // Docs start folded: every rendered operation re-computes on each keystroke in Try it out.
        // The composer has no Try it out, so it keeps the list open for picking APIs.
        docExpansion={composing ? "list" : "none"}
        deepLinking
        filter
        displayRequestDuration
        validatorUrl={null}
        defaultModelsExpandDepth={-1}
        defaultModelExpandDepth={1}
        // While composing the docs are for reading and adding APIs; values are set in step 2.
        supportedSubmitMethods={composing ? [] : submitMethods}
        showExtensions={false}
        showCommonExtensions={false}
      /> : composeCatalogLoading ? <LoadingSpinner label="선택한 서버의 API 문서를 준비하는 중…" /> : <div className="api-empty api-compose-server-empty"><h2>API 명세를 가져오세요</h2><p>선택한 서버·환경에 API 명세가 없습니다.</p></div>}
    </div>
    {composing && composeView === "select" && <aside className="api-selection-basket" aria-label="선택한 API" data-scroll="light">
      <h2>선택한 API · {draft.steps.length}개</h2>
      <p className="api-compose-legend"><Icon name="add" size={14} />로 추가 · <Icon name="expand_more" size={14} />로 상세 열기 · 요청값은 2단계에서 설정</p>
      <SelectedApiList scenario={draft} disabled={saving} onChange={changeDraft} onLocate={locateStep} getOperation={step => {
        const stepCatalog = composeCatalogs[step.server];
        return stepCatalog?.operations.find(operation => "operationId" in step.api ? operation.operationId === step.api.operationId : operation.path === step.api.path && operation.method.toUpperCase() === step.api.method);
      }} />
      {activeStepId && draft.steps.some(step => step.id === activeStepId) && <p className="api-field-help">{draft.steps.findIndex(step => step.id === activeStepId) + 1}단계를 문서에서 보는 중입니다.</p>}
      {notice && <p role="status">{notice}</p>}
      <button type="button" className="api-primary" disabled={saving || !draft.steps.length} onClick={() => setComposeView("edit")}>선택 및 순서 설정 완료</button>
    </aside>}
    {composing && composeView === "edit" && <ScenarioSettingsSummary globalRevision={globalAccess.revision} onConfigureGlobal={globalAccess.open} scenario={draft} catalogs={composeCatalogs} projectId={scope.projectId} bridge={bridge} onSelect={setActiveStepId} />}
    {composing && <aside hidden={composeView !== "edit"} className="api-compose-editor" aria-label="Swagger 시나리오 작성" data-scroll="light" onChangeCapture={() => { setDirty(true); setNotice(""); }}>
      <div ref={editorFormHost}><ScenarioBuilder catalogLoading={composeCatalogLoading} globalRevision={globalAccess.revision} onConfigureGlobal={globalAccess.open} key={editorVersion} suppliedCatalogs={composeCatalogs} value={draft} onChange={changeDraft} Markdown={Markdown} onStepFocus={step => setActiveStepId(step.id)} saving={saving} bindings={{}} project={project} scope={scope} bridge={bridge}
        metadata={onSidebarGroupPathChange && <SidebarMetadataFields groupPath={sidebarGroupPath ?? []} existingGroupPaths={sidebarGroupPaths} disabled={saving} onGroupPathChange={value => { onSidebarGroupPathChange(value); setDirty(true); setNotice(""); }} />}
        actions={onExecuteSaved && <button type="button" disabled={saving || !draft.steps.length} onClick={saveAndRun}>저장 후 실행</button>}
        onApply={async yaml => {
        const execute = runAfterSave.current;
        runAfterSave.current = false;
        setSaving(true); setNotice(""); setIssues([]); setProducerScenarios([]);
        try {
          const preview = await bridge.previewScenario(scope, yaml, {});
          const checks = [...preview.issues, ...(preview.executionIssues ?? [])];
          setIssues(checks);
          if (checks.some(issue => /전역변수 '[A-Za-z][A-Za-z0-9_]*'/.test(issue))) {
            void bridge.listScenarios(scope.projectId).then(setProducerScenarios).catch(() => setProducerScenarios([]));
          }
          if (execute && checks.length) { setNotice("아래 항목을 먼저 해결해야 실행할 수 있어 저장하지 않았습니다."); return; }
          const item = await (preview.issues.length ? bridge.saveScenarioDraft : bridge.saveScenario)(scope, yaml, {}, saved?.id === preview.scenario.id ? saved.updatedAt : undefined, sidebarMetadata);
          setSaved(item); await onSaved?.(item); setDirty(false);
          setNotice(preview.issues.length ? "초안으로 저장했습니다. 아래 항목을 보완하세요." : preview.executionIssues?.length ? "저장됨 · 실행 전 설정 필요. 아래 항목을 설정한 뒤 다시 검사하세요." : "시나리오를 저장했습니다. 이 화면에서 계속 수정할 수 있습니다.");
          if (execute) onExecuteSaved?.(item);
        } catch (error) { setIssues([(error as Error).message]); }
        finally { setSaving(false); }
      }} /></div>
      {notice && <p role="status">{notice}</p>}
      {issues.length > 0 && <ul role="alert" className="api-warning">{issues.map((issue, i) => {
        const variable = /전역변수 '([A-Za-z][A-Za-z0-9_]*)'/.exec(issue)?.[1];
        const producers = variable ? globalProducerScenarios(variable, producerScenarios, draft.id, scope.environmentId) : [];
        return <li key={i}>{issue}{variable && <GlobalVariableSetupLink onConfigure={globalAccess.open} name={variable} />}{producers.length > 0 && <span> 이 값을 추출하는 시나리오: {producers.join(", ")}. 먼저 실행한 뒤 다시 확인하세요.</span>}</li>;
      })}</ul>}
    </aside>}
    </div>
  </section>;
}
