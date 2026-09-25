import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import { resetStepConnections, scenarioStepLabel, type Json, type Scenario } from "../../../app/api-testing/shared/scenario";
import type { ApiCatalog, ApiScope, ApiTestingBridge, ApiSidebarMetadata } from "../../../app/api-testing/shared/workspace";
import { SelectedApiList } from "./SelectedApiList";
import { useRunAction, type OnRunAction } from "./useRunAction";
import { ScenarioBuilder } from "./ScenarioBuilder";
import type { ApiProject, SavedApiScenario } from "../../../app/api-testing/shared/workspace";
import { apiReference } from "./scenario-builder-model";
import { Icon } from "../../shared/ui/Icon";
import { GlobalVariableSetupLink } from "./global-variable-access";
import { ScenarioSettingsSummary } from "./ScenarioSettingsSummary";
import { globalProducerScenarios } from "./global-options";
import { SidebarMetadataFields } from "./SidebarMetadataFields";
import { type SwaggerSystem, type Selection } from "./swagger-types";
import { updateDeepLinkHash, applyDeepLink, handleSwaggerClick } from "./swagger-deep-link";
import { buildSpec } from "./swagger-request";
import { submitMethods, createSwaggerPlugin } from "./swagger-plugin";

const StableSwaggerUI = memo(SwaggerUI);

