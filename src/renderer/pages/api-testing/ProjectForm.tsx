import { useState } from "react";
import { projectSchema, type ApiProject } from "../../../app/api-testing/shared/workspace";
import { DeleteAction } from "./DeleteAction";

export function ProjectForm({ initial, onSave, onCancel, onDelete }: {
  initial?: ApiProject; onSave: (project: ApiProject) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ApiProject>(() => {
    const serverId = crypto.randomUUID();
    return initial ? structuredClone(initial) : { id: crypto.randomUUID(), name: "", servers: [{ id: serverId, name: "기본 API" }], environments: [{ id: crypto.randomUUID(), name: "dev", baseUrls: { [serverId]: "" } }] };
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const removed = initial ? [...initial.servers.filter(s => !draft.servers.some(n => n.id === s.id)).map(s => `서버 ${s.name}`), ...initial.environments.filter(e => !draft.environments.some(n => n.id === e.id)).map(e => `환경 ${e.name}`)] : [];
  return <form className="api-project-form" onSubmit={async event => {
    event.preventDefault();
    const parsed = projectSchema.safeParse(draft);
    if (!parsed.success) { setError("프로젝트·서버·환경 이름과 모든 HTTP(S) 기본 주소를 확인하세요."); return; }
    setSaving(true);
    try { await onSave(parsed.data); } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); } finally { setSaving(false); }
  }}>
    <h2>{initial ? "프로젝트 설정" : "새 API 프로젝트"}</h2>
    <p>서버마다 Swagger를 등록하고, 환경에 맞는 기본 주소로 호출합니다.</p>
    <label>프로젝트 이름<input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="예: 쇼핑몰 QA" /></label>
    <h3>API 서버</h3>
    <p>서버·환경 제거는 저장할 때 적용됩니다. 관련 명세·저장 계정·인증 연결도 삭제됩니다. 시나리오에서 사용하는 서버와, 시나리오가 있는 프로젝트의 환경은 제거할 수 없습니다.</p>
    <div className="api-actions">{draft.servers.map(server => <button key={server.id} type="button" disabled={saving || draft.servers.length === 1} onClick={() => setDraft({ ...draft, servers: draft.servers.filter(s => s.id !== server.id), environments: draft.environments.map(e => ({ ...e, baseUrls: Object.fromEntries(Object.entries(e.baseUrls).filter(([id]) => id !== server.id)) })) })}>{server.name || "새 서버"} 서버 제거</button>)}</div>
    {draft.servers.map((server, index) => <label key={server.id}>서버 {index + 1} 이름<input required value={server.name} onChange={e => setDraft({ ...draft, servers: draft.servers.map(s => s.id === server.id ? { ...s, name: e.target.value } : s) })} /></label>)}
    <button type="button" onClick={() => {
      const id = crypto.randomUUID();
      setDraft({ ...draft, servers: [...draft.servers, { id, name: "" }], environments: draft.environments.map(e => ({ ...e, baseUrls: { ...e.baseUrls, [id]: "" } })) });
    }}>+ 서버 추가</button>
    <h3>환경별 호출 주소</h3>
    {draft.environments.map(env => <fieldset key={env.id}>
      <button type="button" disabled={saving || draft.environments.length === 1} onClick={() => setDraft({ ...draft, environments: draft.environments.filter(e => e.id !== env.id) })}>{env.name || "새 환경"} 환경 제거</button>
      <label>환경 이름<input required value={env.name} onChange={e => setDraft({ ...draft, environments: draft.environments.map(v => v.id === env.id ? { ...v, name: e.target.value } : v) })} /></label>
      {draft.servers.map(server => <label key={server.id}>{server.name || "새 서버"} 기본 주소<input type="url" required placeholder="https://api.example.com" value={env.baseUrls[server.id]} onChange={e => setDraft({ ...draft, environments: draft.environments.map(v => v.id === env.id ? { ...v, baseUrls: { ...v.baseUrls, [server.id]: e.target.value } } : v) })} /></label>)}
    </fieldset>)}
    <button type="button" onClick={() => setDraft({ ...draft, environments: [...draft.environments, { id: crypto.randomUUID(), name: "", baseUrls: Object.fromEntries(draft.servers.map(s => [s.id, ""])) }] })}>+ 환경 추가</button>
    {error && <p role="alert">{error}</p>}
    {!!removed.length && <label key={removed.join(",")}><input type="checkbox" required />{removed.join(", ")} 및 관련 저장 데이터 삭제를 확인했습니다. 환경 삭제 시 해당 전역 변수도 삭제됩니다. 저장 후에는 되돌릴 수 없습니다.</label>}
    {initial && onDelete && <DeleteAction label="프로젝트 삭제" disabled={saving} description={`‘${initial.name}’의 모든 서버·환경, API 명세, 시나리오·초안, 저장된 문서 계정과 전역 변수를 삭제합니다. 실제 API 서버의 데이터는 삭제하지 않습니다.`} onDelete={onDelete} />}
    <footer><button type="button" disabled={saving} onClick={onCancel}>취소</button><button className="api-primary" disabled={saving}>{saving ? "저장 중…" : "프로젝트 저장"}</button></footer>
  </form>;
}
