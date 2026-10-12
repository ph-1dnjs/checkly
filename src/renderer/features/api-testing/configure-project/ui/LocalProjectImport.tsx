import { useState } from "react";
import type { ApiStorageInfo } from "../../../../../app/api-testing/shared/workspace";

type Importable = Extract<ApiStorageInfo, { mode: "team" }>["importable"];

/**
 * Offered once after signing in, while the team project has no scenarios or suites yet: copies one
 * project kept on this computer into the team project. The local project itself stays as it was.
 */
export function LocalProjectImport({ projects, onImport, onClose }: {
  projects: Importable; onImport: (projectId: string) => Promise<void>; onClose: () => void;
}) {
  const [projectId, setProjectId] = useState(projects[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const picked = projects.find(project => project.id === projectId) ?? projects[0];
  return <section className="api-project-import api-local-import" aria-label="로컬 API 프로젝트 가져오기">
    <span><strong>로컬 API 프로젝트 가져오기</strong> · 이 컴퓨터에만 있던 프로젝트를 팀 프로젝트로 한 번 옮길 수 있습니다. 서버·환경은 이름이 같으면 합치고, 팀에 이미 있는 주소는 그대로 둡니다. 전역변수·문서 계정은 옮기지 않습니다.</span>
    <span className="api-actions">
      {projects.length > 1
        ? <select aria-label="가져올 로컬 프로젝트" value={projectId} disabled={busy} onChange={event => setProjectId(event.target.value)}>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        : <span>{picked.name}</span>}
      <small>시나리오 {picked.scenarios}개 · 스위트 {picked.suites}개</small>
      <button type="button" className="api-primary" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        try { await onImport(projectId); }
        catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); setBusy(false); }
      }}>{busy ? "가져오는 중…" : "가져오기"}</button>
      <button type="button" disabled={busy} onClick={onClose}>닫기</button>
    </span>
    {error && <p role="alert" className="api-warning">{error}</p>}
  </section>;
}
