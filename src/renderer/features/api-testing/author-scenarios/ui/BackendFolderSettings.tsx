import { useState } from "react";
import type { ApiAiChatSettings, ApiProject, ApiTestingBridge } from "../../../../../app/api-testing/shared/workspace";
import { Button } from "../../../../shared/ui/Button";
import { Input } from "../../../../shared/ui/Input";
function BackendFolderEditor({ project, settings, drafts, onDrafts, onChange, chooseDirectories }: {
  project: ApiProject; settings: ApiAiChatSettings;
  drafts: Record<string, string>; onDrafts: (drafts: Record<string, string>) => void;
  onChange: (settings: ApiAiChatSettings) => void; chooseDirectories: ApiTestingBridge["chooseDirectories"];
}) {
  const [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const folders = settings.folders;
  const add = (serverId: string, paths: string[]) => {
    if (paths.length) onChange({ ...settings, folders: { ...folders, [serverId]: [...new Set([...(folders[serverId] ?? []), ...paths])] } });
  };
  return <section className="api-ai-chat-settings" aria-labelledby="api-ai-backend-folders">
    <h3 id="api-ai-backend-folders">백엔드 코드 폴더</h3>
    <p className="api-field-help">서버마다 백엔드 저장소 폴더를 지정합니다(예: /Users/me/work/pharma-api). 이 PC에만 저장됩니다.</p>
    {project.servers.map(server => <div key={server.id} className="api-ai-chat-folder-server">
      <span>{server.name || "새 서버"}</span>
      {(folders[server.id] ?? []).length > 0 && <ul>{folders[server.id].map(folder => <li key={folder}><code title={folder}>{folder}</code>
        <Button variant="secondary" aria-label={`${server.name} 폴더 ${folder} 제거`} onClick={() => onChange({ ...settings, folders: { ...folders, [server.id]: folders[server.id].filter(item => item !== folder) } })}>제거</Button>
      </li>)}</ul>}
      <div className="api-actions">
        <Button variant="secondary" disabled={choosing} onClick={async () => {
          setChoosing(true); setError("");
          try { add(server.id, await chooseDirectories()); } catch (e) { setError((e as Error).message); } finally { setChoosing(false); }
        }}>폴더 선택…</Button>
        <Input aria-label={`${server.name || "새 서버"} 폴더 경로`} placeholder="또는 절대 경로 입력" value={drafts[server.id] ?? ""}
          onChange={e => onDrafts({ ...drafts, [server.id]: e.target.value })}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (drafts[server.id]?.trim()) { add(server.id, [drafts[server.id].trim()]); onDrafts({ ...drafts, [server.id]: "" }); } } }} />
        <Button variant="secondary" disabled={!drafts[server.id]?.trim()} onClick={() => { add(server.id, [drafts[server.id].trim()]); onDrafts({ ...drafts, [server.id]: "" }); }}>추가</Button>
      </div>
    </div>)}
    {error && <p className="api-warning" role="alert">{error}</p>}
  </section>;
}

/** Edits the AI chat's backend folders in place: each change is saved right away for this PC. */
export function BackendFolderSettings({ project, settings, bridge, disabled, onSaved }: {
  project: ApiProject; settings: ApiAiChatSettings; bridge: ApiTestingBridge; disabled?: boolean;
  onSaved: (settings: ApiAiChatSettings) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async (next: ApiAiChatSettings) => {
    setSaving(true); setError("");
    try { onSaved(await bridge.saveAiChatSettings(project.id, next)); }
    catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); }
    finally { setSaving(false); }
  };
  return <fieldset className="api-ai-backend-folders" disabled={disabled || saving}>
    <BackendFolderEditor project={project} settings={settings} drafts={drafts} onDrafts={setDrafts} onChange={next => void save(next)} chooseDirectories={() => bridge.chooseDirectories()} />
    {error && <p className="api-warning" role="alert">{error}</p>}
  </fieldset>;
}