export function ApiDocumentation({ catalog, scope, bridge, baseUrl, busy, onBusy, onRunAction, project, initialEdit, onEditConsumed, mode = "document", onCloseComposer, onSaved, onStartScenario, onUnsavedChange, onExecuteSaved, sidebarGroupPath, sidebarGroupPaths = [], onSidebarGroupPathChange, onNewScenario, sidebarMetadata }: {
  catalog: ApiCatalog; scope: ApiScope; bridge: ApiTestingBridge; baseUrl: string; busy: boolean;
  onBusy: (value: boolean) => void; onRunAction: OnRunAction;
  project: ApiProject;
  initialEdit?: { saved: SavedApiScenario; scenario: Scenario };
  onEditConsumed?: () => void;
  mode?: "document" | "compose";
  onCloseComposer?: () => void;
  onSaved?: (item: SavedApiScenario) => void | Promise<void>;
  onExecuteSaved?: (item: SavedApiScenario) => void;
  onStartScenario?: () => void;
  onUnsavedChange?: (dirty: boolean) => void;
  sidebarGroupPath?: string[];
  sidebarGroupPaths?: string[][];
  onSidebarGroupPathChange?: (value: string[]) => void;
  onNewScenario?: () => void;
  sidebarMetadata?: ApiSidebarMetadata;
}) {
  const composeOnly = mode === "compose";
  const ownsRunAction = !composeOnly && !initialEdit;
  const [composing, setComposing] = useState(composeOnly || Boolean(initialEdit));
  const [composeServerId, setComposeServerId] = useState(scope.serverId);
  const [composeCatalogs, setComposeCatalogs] = useState<Record<string, ApiCatalog | null>>({ [scope.serverId]: catalog });
  const [composeCatalogLoading, setComposeCatalogLoading] = useState(false);
  useEffect(() => {
    setComposeServerId(current => project.servers.some(server => server.id === current) ? current : scope.serverId);
  }, [project.servers, scope.serverId]);
  useEffect(() => {
    setComposeCatalogs(current => ({ ...current, [scope.serverId]: catalog }));
  }, [catalog, scope.serverId]);
  useEffect(() => {
    if (!composing) return;
    let live = true;
    setComposeCatalogLoading(true);
    void Promise.all(project.servers.map(async server => {
      try { return [server.id, await bridge.getCatalog({ ...scope, serverId: server.id })] as const; }
      catch { return [server.id, null] as const; }
    })).then(entries => {
      if (live) setComposeCatalogs(current => ({ ...current, ...Object.fromEntries(entries) }));
    }).finally(() => { if (live) setComposeCatalogLoading(false); });
    return () => { live = false; };
  }, [bridge, composing, project.servers, scope.environmentId, scope.projectId]);
  useEffect(() => { if (initialEdit) onEditConsumed?.(); }, []);
  const [composeView, setComposeView] = useState<"select" | "edit">("select");
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [Markdown, setMarkdown] = useState<ComponentType<any> | undefined>();
  const restoring = useRef(false);
  const rawBodies = useRef(new Map<string, string>());
  const editRef = useRef<(pathMethod: string[], area: string, name: string, value: unknown) => void>(() => {});
  const composeToolbar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!composing) return;
    const frame = requestAnimationFrame(() => composeToolbar.current?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [composing]);
  const [draft, setDraft] = useState<Scenario>(() => initialEdit?.scenario ?? ({ version: 1, id: `scenario-${crypto.randomUUID()}`, name: "새 시나리오", onFailure: "stop", inputs: {}, vars: {}, valueBindings: [], steps: [] }));
  const [saved, setSaved] = useState<SavedApiScenario | null>(initialEdit?.saved ?? null);
  const [saving, setSaving] = useState(false);
  const runAfterSave = useRef(false);
  const editorFormHost = useRef<HTMLDivElement>(null);
  const ignoreRunAction = useRef<OnRunAction>(() => {});
  useRunAction(composeOnly ? onRunAction : ignoreRunAction.current, () => {
    const form = editorFormHost.current?.querySelector("form");
    if (!form || !form.reportValidity()) return;
    runAfterSave.current = true;
    form.requestSubmit();
    runAfterSave.current = false;
  }, saving || composeView !== "edit" || !draft.steps.length || !onExecuteSaved, "시나리오 실행");
  const [notice, setNotice] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [producerScenarios, setProducerScenarios] = useState<SavedApiScenario[]>([]);
  const [confirmClose, setConfirmClose] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const displayCatalog = composing
    ? composeCatalogs[composeServerId] ?? (composeServerId === scope.serverId ? catalog : null)
    : catalog;
  const displayBaseUrl = composing
    ? project.environments.find(environment => environment.id === scope.environmentId)?.baseUrls[composeServerId] ?? ""
    : baseUrl;
  const newScenario = () => {
    onNewScenario?.();
    const url = new URL(window.location.href);
    if (url.hash) { url.hash = ""; window.history.replaceState(window.history.state, "", url.href); }
    setActiveStepId(null); rawBodies.current.clear();
    setComposeView("select");
    setDraft({ version: 1, id: `scenario-${crypto.randomUUID()}`, name: "새 시나리오", onFailure: "stop", inputs: {}, vars: {}, valueBindings: [], steps: [] });
    setSaved(null); setDirty(false); setIssues([]); setNotice(""); setConfirmClose(false);
    setEditorVersion(version => version + 1);
  };
  const changeDraft = (next: Scenario) => {
    const changed = draft.steps.map(step => step.id).join("|") !== next.steps.map(step => step.id).join("|");
    if (changed && draft.valueBindings.length) {
      if (!window.confirm("단계 구성이 변경되어 이전 단계의 값을 사용하는 연결이 초기화됩니다. 직접 입력·전역변수·사용자 입력 설정은 유지됩니다. 계속할까요?")) return;
      next = resetStepConnections(next);
    }
    setDraft(next); setDirty(true); setNotice(changed && draft.valueBindings.length ? "단계 간 연결을 초기화했습니다. 순서 확정 후 값을 다시 연결하세요." : ""); setIssues([]);
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
  editRef.current = (pathMethod, area, name, value) => {
    if (restoring.current || !composing || !activeStepId || !pathMethod) return;
    const current = draft.steps.find(s => s.id === activeStepId);
    if (!current) return;
    const op = displayCatalog?.operations.find(o => "operationId" in current.api ? o.operationId === current.api.operationId : o.path === current.api.path && o.method.toUpperCase() === current.api.method);
    if (!op || op.path !== pathMethod[0] || op.method.toLowerCase() !== pathMethod[1]?.toLowerCase()) return;
    const request = { ...current.request };
    if (area === "body") {
      if (typeof value !== "string") return;
      rawBodies.current.set(current.id, value);
      try {
        const trimmed = value.trim();
        request.body = trimmed ? /^\{\{(?:inputs|vars|globals)\.[A-Za-z][A-Za-z0-9_]*\}\}$/.test(trimmed) ? trimmed : JSON.parse(trimmed) : undefined;
      }
      catch { setDirty(true); setNotice("본문 JSON 문법을 확인하세요. 입력 내용은 이 단계에 유지됩니다."); return; }
    } else {
      const key = area === "path" ? "pathParams" : area === "query" ? "query" : area === "header" ? "headers" : area === "cookie" ? "cookies" : null;
      if (!key || !name) return;
      const values: Record<string, Json> = { ...request[key] };
      const plain = value && typeof (value as any).toJS === "function" ? (value as any).toJS() : value;
      if (plain === undefined) delete values[name]; else values[name] = plain as Json & string;
      if (key === "headers") request.headers = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]));
      else if (key === "cookies") request.cookies = values;
      else request[key] = values;
    }
    setDraft(previous => ({ ...previous, steps: previous.steps.map(s => s.id === current.id ? { ...s, request } : s) }));
    setDirty(true);
  };
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
      setNotice("왼쪽 Swagger를 이 단계의 서버로 전환했습니다.");
      return;
    }
    const system = systemRef.current;
    const operation = displayCatalog?.operations.find(op => "operationId" in step.api ? op.operationId === step.api.operationId : op.path === step.api.path && op.method.toUpperCase() === step.api.method);
    if (!system || !operation) { setNotice("현재 Swagger 명세에서 이 API를 찾을 수 없습니다."); return; }
    setActiveStepId(step.id);
    const restoreRequest = () => {
      restoring.current = true;
      try {
        for (const param of operation.parameters) {
          const area = param.location === "path" ? "pathParams" : param.location === "query" ? "query" : param.location === "header" ? "headers" : param.location === "cookie" ? "cookies" : null;
          if (area) system.specActions.changeParam([operation.path, operation.method.toLowerCase()], param.name, param.location, step.request[area]?.[param.name]);
        }
        system.oas3Actions?.setRequestBodyValue({ pathMethod: [operation.path, operation.method.toLowerCase()], value: rawBodies.current.get(step.id) ?? (step.request.body === undefined ? "" : JSON.stringify(step.request.body, null, 2)) });
      } finally { restoring.current = false; }
    };
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
      // Swagger mounts the request editor only after the operation opens. Restoring
      // before that mount gets replaced by the example value on first selection.
      requestAnimationFrame(restoreRequest);
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
  catalogRef.current = displayCatalog ?? catalog;
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
  const plugin = useMemo(() => createSwaggerPlugin({ catalogRef, baseUrlRef, bridgeRef, scopeRef, systemRef, selectedRef, busyRef, publishSelection, setBusy: onBusy, composingRef, editRef }), []);
  const plugins = useMemo(() => [plugin], [plugin]);
  const onComplete = useMemo(() => (value: unknown) => {
    systemRef.current = value as SwaggerSystem;
    setMarkdown(() => (value as SwaggerSystem).getComponent("Markdown"));
    applyDeepLink(systemRef.current, window.location.hash);
  }, []);
  const spec = useMemo(() => buildSpec(displayCatalog ?? catalog, displayBaseUrl), [catalog, displayBaseUrl, displayCatalog]);

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
      icon.innerHTML = `
        <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1Z" />
        <path d="M8 13h8v-2H8v2Z" />
        <path d="M17 7h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5Z" />
        <path d="M17 1h-2v3h-3v2h3v3h2V6h3V4h-3V1Z" />
      `;
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
  }, [composeServerId, displayCatalog?.importedAt, composing, saving]);

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
      }}>{composing ? "← 시나리오 목록" : "시나리오 편집"}</button> : onStartScenario ? <button type="button" onClick={onStartScenario}>새 시나리오</button> : null}
      {composing && saved && <button type="button" disabled={saving || dirty} onClick={newScenario}>새 시나리오</button>}
      {composing && <span role="status">{draft.steps.length}개 단계 · {dirty ? "저장 전" : saved ? "저장됨" : "API를 선택하세요"}</span>}
      {composing && composeView === "select" && <span className="api-compose-legend"><Icon name="add_link" size={16} />추가 · <Icon name="expand_more" size={16} />상세 열기</span>}
      {composing && activeStepId && <span role="status">현재 확인: {draft.steps.findIndex(s => s.id === activeStepId) + 1}단계 · 값 설정은 오른쪽 시나리오 편집기에서 진행합니다.</span>}
      {composing && <nav className="api-compose-steps" aria-label="시나리오 작성 단계">
        <button type="button" aria-current={composeView === "select" ? "step" : undefined} disabled={saving} onClick={() => setComposeView("select")} title="API 추가·삭제 및 순서 설정"><span>1</span> API 선택·순서</button>
        <span aria-hidden="true">→</span>
        <button type="button" aria-current={composeView === "edit" ? "step" : undefined} disabled={saving || !draft.steps.length} onClick={() => setComposeView("edit")}><span>2</span> 값 설정·저장</button>
      </nav>}
    </div>
    {confirmClose && <div role="alert" className="api-warning">저장하지 않은 변경사항이 있습니다. 계속 작성해서 저장하거나 변경사항을 버리고 닫으세요.
      <button type="button" onClick={() => setConfirmClose(false)}>계속 작성</button>
      <button type="button" onClick={() => { newScenario(); setComposing(false); onCloseComposer?.(); }}>변경사항 버리고 닫기</button>
    </div>}
    <p className={`api-spec-meta${composing ? " api-compose-meta" : ""}`}>실시간 응답은 원문으로 표시됩니다. 토큰·개인정보가 포함될 수 있으니 복사·화면 공유에 주의하세요. 응답은 자동 저장하지 않습니다.</p>
    <div className={composing ? `api-compose-layout${composeView === "select" ? " api-selection-layout" : " api-edit-layout"}` : undefined}>
    <div className="api-swagger-renderer" hidden={composing && composeView === "edit"} data-scroll="light">
      {composing && project.servers.length > 1 && <div className="api-compose-server-switch">
        <label>Swagger 서버<select aria-label="Swagger 서버" value={composeServerId} disabled={saving || composeCatalogLoading} onChange={event => {
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
        key={`${composeServerId}:${displayCatalog.importedAt}`}
        spec={spec}
        plugins={plugins}
        onComplete={onComplete}
        docExpansion="list"
        deepLinking
        filter
        displayRequestDuration
        validatorUrl={null}
        defaultModelsExpandDepth={-1}
        defaultModelExpandDepth={1}
        supportedSubmitMethods={submitMethods}
        showExtensions={false}
        showCommonExtensions={false}
      /> : <div className="api-empty api-compose-server-empty"><h2>Swagger를 가져오세요</h2><p>선택한 서버·환경에 API 명세가 없습니다.</p></div>}
    </div>
    {composing && composeView === "select" && <aside className="api-selection-basket" aria-label="선택한 API" data-scroll="light">
      <h2>선택한 API · {draft.steps.length}개</h2>
      {!draft.steps.length && <p>Swagger 행의 체인 아이콘으로 엔드포인트를 추가하세요. 행 본문은 상세 열기입니다.</p>}
      <SelectedApiList scenario={draft} disabled={saving} onChange={changeDraft} onLocate={locateStep} getOperation={step => {
        const stepCatalog = step.server === composeServerId ? displayCatalog : composeCatalogs[step.server] ?? (step.server === scope.serverId ? catalog : null);
        return stepCatalog?.operations.find(operation => "operationId" in step.api ? operation.operationId === step.api.operationId : operation.path === step.api.path && operation.method.toUpperCase() === step.api.method);
      }} />
      {notice && <p role="status">{notice}</p>}
      <button type="button" className="api-primary" disabled={saving || !draft.steps.length} onClick={() => setComposeView("edit")}>선택 및 순서 설정 완료</button>
    </aside>}
    {composing && composeView === "edit" && <ScenarioSettingsSummary scenario={draft} catalogs={composeCatalogs} projectId={scope.projectId} bridge={bridge} onSelect={setActiveStepId} />}
    {composing && <aside hidden={composeView !== "edit"} className="api-compose-editor" aria-label="Swagger 시나리오 작성" data-scroll="light" onChangeCapture={() => { setDirty(true); setNotice(""); }}>
      <header><h2>시나리오 작성</h2><span>2단계 · 값 설정·저장</span></header>
      {onSidebarGroupPathChange && <SidebarMetadataFields groupPath={sidebarGroupPath ?? []} existingGroupPaths={sidebarGroupPaths} disabled={saving} onGroupPathChange={value => { onSidebarGroupPathChange(value); setDirty(true); setNotice(""); }} />}
      <nav className="api-step-jump" aria-label="API 단계 이동">{draft.steps.map((step, index) => {
        const stepCatalog = composeCatalogs[step.server] ?? (step.server === scope.serverId ? catalog : null);
        const operation = stepCatalog?.operations.find(item => "operationId" in step.api ? item.operationId === step.api.operationId : item.path === step.api.path && item.method.toUpperCase() === step.api.method);
        const method = operation?.method ?? ("method" in step.api ? step.api.method : "API");
        const path = operation?.path ?? ("path" in step.api ? step.api.path : step.api.operationId);
        return <button type="button" key={step.id} aria-current={activeStepId === step.id ? "step" : undefined} title={`${index + 1}. ${method} ${path}`} onClick={() => {
          setActiveStepId(step.id);
          const element = document.getElementById(`scenario-editor-step-${step.id}`);
          if (element instanceof HTMLDetailsElement) {
            element.open = true;
            element.scrollIntoView({ block: "start", behavior: "smooth" });
            element.querySelector("summary")?.focus({ preventScroll: true });
          }
        }}><span>{index + 1}</span><span className="api-method" data-method={method}>{method}</span><code>{path}</code></button>;
      })}</nav>
      <div ref={editorFormHost}><ScenarioBuilder key={editorVersion} suppliedCatalogs={composeCatalogs} source="" value={draft} onChange={changeDraft} Markdown={Markdown} onStepFocus={step => setActiveStepId(step.id)} embedded saving={saving} bindings={{}} project={project} scope={scope} bridge={bridge} onCancel={() => {}} onApply={async yaml => {
        const execute = runAfterSave.current;
        runAfterSave.current = false;
        setSaving(true); setNotice(""); setIssues([]); setProducerScenarios([]);
        try {
          for (const step of draft.steps) {
            const raw = rawBodies.current.get(step.id);
            if (raw?.trim() && !/^\{\{(?:inputs|vars|globals)\.[A-Za-z][A-Za-z0-9_]*\}\}$/.test(raw.trim())) { try { JSON.parse(raw); } catch { throw new Error(`${scenarioStepLabel(step)}: Swagger에서 입력한 본문 JSON 문법을 확인하세요.`); } }
          }
          const preview = await bridge.previewScenario(scope, yaml, {});
          const checks = [...preview.issues, ...(preview.executionIssues ?? [])];
          setIssues(checks);
          if (checks.some(issue => /전역변수 '[A-Za-z][A-Za-z0-9_]*'/.test(issue))) {
            void bridge.listScenarios(scope.projectId).then(setProducerScenarios).catch(() => setProducerScenarios([]));
          }
          if (execute && checks.length) return;
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
        return <li key={i}>{issue}{variable && <GlobalVariableSetupLink name={variable} />}{producers.length > 0 && <span> 이 값을 추출하는 시나리오: {producers.join(", ")}. 먼저 실행한 뒤 다시 확인하세요.</span>}</li>;
      })}</ul>}
    </aside>}
    </div>
  </section>;
}
