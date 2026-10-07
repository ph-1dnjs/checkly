import { useState } from "react";
import type { ApiAiChatSettings, ApiProject, ApiTestingBridge } from "../../../../../app/api-testing/shared/workspace";

export function ProjectAiSettings({ project, settings, drafts, onDrafts, onChange, chooseDirectories }: {
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
  return <section className="api-project-section api-ai-chat-settings" aria-labelledby="api-project-ai-settings">
    <h3 id="api-project-ai-settings">백엔드 코드 폴더 (선택)</h3>
    <p className="api-field-help">폴더를 지정하면 AI 작성 도우미에서 코드 읽기·대화·검사·저장을 진행합니다. 비워 두면 가이드 복사·결과 불러오기 방식으로 사용합니다. 이 PC에만 저장되고 프로젝트 내보내기에 포함되지 않습니다.</p>
    {project.servers.map(server => <div key={server.id} className="api-ai-chat-folder-server">
      <span>{server.name || "새 서버"}</span>
      {(folders[server.id] ?? []).length > 0 && <ul>{folders[server.id].map(folder => <li key={folder}><code title={folder}>{folder}</code>
        <button type="button" aria-label={`${server.name} 폴더 ${folder} 제거`} onClick={() => onChange({ ...settings, folders: { ...folders, [server.id]: folders[server.id].filter(item => item !== folder) } })}>제거</button>
      </li>)}</ul>}
      <div className="api-actions">
        <button type="button" disabled={choosing} onClick={async () => {
          setChoosing(true); setError("");
          try { add(server.id, await chooseDirectories()); } catch (e) { setError((e as Error).message); } finally { setChoosing(false); }
        }}>폴더 선택…</button>
        <input aria-label={`${server.name || "새 서버"} 폴더 경로`} placeholder="또는 절대 경로 입력" value={drafts[server.id] ?? ""}
          onChange={e => onDrafts({ ...drafts, [server.id]: e.target.value })}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (drafts[server.id]?.trim()) { add(server.id, [drafts[server.id].trim()]); onDrafts({ ...drafts, [server.id]: "" }); } } }} />
        <button type="button" disabled={!drafts[server.id]?.trim()} onClick={() => { add(server.id, [drafts[server.id].trim()]); onDrafts({ ...drafts, [server.id]: "" }); }}>추가</button>
      </div>
    </div>)}
    {error && <p className="api-warning" role="alert">{error}</p>}
  </section>;
}
