import { useEffect, useRef, useState } from "react";
import type { ApiCatalog, ApiSpecImpact, ApiProject, ApiProjectImportPlan, ApiProjectImportResult, ApiSpecSync, ApiTestingBridge, SavedApiScenario } from "../../../app/api-testing/shared/workspace";
import { ProjectForm, ProjectImportDialog } from "../../features/api-testing/configure-project";
import { ApiDocumentation } from "./ui/ApiDocumentation";
import { LoadingSpinner } from "../../shared/ui/LoadingSpinner";
import { GlobalVariableMenu } from "../../features/api-testing/configure-globals";
import { ApiTestingProviders } from "./ui/ApiTestingProviders";
import { ScenarioPanel } from "./ui/ScenarioPanel";
import { ScenarioEditorPanel } from "./ui/ScenarioEditorPanel";
import { AiAuthorPanel } from "../../features/api-testing/author-scenarios";
import { SpecSourcePanel } from "../../features/api-testing/configure-spec";
import "./ui/api-testing.css";
import type { OnRunAction } from "../../shared/model/run-action";
import { readWorkspaceUrl, workspaceUrl, type ApiTab } from "./lib/workspace-url";

export function ApiTestingPage({ onRunAction, bridge = window.electronAPI?.apiTesting }: { onRunAction: OnRunAction; bridge?: ApiTestingBridge }) {
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [hideValues, setHideValues] = useState(true);
  const [runSaved, setRunSaved] = useState<SavedApiScenario | null>(null);
  // Opened (not run) when the scenarios tab mounts, e.g. the first scenario the AI helper saved.
  const [openSaved, setOpenSaved] = useState<SavedApiScenario | null>(null);
  const executeSaved = (item: SavedApiScenario) => {
    setRunSaved(item);
    setScenarioDirty(false);
    setScenarioComposerOpen(false);
    setBusy(false);
    setError("");
    setTab("scenarios");
  };
  const [projectId, setProjectId] = useState("");
  const [serverId, setServerId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [form, setForm] = useState<"new" | "edit" | null>(null);
  const [catalog, setCatalog] = useState<ApiCatalog | null>(null);
  const [sync, setSync] = useState<ApiSpecSync | null>(null);
  // Saved scenarios whose steps no longer find their API in the current environment's specs.
  const [specImpact, setSpecImpact] = useState<ApiSpecImpact>({ missing: [], renamed: [] });
  const [remember, setRemember] = useState(false);
  const [url, setUrl] = useState("");
  const [authKind, setAuthKind] = useState("none");
  const [docsUsername, setDocsUsername] = useState("");
  const [docsPassword, setDocsPassword] = useState("");
  useEffect(() => { setAuthKind("none"); setDocsUsername(""); setDocsPassword(""); }, [projectId, serverId, environmentId]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importPlan, setImportPlan] = useState<{ text: string; plan: ApiProjectImportPlan } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scenarioComposerOpen, setScenarioComposerOpen] = useState(false);
  const [scenarioDirty, setScenarioDirty] = useState(false);
  const scenarioDirtyRef = useRef(false);
  const allowNextUnloadRef = useRef(false);
  const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false);
  scenarioDirtyRef.current = scenarioDirty;
  const [tab, setTab] = useState<ApiTab>(() => readWorkspaceUrl(window.location.href).tab);
  const [scenarioCreateRequest, setScenarioCreateRequest] = useState(0);
  const [scenarioEditorScenarioId, setScenarioEditorScenarioId] = useState(() => readWorkspaceUrl(window.location.href).scenarioId || null);
  useEffect(() => {
    // Keep one handler mounted for the lifetime of the page. Some embedded
    // browsers miss the short window between the editor becoming dirty and a
    // reload, and some only honor a non-empty returnValue.
    const prevent = (event: BeforeUnloadEvent) => {
      if (!scenarioDirtyRef.current || allowNextUnloadRef.current) return;
      event.preventDefault();
      event.returnValue = "저장하지 않은 시나리오 변경사항이 있습니다.";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  useEffect(() => {
    // Ctrl/Cmd+R and F5 can be cancelled before the embedded browser starts
    // navigation. The native beforeunload dialog remains the fallback for
    // toolbar reloads and closing the window.
    const preventRefresh = (event: KeyboardEvent) => {
      const refreshShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r";
      if (!scenarioDirtyRef.current || (!refreshShortcut && event.key !== "F5")) return;
      event.preventDefault();
      event.stopPropagation();
      setRefreshConfirmOpen(true);
    };
    window.addEventListener("keydown", preventRefresh, true);
    return () => window.removeEventListener("keydown", preventRefresh, true);
  }, []);
  const changeTab = (next: ApiTab, targetScenarioId = next === "scenario-editor" ? scenarioEditorScenarioId ?? "" : "", clearHash = false) => {
    if (next === tab) return;
    if (busy || scenarioComposerOpen) {
      setError(scenarioComposerOpen ? "시나리오 작성 중에는 탭을 이동할 수 없습니다. 먼저 저장하거나 작성 화면을 닫으세요." : "작성 또는 실행 중에는 탭을 이동할 수 없습니다. 먼저 저장하거나 작업을 닫으세요.");
      return;
    }
    history.pushState(history.state, "", workspaceUrl(window.location.href, { tab: next, projectId, serverId, environmentId, scenarioId: targetScenarioId }, clearHash));
    setTab(next);
  };
  const backToScenarios = () => { setScenarioDirty(false); setScenarioComposerOpen(false); setScenarioEditorScenarioId(null); setScenarioCreateRequest(0); setError(""); setTab("scenarios"); };
  const openScenarioEditor = (scenarioId?: string) => {
    const target = scenarioId ?? "";
    setScenarioEditorScenarioId(target || null);
    if (!target) setScenarioCreateRequest(request => request + 1);
    changeTab("scenario-editor", target, !target);
  };
  useEffect(() => {
    if (!projectId) return;
    history.replaceState(history.state, "", workspaceUrl(window.location.href, { tab, projectId, serverId, environmentId, scenarioId: tab === "scenario-editor" ? scenarioEditorScenarioId ?? "" : "" }));
  }, [tab, projectId, serverId, environmentId, scenarioEditorScenarioId]);
  useEffect(() => {
    const restore = () => {
      if (busy || scenarioComposerOpen) {
        history.replaceState(history.state, "", workspaceUrl(window.location.href, { tab, projectId, serverId, environmentId, scenarioId: tab === "scenario-editor" ? scenarioEditorScenarioId ?? "" : "" }));
        setError(scenarioComposerOpen ? "시나리오 작성 중에는 탭을 이동할 수 없습니다. 먼저 저장하거나 작성 화면을 닫으세요." : "작성 또는 실행 중에는 탭을 이동할 수 없습니다. 먼저 저장하거나 작업을 닫으세요.");
        return;
      }
      const target = readWorkspaceUrl(window.location.href);
      const selected = projects.find(p => p.id === target.projectId) ?? projects[0];
      setTab(target.tab);
      setScenarioEditorScenarioId(target.scenarioId || null);
      if (selected) {
        setProjectId(selected.id);
        setServerId(selected.servers.find(s => s.id === target.serverId)?.id ?? selected.servers[0].id);
        setEnvironmentId(selected.environments.find(e => e.id === target.environmentId)?.id ?? selected.environments[0].id);
      }
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [busy, scenarioComposerOpen, projects, tab, projectId, serverId, environmentId, scenarioEditorScenarioId]);
  const project = projects.find(p => p.id === projectId);
  const scope = { projectId, serverId, environmentId };
  // A share file of a project with a local copy asks whether to update it; otherwise it is added as new.
  const importProject = async () => {
    const text = await bridge.readProjectFile();
    if (text === null) return;
    const plan = await bridge.planProjectImport(text);
    if (plan.targets.length) { setImportPlan({ text, plan }); return; }
    finishImport(await bridge.importProject(text));
  };
  const finishImport = async (result: ApiProjectImportResult) => {
    setImportPlan(null);
    setProjects(await bridge.listProjects()); selectProject(result.project); setForm(null);
    setNotice(result.merged
      ? `‘${result.project.name}’에 합쳤습니다 · 추가 ${result.merged.added} · 반영 ${result.merged.updated} · 내 변경 유지 ${result.merged.kept}.${result.specUrls ? " 새로 생긴 명세는 API 문서 탭에서 새로고침하세요." : ""}`
      : `‘${result.project.name}’ 프로젝트를 가져왔습니다 · 시나리오 ${result.scenarios}개, 스위트 ${result.suites}개. ${result.specUrls ? "API 문서 탭에서 명세를 새로고침하세요(문서 인증이 있으면 계정 입력)." : "API 문서 탭에서 명세를 다시 가져오세요."}`);
  };
  const selectProject = (p: ApiProject) => { setProjectId(p.id); setServerId(p.servers[0].id); setEnvironmentId(p.environments[0].id); setUrl(""); setScenarioEditorScenarioId(null); };
  useEffect(() => {
    let live = true;
    if (bridge) void bridge.listProjects().then(items => { if (live) {
      setProjects(items);
      const target = readWorkspaceUrl(window.location.href);
      const selected = items.find(p => p.id === target.projectId) ?? items[0];
      if (selected) {
        selectProject(selected);
        setServerId(selected.servers.find(s => s.id === target.serverId)?.id ?? selected.servers[0].id);
        setEnvironmentId(selected.environments.find(e => e.id === target.environmentId)?.id ?? selected.environments[0].id);
        setScenarioEditorScenarioId(target.scenarioId || null);
      }
    } }).catch(() => { if (live) setError("프로젝트 목록을 읽지 못했습니다."); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    setCatalog(null); setSync(null); setRemember(false); setError("");
    if (projectId && serverId && environmentId && bridge) {
      setLoading(true);
      void Promise.all([bridge.getCatalog(scope), bridge.getSpecSync(scope)]).then(([value, saved]) => { if (live) { setCatalog(value); setSync(saved); setUrl(saved.url ?? ""); setDocsUsername(saved.username ?? ""); setAuthKind(saved.username ? "basic" : "none"); setRemember(saved.hasSavedAccount); } }).catch(() => { if (live) setError("저장된 명세를 읽지 못했습니다."); }).finally(() => { if (live) setLoading(false); });
    }
    return () => { live = false; };
  }, [projectId, serverId, environmentId]);
  // Checked only on the API tab, after a spec (re)load, or on request — never blocks the sync itself.
  const [missingCheck, setMissingCheck] = useState(0);
  const [checkingMissing, setCheckingMissing] = useState(false);
  useEffect(() => {
    let live = true;
    if (tab !== "api" || !bridge || !projectId || !environmentId || !catalog) { setSpecImpact({ missing: [], renamed: [] }); return; }
    setCheckingMissing(true);
    void bridge.checkScenarioSpecs({ projectId, environmentId })
      .then(found => { if (live) setSpecImpact(found); })
      .catch(() => { if (live) setSpecImpact({ missing: [], renamed: [] }); })
      .finally(() => { if (live) setCheckingMissing(false); });
    return () => { live = false; };
  }, [tab, projectId, environmentId, catalog?.importedAt, missingCheck]);
  const importSpec = async (kind: "file" | "url", targetUrl = url): Promise<boolean> => {
    setLoading(true); setError("");
    try {
      if (targetUrl !== url) setUrl(targetUrl);
      const useSavedAuth = authKind === "basic" && remember && sync?.hasSavedAccount && sync.url === targetUrl && sync.username === docsUsername && !docsPassword;
      const next = await bridge.importSpec(scope, kind === "file" ? { kind } : { kind, url: targetUrl, ...(authKind === "basic" ? useSavedAuth ? { useSavedAuth: true } : { remember, auth: { kind: "basic" as const, username: docsUsername, password: docsPassword } } : {}) });
      if (next) { setCatalog(next); return true; }
      return false;
    } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); return false; }
    finally { try { setSync(await bridge.getSpecSync(scope)); } catch { /* Keep the original import error visible. */ } setLoading(false); setDocsPassword(""); }
  };
  if (!bridge) return <section className="api-testing-page api-swagger-shell"><h1>API 테스트</h1><p>프로젝트 저장과 실제 API 호출은 Checkly 데스크톱 앱에서 사용할 수 있습니다.</p></section>;
  const locked = busy || scenarioComposerOpen;
  const environmentPicker = project && <div className="api-environments" role="group" aria-label={tab === "scenario-editor" ? "시나리오 전체 호출 환경" : "API 환경"}>{project.environments.map(e => <button key={e.id} aria-pressed={environmentId === e.id} disabled={busy || loading} title={tab === "scenario-editor" ? "이 시나리오의 전체 API 호출 환경" : undefined} onClick={() => { setEnvironmentId(e.id); setUrl(""); }}>{e.name}</button>)}</div>;
  const valueActions = <div className="api-context-value-actions"><button type="button" role="switch" aria-checked={hideValues} aria-label="민감값 숨기기" className="api-value-visibility" title="토큰·비밀번호·인증 헤더 등 민감한 값만 화면에서 숨깁니다" onClick={() => setHideValues(value => !value)}><span className="api-value-switch-track" aria-hidden="true" /><span>민감값 숨기기</span></button><GlobalVariableMenu projectId={projectId} bridge={bridge} disabled={busy} /></div>;
  return <ApiTestingProviders key={projectId} projectId={projectId} bridge={bridge}><section className={`api-testing-page api-swagger-shell${hideValues ? " api-hide-values" : ""}`}>
    <header className="api-toolbar"><h1>API 테스트</h1><div className="api-actions"><select aria-label="API 프로젝트" disabled={locked || loading} value={projectId} onChange={e => selectProject(projects.find(p => p.id === e.target.value)!)}><option value="" disabled>프로젝트 선택</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button disabled={locked || loading} onClick={() => setForm("new")}>+ 프로젝트</button><button disabled={locked || loading} title="공유받은 프로젝트 파일(.checkly-api.json)을 새 프로젝트로 추가합니다" onClick={() => { setError(""); void importProject().catch(e => setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ""))); }}>가져오기</button>{project && <button disabled={locked || loading} onClick={() => setForm("edit")}>프로젝트 설정</button>}</div></header>
    {error && <p className="api-warning" role="alert">{error}</p>}
    {importPlan && <ProjectImportDialog plan={importPlan.plan} onCancel={() => setImportPlan(null)} onImport={async update => { await finishImport(await bridge.importProject(importPlan.text, update)); }} />}
    {notice && !form && <p className="api-page-notice" role="status">{notice}<button type="button" className="api-compose-link" onClick={() => setNotice("")}>닫기</button></p>}
    {form ? <ProjectForm key={`${form}:${projectId}`} initial={form === "edit" ? project : undefined} onCancel={() => setForm(null)} onDelete={async () => {
      setBusy(true);
      try {
      await bridge.deleteProject(projectId);
      const remaining = await bridge.listProjects(); setProjects(remaining); setForm(null); onRunAction(null);
      if (remaining[0]) selectProject(remaining[0]);
      else { setProjectId(""); setServerId(""); setEnvironmentId(""); setCatalog(null); setSync(null); setLoading(false); }
      } finally { setBusy(false); }
    }} onSave={async p => { const saved = await bridge.saveProject(p); setProjects(await bridge.listProjects()); selectProject(saved); setForm(null); }}
    onExport={async () => { const saved = await bridge.exportProject(projectId); return saved ? `저장했습니다 · ${saved}` : ""; }}
    onImport={importProject} /> : <>
      {!project ? <div className="api-empty"><h2>API 테스트를 시작하세요</h2><p>프로젝트를 만든 뒤 API 명세(OpenAPI) 파일이나 URL을 가져오세요.</p><button className="api-primary" onClick={() => setForm("new")}>프로젝트 만들기</button></div> : <>
        <div className="api-context"><select aria-label="API 서버" value={serverId} disabled={locked || loading} onChange={e => { setServerId(e.target.value); setUrl(""); }}>{project.servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{environmentPicker}<code>{project.environments.find(e => e.id === environmentId)?.baseUrls[serverId]}</code>{valueActions}</div>
        <div className="api-tabs" role="tablist" aria-label="API 작업 영역">
          <button role="tab" aria-selected={tab === "scenarios" || tab === "scenario-editor"} disabled={busy} onClick={() => {
            if (tab !== "scenario-editor") { changeTab("scenarios"); return; }
            if (scenarioDirty) setError("저장하지 않은 변경사항이 있습니다. 저장하거나 ← 목록에서 변경사항을 버리고 닫으세요.");
            else backToScenarios();
          }}>시나리오</button>
          <button role="tab" aria-selected={tab === "api"} disabled={locked} onClick={() => changeTab("api")}>API 문서{catalog ? <small className="api-tab-count" title={`API ${catalog.operations.length}개`}>{catalog.operations.length}</small> : null}</button>
          <button role="tab" aria-selected={tab === "ai"} disabled={locked} onClick={() => changeTab("ai")}>AI 작성 도우미</button>
        </div>
        {tab === "ai" && <AiAuthorPanel key={`${projectId}:${environmentId}`} project={project} scope={{ projectId, environmentId }} bridge={bridge} onBusy={setBusy} onSaved={first => { setBusy(false); setOpenSaved(first ?? null); setTab("scenarios"); }} />}
        {tab === "scenarios" && <ScenarioPanel key={`${projectId}:${environmentId}:${serverId}`} project={project} scope={scope} bridge={bridge} onBusy={setBusy} onRunAction={onRunAction} runSaved={runSaved} onRunSavedConsumed={() => setRunSaved(null)} openSaved={openSaved} onOpenSavedConsumed={() => setOpenSaved(null)} onCreateScenario={() => openScenarioEditor()} onEditScenario={item => openScenarioEditor(item.id)} />}
        {tab === "scenario-editor" && <ScenarioEditorPanel key={`${projectId}:${serverId}`} project={project} scope={scope} bridge={bridge} onBusy={setBusy} onRunAction={onRunAction} onBackToScenarios={backToScenarios} onExecuteSaved={executeSaved} startCreateRequest={scenarioCreateRequest} editScenarioId={scenarioEditorScenarioId} onCreateConsumed={() => setScenarioCreateRequest(0)} onComposerOpenChange={setScenarioComposerOpen} onUnsavedChange={setScenarioDirty} onCreateScenario={() => openScenarioEditor()} onEditScenario={item => openScenarioEditor(item.id)} composeContext={<div className="api-compose-context">{environmentPicker}{valueActions}</div>} />}
        {tab === "api" && <>
        {(catalog || sync || !loading) && <SpecSourcePanel key={`${projectId}:${serverId}:${environmentId}:${catalog ? "loaded" : "empty"}`}
          scopeLabel={`${project.servers.find(s => s.id === serverId)?.name ?? ""} · ${project.environments.find(e => e.id === environmentId)?.name ?? ""}`}
          catalog={catalog} sync={sync} disabled={busy || loading} missingApis={specImpact.missing} renamedTitles={specImpact.renamed} checkingMissing={checkingMissing} onRecheckMissing={() => setMissingCheck(count => count + 1)} onOpenScenario={openScenarioEditor}
          onApplyRenames={async () => {
            const { updated, skipped } = await bridge.applyTitleRenames({ projectId, environmentId });
            setMissingCheck(count => count + 1);
            return skipped.length ? `시나리오 ${updated.length}개의 단계 이름을 바꿨습니다. ${skipped.join(", ")}은(는) 그사이 다른 곳에서 수정되어 건너뛰었습니다. 다시 시도하세요.` : `시나리오 ${updated.length}개의 단계 이름을 새 제목으로 바꿨습니다.`;
          }}
          onKeepTitles={async scenarioId => { await bridge.keepTitles({ projectId, environmentId }, scenarioId); setMissingCheck(count => count + 1); }}
          url={url} onUrlChange={setUrl}
          authKind={authKind} onAuthKindChange={kind => { setAuthKind(kind); setDocsPassword(""); }}
          username={docsUsername} onUsernameChange={setDocsUsername}
          password={docsPassword} onPasswordChange={setDocsPassword}
          remember={remember} onRememberChange={setRemember}
          onImport={importSpec}
          onDeleteCatalog={async () => {
            setLoading(true);
            try { await bridge.deleteCatalog(scope); setCatalog(null); setSync(null); setUrl(""); setRemember(false); setDocsUsername(""); setDocsPassword(""); setAuthKind("none"); onRunAction(null); }
            finally { setLoading(false); }
          }}
          onDeleteSavedAccount={async () => { setLoading(true); try { await bridge.deleteSpecAccount(scope); setSync(await bridge.getSpecSync(scope)); setRemember(false); setDocsPassword(""); setDocsUsername(""); } catch { setError("저장된 계정을 삭제하지 못했습니다."); } finally { setLoading(false); } }} />}
        {loading && <LoadingSpinner label="명세를 불러오는 중…" />}
        {catalog ? <ApiDocumentation project={project} key={`${projectId}:${serverId}:${environmentId}:${catalog.importedAt}`} catalog={catalog} scope={scope} bridge={bridge} baseUrl={project.environments.find(e => e.id === environmentId)?.baseUrls[serverId] ?? ""} busy={busy} onBusy={setBusy} onRunAction={onRunAction} /> : !loading && <div className="api-empty"><h2>API 명세를 가져오세요</h2><p>선택한 서버·환경에 OpenAPI 3.0 / 3.1 명세를 등록합니다.</p></div>}
        </>}
      </>}
    </>}
    {refreshConfirmOpen && <div className="api-confirm-dialog-backdrop">
      <section className="api-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="api-confirm-dialog-title">
        <h2 id="api-confirm-dialog-title">저장하지 않은 변경사항</h2>
        <p>현재 시나리오 수정 내용이 저장되지 않았습니다. 새로고침하면 수정 내용이 사라집니다.</p>
        <div className="api-actions">
          <button type="button" onClick={() => setRefreshConfirmOpen(false)}>새로고침 취소</button>
          <button type="button" className="api-danger-action" onClick={() => { allowNextUnloadRef.current = true; setRefreshConfirmOpen(false); window.location.reload(); }}>수정사항 버리고 새로고침</button>
        </div>
      </section>
    </div>}
  </section></ApiTestingProviders>;
}
