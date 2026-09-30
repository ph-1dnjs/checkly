import { useEffect, useState } from "react";
import type { ApiProjectImportPlan, ApiShareDiff } from "../../../../../app/api-testing/shared/workspace";

type Update = { projectId: string; scenarioIds: string[]; suiteIds: string[] };

function DiffSummary({ label, diff }: { label: string; diff: ApiShareDiff }) {
  const parts = [
    diff.added.length && `추가 ${diff.added.length}`, diff.incoming.length && `파일 변경 반영 ${diff.incoming.length}`,
    diff.mine && `내 변경 유지 ${diff.mine}`, diff.conflicts.length && `충돌 ${diff.conflicts.length}`, diff.same && `같음 ${diff.same}`,
  ].filter(Boolean);
  return <li><strong>{label}</strong> {parts.length ? parts.join(" · ") : "없음"}</li>;
}

/**
 * Asks how to bring in a share file of a project that already has a local copy: update that copy
 * (three-way: file-only changes apply, local-only changes stay, conflicts are picked one by one)
 * or add it as another project.
 */
export function ProjectImportDialog({ plan, onCancel, onImport }: {
  plan: ApiProjectImportPlan; onCancel: () => void; onImport: (update?: Update) => Promise<void>;
}) {
  const [mode, setMode] = useState<"update" | "new">("update");
  const [targetId, setTargetId] = useState(plan.targets[0].projectId);
  const [takeFile, setTakeFile] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = plan.targets.find(item => item.projectId === targetId)!;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);
  const conflicts = [...target.scenarios.conflicts.map(item => ({ ...item, kind: "시나리오", key: `scenario:${item.id}` })), ...target.suites.conflicts.map(item => ({ ...item, kind: "스위트", key: `suite:${item.id}` }))];
  const toggle = (key: string, on: boolean) => setTakeFile(previous => { const next = new Set(previous); if (on) next.add(key); else next.delete(key); return next; });
  const submit = async () => {
    setBusy(true); setError("");
    try {
      await onImport(mode === "new" ? undefined : {
        projectId: targetId,
        scenarioIds: target.scenarios.conflicts.filter(item => takeFile.has(`scenario:${item.id}`)).map(item => item.id),
        suiteIds: target.suites.conflicts.filter(item => takeFile.has(`suite:${item.id}`)).map(item => item.id),
      });
    } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); setBusy(false); }
  };
  return <div className="api-value-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <section className="api-value-modal api-project-import-dialog" role="dialog" aria-modal="true" aria-label="프로젝트 가져오기" onMouseDown={event => event.stopPropagation()}>
      <header>
        <div><p className="api-value-modal-kicker">프로젝트 가져오기</p><h2>{plan.name}</h2><small>시나리오 {plan.scenarios}개 · 스위트 {plan.suites}개</small></div>
        <button type="button" aria-label="프로젝트 가져오기 닫기" disabled={busy} onClick={onCancel}>×</button>
      </header>
      <fieldset disabled={busy}>
        <label className="api-import-option"><input type="radio" name="api-import-mode" checked={mode === "update"} onChange={() => setMode("update")} />
          <span><strong>기존 프로젝트 업데이트</strong><small>파일에만 있는 것은 추가하고, 파일 쪽 변경은 반영하고, 내 변경은 유지합니다. 삭제는 하지 않습니다.</small></span>
        </label>
        {mode === "update" && <div className="api-import-target">
          {plan.targets.length > 1 && <label>업데이트할 프로젝트<select aria-label="업데이트할 프로젝트" value={targetId} onChange={event => { setTargetId(event.target.value); setTakeFile(new Set()); }}>
            {plan.targets.map(item => <option key={item.projectId} value={item.projectId}>{item.name}</option>)}
          </select></label>}
          {plan.targets.length === 1 && <p>대상 · <strong>{target.name}</strong></p>}
          <ul className="api-import-summary">
            <DiffSummary label="시나리오" diff={target.scenarios} />
            <DiffSummary label="스위트" diff={target.suites} />
            {!!(target.serversAdded.length || target.environmentsAdded.length) && <li><strong>추가</strong> {[...target.serversAdded.map(name => `서버 ${name}`), ...target.environmentsAdded.map(name => `환경 ${name}`)].join(", ")}</li>}
          </ul>
          {!!conflicts.length && <div className="api-import-conflicts" role="group" aria-label="충돌 항목">
            <p>양쪽에서 모두 바뀐 항목입니다. 체크하면 파일 내용으로 바꾸고, 두면 내 것을 유지합니다.</p>
            {conflicts.map(item => <label key={item.key}><input type="checkbox" checked={takeFile.has(item.key)} onChange={event => toggle(item.key, event.target.checked)} />{item.kind} · {item.name}<small>파일 내용으로</small></label>)}
          </div>}
        </div>}
        <label className="api-import-option"><input type="radio" name="api-import-mode" checked={mode === "new"} onChange={() => setMode("new")} />
          <span><strong>새 프로젝트로 추가</strong><small>기존 프로젝트는 그대로 두고 복사본을 하나 더 만듭니다.</small></span>
        </label>
      </fieldset>
      {error && <p role="alert" className="api-warning">{error}</p>}
      <footer>
        <button type="button" disabled={busy} onClick={onCancel}>취소</button>
        <button type="button" className="api-primary" disabled={busy} onClick={() => void submit()}>{busy ? "가져오는 중…" : mode === "update" ? "업데이트" : "새 프로젝트로 가져오기"}</button>
      </footer>
    </section>
  </div>;
}
