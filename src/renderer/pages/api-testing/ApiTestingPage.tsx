import { useEffect, useState } from "react";
import type { ApiCatalog, ApiProject, ApiSpecSync, ApiTestingBridge, SavedApiScenario, ApiScenarioPreview } from "../../../app/api-testing/shared/workspace";
import { ProjectForm } from "./ProjectForm";
import { DeleteAction } from "./DeleteAction";
import { ApiDocumentation } from "./ApiDocumentation";
import { Popover } from "../../shared/ui/Popover";
import { LoadingSpinner } from "../../shared/ui/LoadingSpinner";
import { GlobalVariablesPanel } from "./GlobalVariablesPanel";
import { ScenarioPanel } from "./ScenarioPanel";
import { AiContextPanel } from "./AiContextPanel";
import "./api-testing.css";
import type { OnRunAction } from "./useRunAction";
import { readWorkspaceUrl, workspaceUrl, type ApiTab } from "./workspace-url";

export function ApiTestingPage({ onRunAction, bridge = window.electronAPI?.apiTesting }: { onRunAction: OnRunAction; bridge?: ApiTestingBridge }) {
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [serverId, setServerId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [form, setForm] = useState<"new" | "edit" | null>(null);
  const [catalog, setCatalog] = useState<ApiCatalog | null>(null);
  const [sync, setSync] = useState<ApiSpecSync | null>(null);
  const [remember, setRemember] = useState(false);
  const [url, setUrl] = useState("");
  const [authKind, setAuthKind] = useState("none");
  const [docsUsername, setDocsUsername] = useState("");
  const [docsPassword, setDocsPassword] = useState("");
  useEffect(() => { setAuthKind("none"); setDocsUsername(""); setDocsPassword(""); }, [projectId, serverId, environmentId]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<ApiTab>(() => readWorkspaceUrl(window.location.href).tab);
  const [swaggerEdit, setSwaggerEdit] = useState<{ saved: SavedApiScenario; scenario: ApiScenarioPreview["scenario"] } | null>(null);
  const changeTab = (next: ApiTab) => {
    if (busy || next === tab) return;
    setSwaggerEdit(null);
    history.pushState(history.state, "", workspaceUrl(window.location.href, { tab: next, projectId, serverId, environmentId }));
    setTab(next);
  };
  useEffect(() => {
    if (!projectId) return;
    history.replaceState(history.state, "", workspaceUrl(window.location.href, { tab, projectId, serverId, environmentId }));
  }, [tab, projectId, serverId, environmentId]);
  useEffect(() => {
    const restore = () => {
      if (busy) {
        history.replaceState(history.state, "", workspaceUrl(window.location.href, { tab, projectId, serverId, environmentId }));
        setError("작성 또는 실행 중에는 탭을 이동할 수 없습니다. 먼저 저장하거나 작업을 닫으세요.");
        return;
      }
      const target = readWorkspaceUrl(window.location.href);
      const selected = projects.find(p => p.id === target.projectId) ?? projects[0];
      setTab(target.tab);
      if (selected) {
        setProjectId(selected.id);
        setServerId(selected.servers.find(s => s.id === target.serverId)?.id ?? selected.servers[0].id);
        setEnvironmentId(selected.environments.find(e => e.id === target.environmentId)?.id ?? selected.environments[0].id);
      }
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [busy, projects, tab, projectId, serverId, environmentId]);
  const project = projects.find(p => p.id === projectId);
  const scope = { projectId, serverId, environmentId };
  const selectProject = (p: ApiProject) => { setProjectId(p.id); setServerId(p.servers[0].id); setEnvironmentId(p.environments[0].id); setUrl(""); };
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
  const importSpec = async (kind: "file" | "url") => {
    setLoading(true); setError("");
    try {
      const useSavedAuth = authKind === "basic" && remember && sync?.hasSavedAccount && sync.url === url && sync.username === docsUsername && !docsPassword;
      const next = await bridge.importSpec(scope, kind === "file" ? { kind } : { kind, url, ...(authKind === "basic" ? useSavedAuth ? { useSavedAuth: true } : { remember, auth: { kind: "basic" as const, username: docsUsername, password: docsPassword } } : {}) });
      if (next) { setCatalog(next); }
    } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); }
    finally { try { setSync(await bridge.getSpecSync(scope)); } catch { /* Keep the original import error visible. */ } setLoading(false); setDocsPassword(""); }
  };
  if (!bridge) return <section className="api-testing-page api-swagger-shell"><h1>API 테스트</h1><p>프로젝트 저장과 실제 API 호출은 Checkly 데스크톱 앱에서 사용할 수 있습니다.</p></section>;
  return <section className="api-testing-page api-swagger-shell">
    <header className="api-toolbar"><h1>API 테스트</h1><div className="api-actions"><select aria-label="API 프로젝트" disabled={busy || loading} value={projectId} onChange={e => selectProject(projects.find(p => p.id === e.target.value)!)}><option value="" disabled>프로젝트 선택</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button disabled={busy || loading} onClick={() => setForm("new")}>+ 프로젝트</button>{project && <button disabled={busy || loading} onClick={() => setForm("edit")}>설정</button>}</div></header>
    {form ? <ProjectForm key={`${form}:${projectId}`} initial={form === "edit" ? project : undefined} onCancel={() => setForm(null)} onDelete={async () => {
      setBusy(true);
      try {
      await bridge.deleteProject(projectId);
      const remaining = await bridge.listProjects(); setProjects(remaining); setForm(null); onRunAction(null);
      if (remaining[0]) selectProject(remaining[0]);
      else { setProjectId(""); setServerId(""); setEnvironmentId(""); setCatalog(null); setSync(null); setLoading(false); }
      } finally { setBusy(false); }
    }} onSave={async p => { const saved = await bridge.saveProject(p); setProjects(await bridge.listProjects()); selectProject(saved); setForm(null); }} /> : <>
      {!project ? <div className="api-empty"><h2>API 테스트를 시작하세요</h2><p>프로젝트를 만든 뒤 Swagger 파일이나 URL을 가져오세요.</p><button className="api-primary" onClick={() => setForm("new")}>프로젝트 만들기</button></div> : <>
        <div className="api-context"><select aria-label="API 서버" value={serverId} disabled={busy || loading} onChange={e => { setServerId(e.target.value); setUrl(""); }}>{project.servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><div className="api-environments" role="group" aria-label="API 환경">{project.environments.map(e => <button key={e.id} aria-pressed={environmentId === e.id} disabled={busy || loading} onClick={() => { setEnvironmentId(e.id); setUrl(""); }}>{e.name}</button>)}</div><code>{project.environments.find(e => e.id === environmentId)?.baseUrls[serverId]}</code><Popover key={`${projectId}:${environmentId}`} label="{ } 전역 변수" disabled={busy}><GlobalVariablesPanel scope={scope} bridge={bridge} /></Popover></div>
        <div className="api-tabs" role="tablist" aria-label="API 작업 영역">
          <button role="tab" aria-selected={tab === "scenarios"} disabled={busy} onClick={() => changeTab("scenarios")}>시나리오</button>
          <button role="tab" aria-selected={tab === "api"} disabled={busy} onClick={() => changeTab("api")}>API 문서 {catalog?.operations.length ?? 0}</button>
          <button role="tab" aria-selected={tab === "ai"} disabled={busy} onClick={() => changeTab("ai")}>AI 작성 도우미</button>
        </div>
        {tab === "ai" && <AiContextPanel key={`${projectId}:${environmentId}`} project={project} scope={{ projectId, environmentId }} bridge={bridge} />}
        {tab === "scenarios" && <ScenarioPanel key={`${projectId}:${environmentId}:${serverId}`} project={project} scope={scope} bridge={bridge} onBusy={setBusy} onRunAction={onRunAction} onEditSwagger={async (saved, preview) => {
          const steps = preview.scenario.steps.map(step => ({ ...step, server: saved.bindings[step.server] ?? step.server }));
          const targetServer = steps[0]?.server ?? serverId;
          if (!project.servers.some(server => server.id === targetServer)) throw new Error("먼저 시나리오의 서버 연결을 설정하세요.");
          if (!await bridge.getCatalog({ ...scope, serverId: targetServer })) throw new Error("해당 서버·환경의 Swagger 명세를 먼저 가져오세요.");
          setSwaggerEdit({ saved, scenario: { ...preview.scenario, steps } });
          setServerId(targetServer); setTab("api");
          history.pushState(history.state, "", workspaceUrl(window.location.href, { tab: "api", projectId, serverId: targetServer, environmentId }));
        }} />}
        {tab === "api" && <>
        <div className="api-spec-tools">
        {catalog && <DeleteAction key={`${projectId}:${serverId}:${environmentId}:${catalog.importedAt}`} label="명세 삭제" disabled={busy || loading} description={`현재 서버·환경의 API ${catalog.operations.length}개와 명세 주소·저장 계정·인증 연결을 삭제합니다. 시나리오는 유지되지만 이 명세를 사용하는 단계는 명세를 다시 가져오기 전까지 실행할 수 없습니다.`} onDelete={async () => {
          setLoading(true);
          try { await bridge.deleteCatalog(scope); setCatalog(null); setSync(null); setUrl(""); setRemember(false); setDocsUsername(""); setDocsPassword(""); setAuthKind("none"); onRunAction(null); }
          finally { setLoading(false); }
        }} />}
        <div className="api-import"><input aria-label="OpenAPI URL" type="url" placeholder="OpenAPI JSON/YAML URL" value={url} disabled={busy || loading} onChange={e => { setUrl(e.target.value); setDocsPassword(""); setDocsUsername(""); setRemember(false); setAuthKind("none"); }} /><button disabled={busy || loading || !url.trim()} onClick={() => void importSpec("url")}>URL 가져오기</button><button disabled={busy || loading} onClick={() => void importSpec("file")}>파일 가져오기</button><button disabled={busy || loading || !sync?.url || url !== sync.url} onClick={() => void importSpec("url")}>명세 새로고침</button></div>
        </div>
        <div className="api-context"><label>문서 인증<select aria-label="Swagger 인증 방식" value={authKind} disabled={busy || loading} onChange={e => { setAuthKind(e.target.value); setDocsPassword(""); }}><option value="none">인증 없음</option><option value="basic">Basic 인증</option></select></label>{authKind === "basic" && <><label>문서 아이디<input aria-label="Swagger 아이디" autoComplete="off" value={docsUsername} disabled={busy || loading} onChange={e => setDocsUsername(e.target.value)} /></label><label>문서 비밀번호<input aria-label="Swagger 비밀번호" type="password" autoComplete="off" value={docsPassword} disabled={busy || loading} onChange={e => setDocsPassword(e.target.value)} /></label><label className="api-remember"><input type="checkbox" aria-label="이 기기에 계정 기억" disabled={busy || loading || !sync?.secureStorageAvailable} checked={remember} onChange={e => setRemember(e.target.checked)} />이 기기에 계정 기억</label><small>{sync?.secureStorageAvailable ? "기억을 선택하면 비밀번호를 OS 보안 기능으로 암호화해 저장합니다." : "OS 보안 저장소를 사용할 수 없어 계정 저장이 비활성화되었습니다."} HTTPS 사용을 권장합니다.</small></>}</div>
        {sync?.hasSavedAccount && <div className="api-actions"><small>{sync.url === url && sync.username === docsUsername && remember ? "비밀번호를 비워두면 저장된 계정을 사용합니다." : "저장된 계정은 기존 명세 주소에만 연결되어 있습니다."}</small><button disabled={busy || loading} onClick={async () => { setLoading(true); try { await bridge.deleteSpecAccount(scope); setSync(await bridge.getSpecSync(scope)); setRemember(false); setDocsPassword(""); setDocsUsername(""); } catch { setError("저장된 계정을 삭제하지 못했습니다."); } finally { setLoading(false); } }}>저장된 계정 삭제</button></div>}
        {sync?.lastAttemptAt && <p role="status">최근 동기화 {sync.status === "success" ? "성공" : "실패 · 기존 문서 유지"} · {new Date(sync.lastAttemptAt).toLocaleString()}</p>}
        {loading && <LoadingSpinner label="명세를 불러오는 중…" />}
        {catalog ? <ApiDocumentation initialEdit={swaggerEdit ?? undefined} onEditConsumed={() => setSwaggerEdit(null)} project={project} key={`${projectId}:${serverId}:${environmentId}:${catalog.importedAt}`} catalog={catalog} scope={scope} bridge={bridge} baseUrl={project.environments.find(e => e.id === environmentId)?.baseUrls[serverId] ?? ""} busy={busy} onBusy={setBusy} onRunAction={onRunAction} /> : !loading && <div className="api-empty"><h2>Swagger를 가져오세요</h2><p>선택한 서버·환경에 OpenAPI 3.0 / 3.1 명세를 등록합니다.</p></div>}
        </>}
      </>}
    </>}
    {error && <p className="api-warning" role="alert">{error}</p>}
  </section>;
}
