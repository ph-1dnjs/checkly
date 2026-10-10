import { useEffect, useRef, useState, type CSSProperties } from "react";
import { projectSchema, teamProjectSchema, type ApiAiChatSettings, type ApiProject, type ApiTestingBridge } from "../../../../../app/api-testing/shared/workspace";
import { Icon } from "../../../../shared/ui/Icon";
import { DeleteAction } from "../../../../entities/api-testing";
import { ProjectAiSettings } from "./ProjectAiSettings";

export function ProjectForm({ initial, bridge, team = false, focusBackendFolders = false, onSave, onCancel, onDelete, onExport, onImport }: {
  initial?: ApiProject; bridge: ApiTestingBridge; onSave: (project: ApiProject, settings?: ApiAiChatSettings) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void>;
  /**
   * The signed-in team project: its name is the project code, addresses may stay unset ("미설정"),
   * and servers·environments are the team's shared settings (environments are also the web's).
   */
  team?: boolean;
  focusBackendFolders?: boolean;
  /** Saves the stored project as a share file; resolves to a short result, or "" when cancelled. */
  onExport?: () => Promise<string>;
  /** Adds a shared project file as a new project instead of filling in this form. */
  onImport?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ApiProject>(() => {
    const serverId = crypto.randomUUID();
    if (!initial) return { id: crypto.randomUUID(), name: "", servers: [{ id: serverId, name: "기본 API" }], environments: [{ id: crypto.randomUUID(), name: "dev", baseUrls: { [serverId]: "" } }] };
    // A team project may have no API server or environment yet: start with one to fill in.
    const draft = structuredClone(initial);
    if (!draft.servers.length) draft.servers.push({ id: serverId, name: "" });
    if (!draft.environments.length) draft.environments.push({ id: crypto.randomUUID(), name: "dev", baseUrls: {} });
    return draft;
  });
  // Leaving with edits asks first (same dialog as the scenario editor).
  const [original] = useState(() => JSON.stringify(draft));
  const [aiSettings, setAiSettings] = useState<ApiAiChatSettings | null>(null);
  const [originalAiSettings, setOriginalAiSettings] = useState("");
  const [folderDrafts, setFolderDrafts] = useState<Record<string, string>>({});
  const [loadingAi, setLoadingAi] = useState(true);
  const [aiError, setAiError] = useState("");
  const aiSettingsArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusBackendFolders || loadingAi) return;
    const input = aiSettingsArea.current?.querySelector<HTMLInputElement>("input");
    input?.scrollIntoView({ block: "center", behavior: "instant" });
    input?.focus({ preventScroll: true });
  }, [focusBackendFolders, loadingAi]);
  useEffect(() => {
    let live = true;
    void (initial ? bridge.getAiChatSettings(initial.id) : Promise.resolve({ folders: {} } as ApiAiChatSettings))
      .then(settings => {
        if (!live) return;
        setAiSettings(settings); setOriginalAiSettings(JSON.stringify(settings));
      }).catch(e => { if (live) setAiError(`AI 설정을 불러오지 못했습니다. ${(e as Error).message}`); })
      .finally(() => { if (live) setLoadingAi(false); });
    return () => { live = false; };
  }, [bridge, initial?.id]);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const leave = () => { if (JSON.stringify(draft) !== original || (aiSettings && JSON.stringify(aiSettings) !== originalAiSettings) || Object.values(folderDrafts).some(value => value.trim())) setConfirmLeave(true); else onCancel(); };
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [exported, setExported] = useState("");
  const runFileAction = async (action: () => Promise<void>) => {
    setSaving(true); setError(""); setExported("");
    try { await action(); } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); } finally { setSaving(false); }
  };
  const removed = initial ? [...initial.servers.filter(s => !draft.servers.some(n => n.id === s.id)).map(s => `서버 ${s.name}`), ...initial.environments.filter(e => !draft.environments.some(n => n.id === e.id)).map(e => `환경 ${e.name}`)] : [];
  const setServerName = (id: string, name: string) => setDraft({ ...draft, servers: draft.servers.map(s => s.id === id ? { ...s, name } : s) });
  const removeServer = (id: string) => setDraft({ ...draft, servers: draft.servers.filter(s => s.id !== id), environments: draft.environments.map(e => ({ ...e, baseUrls: Object.fromEntries(Object.entries(e.baseUrls).filter(([key]) => key !== id)) })) });
  const addServer = () => {
    const id = crypto.randomUUID();
    setDraft({ ...draft, servers: [...draft.servers, { id, name: "" }], environments: draft.environments.map(e => ({ ...e, baseUrls: { ...e.baseUrls, [id]: "" } })) });
  };
  const setEnvironment = (id: string, patch: Partial<ApiProject["environments"][number]>) => setDraft({ ...draft, environments: draft.environments.map(e => e.id === id ? { ...e, ...patch } : e) });
  const addEnvironment = () => setDraft({ ...draft, environments: [...draft.environments, { id: crypto.randomUUID(), name: "", baseUrls: Object.fromEntries(draft.servers.map(s => [s.id, ""])) }] });
  const columns = { "--api-env-columns": `minmax(96px,160px) repeat(${draft.servers.length}, minmax(0,1fr)) 32px` } as CSSProperties;
  return <form className="api-project-form" onSubmit={async event => {
    event.preventDefault();
    // A team project saves an empty address as unset.
    const parsed = team
      ? teamProjectSchema.safeParse({ ...draft, environments: draft.environments.map(e => ({ ...e, baseUrls: Object.fromEntries(Object.entries(e.baseUrls).filter(([, url]) => url.trim())) })) })
      : projectSchema.safeParse(draft);
    if (!parsed.success) { setError(team ? `서버·환경 이름과 입력한 HTTP(S) 기본 주소를 확인하세요. ${parsed.error.issues[0]?.message ?? ""}` : "프로젝트·서버·환경 이름과 모든 HTTP(S) 기본 주소를 확인하세요."); return; }
    setSaving(true);
    const settings = aiSettings ? { ...aiSettings, folders: Object.fromEntries(draft.servers.map(server => [server.id, [...(aiSettings.folders[server.id] ?? []), ...(folderDrafts[server.id]?.trim() ? [folderDrafts[server.id].trim()] : [])]])) } : undefined;
    try { await onSave(parsed.data, settings); } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); } finally { setSaving(false); }
  }}>
    <header className="api-project-form-heading">
      <button type="button" className="api-project-back" disabled={saving} onClick={leave}>← 돌아가기</button>
      <h2>{initial ? "프로젝트 설정" : "새 API 프로젝트"}</h2>
      <p>서버마다 API 명세를 등록하고, 실행할 때 고른 환경의 기본 주소로 호출합니다.</p>
      {team && <p className="api-field-help">팀 프로젝트 설정입니다. 저장하면 팀원 모두에게 바로 반영되고, 환경은 웹 시나리오·폼 자동 완성과 같이 씁니다. 비워 둔 주소는 미설정으로 저장됩니다.</p>}
      {!initial && onImport && <div className="api-project-import"><span>공유받은 프로젝트 파일이 있으면 직접 만들지 않고 가져올 수 있습니다.</span><button type="button" disabled={saving} onClick={() => void runFileAction(onImport)}>파일에서 가져오기</button></div>}
    </header>
    <fieldset disabled={saving}>
      <label className="api-project-field">{team ? "팀 프로젝트" : "프로젝트 이름"}<input required readOnly={team} title={team ? "팀 프로젝트 코드는 바꿀 수 없습니다" : undefined} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="예: 쇼핑몰 QA" /></label>

      <section className="api-project-section" aria-labelledby="api-project-servers">
        <h3 id="api-project-servers">API 서버</h3>
        <p className="api-field-help">백엔드·인증 서버처럼 명세가 따로 있는 서버마다 하나씩 둡니다.</p>
        <ul className="api-project-rows">{draft.servers.map((server, index) => <li key={server.id}>
          <input aria-label={`서버 ${index + 1} 이름`} required placeholder="예: 백엔드" value={server.name} onChange={e => setServerName(server.id, e.target.value)} />
          <button type="button" className="api-project-remove" disabled={draft.servers.length === 1} title={draft.servers.length === 1 ? "서버는 최소 1개 필요합니다" : `${server.name || "새 서버"} 서버 제거`} aria-label={`${server.name || "새 서버"} 서버 제거`} onClick={() => removeServer(server.id)}><Icon name="close" size={16} /></button>
        </li>)}</ul>
        <button type="button" className="api-compose-link" onClick={addServer}>+ 서버 추가</button>
      </section>

      <section className="api-project-section" aria-labelledby="api-project-environments">
        <h3 id="api-project-environments">환경별 기본 주소</h3>
        <p className="api-field-help">local·dev·prod처럼 환경마다 각 서버의 주소를 적습니다.</p>
        <div className="api-env-table" role="table" aria-label="환경별 기본 주소" style={columns}>
          <div className="api-env-row api-env-head" role="row"><span role="columnheader">환경</span>{draft.servers.map(server => <span role="columnheader" key={server.id}>{server.name || "새 서버"}</span>)}<span role="columnheader" aria-label="제거" /></div>
          {draft.environments.map(env => <div className="api-env-row" role="row" key={env.id}>
            <input role="cell" aria-label="환경 이름" required placeholder="dev" value={env.name} onChange={e => setEnvironment(env.id, { name: e.target.value })} />
            {draft.servers.map(server => <input role="cell" key={server.id} type="url" required={!team} aria-label={`${env.name || "새 환경"} ${server.name || "새 서버"} 기본 주소`} placeholder={team ? "미설정" : "https://api.example.com"} value={env.baseUrls[server.id] ?? ""} onChange={e => setEnvironment(env.id, { baseUrls: { ...env.baseUrls, [server.id]: e.target.value } })} />)}
            <button type="button" className="api-project-remove" disabled={draft.environments.length === 1} title={draft.environments.length === 1 ? "환경은 최소 1개 필요합니다" : `${env.name || "새 환경"} 환경 제거`} aria-label={`${env.name || "새 환경"} 환경 제거`} onClick={() => setDraft({ ...draft, environments: draft.environments.filter(e => e.id !== env.id) })}><Icon name="close" size={16} /></button>
          </div>)}
        </div>
        <button type="button" className="api-compose-link" onClick={addEnvironment}>+ 환경 추가</button>
      </section>

      {!!removed.length && <label className="api-project-removal" key={removed.join(",")}><input type="checkbox" required /><span><strong>{removed.join(", ")}</strong>을(를) 저장할 때 삭제합니다. {team ? "팀 프로젝트에서 지워지므로 팀원 모두에게 반영되고, 환경을 지우면 그 환경의 웹 주소도 함께 지워집니다. " : ""}관련 API 명세·저장 계정·인증 연결도 지워지고, 환경을 지우면 그 환경의 전역변수도 삭제됩니다. 시나리오가 쓰는 서버·환경은 저장 단계에서 거부됩니다. 확인했습니다.</span></label>}
      {loadingAi ? <p className="api-field-help" role="status">백엔드 폴더를 불러오는 중…</p> : aiSettings && <div ref={aiSettingsArea}><ProjectAiSettings project={draft} settings={aiSettings} drafts={folderDrafts} onDrafts={setFolderDrafts} onChange={setAiSettings} chooseDirectories={() => bridge.chooseDirectories()} /></div>}
      {aiError && <p role="alert" className="api-warning">{aiError}</p>}
      {error && <p role="alert" className="api-warning">{error}</p>}
    </fieldset>
    <footer className="api-project-form-footer">
      {initial && onExport && <span className="api-project-export">
        <button type="button" disabled={saving} title="설정·시나리오·스위트·명세 주소를 적힌 그대로 파일로 저장합니다. 전역변수·저장된 계정·쿠키는 넣지 않으니, 비밀값은 시나리오에 직접 적지 말고 전역변수로 쓰세요." onClick={() => void runFileAction(async () => setExported(await onExport()))}>프로젝트 내보내기</button>
        {onImport && <button type="button" disabled={saving} title={team ? "공유받은 프로젝트 파일에서 팀 프로젝트에 없는 서버·환경·시나리오·스위트만 추가합니다. 있는 것은 바꾸지 않습니다" : "공유받은 프로젝트 파일로 이 프로젝트를 업데이트하거나 새 프로젝트로 추가합니다"} onClick={() => void runFileAction(onImport)}>가져오기</button>}
        {exported && <small role="status">{exported}</small>}
      </span>}
      {initial && onDelete && <DeleteAction label="프로젝트 삭제" disabled={saving} description={`‘${initial.name}’의 모든 서버·환경, API 명세, 시나리오·초안, 저장된 문서 계정과 전역변수를 삭제합니다. 실제 API 서버의 데이터는 삭제하지 않습니다.`} onDelete={onDelete} />}
      <span className="api-project-form-actions"><button className="api-primary" disabled={saving || loadingAi}>{saving ? "저장 중…" : "프로젝트 저장"}</button></span>
    </footer>
    {confirmLeave && <div className="api-confirm-dialog-backdrop">
      <section className="api-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="api-project-leave-title">
        <h2 id="api-project-leave-title">저장하지 않은 변경사항</h2>
        <p>프로젝트 설정을 바꾼 내용이 저장되지 않았습니다. 나가면 수정 내용이 사라집니다.</p>
        <div className="api-actions">
          <button type="button" autoFocus onClick={() => setConfirmLeave(false)}>계속 수정</button>
          <button type="button" className="api-danger-action" onClick={onCancel}>변경사항 버리고 나가기</button>
        </div>
      </section>
    </div>}
  </form>;
}
