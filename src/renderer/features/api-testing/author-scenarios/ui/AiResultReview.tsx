import { useEffect, useRef, useState, type ReactNode } from "react";
import { YamlCode } from "../../../../entities/api-testing";
import type { ApiAiImportResult, ApiEnvironmentScope, ApiTestingBridge, SavedApiScenario } from "../../../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

/** Which drafts start chosen: a name already saved usually means the same result again, so only a clean update of the one saved scenario is chosen. */
const initiallyChosen = (result: ApiAiImportResult) => result.drafts.filter(draft => !draft.sameName || (draft.replaces && !draft.issues.length)).map(draft => draft.id);

/**
 * Checked AI scenarios and suite: pick what to save, update or add as new, then save.
 * Shared by the copy-and-paste flow and the in-app chat.
 */
export function AiResultReview({ result, scope, bridge, onBusy, onSaved, notes, readOnly = false }: {
  result: ApiAiImportResult; scope: ApiEnvironmentScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onSaved: (first?: SavedApiScenario) => void;
  /** Shown above the list, e.g. how to get problems fixed. */
  notes?: ReactNode;
  readOnly?: boolean;
}) {
  const [chosen, setChosen] = useState<string[]>(() => initiallyChosen(result));
  const [saveSuite, setSaveSuite] = useState(Boolean(result.suite));
  // Drafts that would update a saved scenario but the user wants added as a new one instead.
  const [asNew, setAsNew] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const save = async () => {
    if (readOnly || savingNow.current) return;
    savingNow.current = true;
    setSaving(true); onBusy(true); setError(""); setMessage("");
    const runnable = new Set<string>();
    // Draft id → the id it was saved under (a draft added as new instead of updating gets a fresh id).
    const savedIds = new Map<string, string>();
    const failures: string[] = [];
    let first: SavedApiScenario | undefined;
    try {
      const chosenDrafts = result.drafts.filter(item => chosen.includes(item.id));
      const current = chosenDrafts.some(draft => draft.replaces && !asNew.includes(draft.id)) ? await bridge.listScenarios(scope.projectId) : [];
      for (const draft of chosenDrafts) {
        try {
          const metadata = draft.groupPath ? { groupPath: draft.groupPath } : undefined;
          const updating = Boolean(draft.replaces) && !asNew.includes(draft.id);
          const yaml = draft.replaces && !updating ? draft.yaml.replace(/^id: .*$/m, `id: scenario-${crypto.randomUUID()}`) : draft.yaml;
          const expectedUpdatedAt = updating ? current.find(item => item.id === draft.replaces)?.updatedAt : undefined;
          const item = draft.issues.length ? await bridge.saveScenarioDraft(scope, yaml, {}, expectedUpdatedAt, metadata) : await bridge.saveScenario(scope, yaml, {}, expectedUpdatedAt, metadata);
          savedIds.set(draft.id, item.id);
          if (!draft.issues.length) runnable.add(item.id);
          first ??= item;
        } catch (e) { failures.push(`${draft.name}: ${errorText(e)}`); }
      }
      let suiteNote = "";
      if (result.suite && saveSuite) {
        const { saved, fallbacks } = result.suite;
        const ids = result.suite.scenarioIds.map(id => {
          const savedAs = savedIds.get(id);
          if (savedAs && runnable.has(savedAs)) return savedAs;
          return saved?.[id] !== undefined ? id : fallbacks?.[id];
        }).filter((id): id is string => Boolean(id));
        const skipped = result.suite.scenarioIds.length - ids.length;
        if (ids.length) {
          try {
            // A same-name saved suite is updated (its run setting kept) instead of saved again as a copy.
            const replaces = result.suite.replaces;
            await bridge.saveSuite(scope.projectId, { id: replaces?.id ?? crypto.randomUUID(), name: result.suite.name, scenarioIds: ids, onFailure: replaces?.onFailure ?? "stop", ...(result.suite.groupPath ? { groupPath: result.suite.groupPath } : {}) }, replaces?.updatedAt);
            suiteNote = ` 스위트 '${result.suite.name}'를 ${replaces ? "업데이트" : "저장"}했습니다${skipped ? ` (저장하지 않았거나 수정이 필요한 ${skipped}개 제외)` : ""}.`;
          } catch (e) { failures.push(`스위트: ${errorText(e)}`); }
        } else suiteNote = " 바로 실행할 수 있는 시나리오가 없어 스위트는 저장하지 않았습니다.";
      }
      if (failures.length) { setError(failures.join("\n")); setMessage(`일부만 저장했습니다.${suiteNote}`); return; }
      onSaved(first);
    } finally { savingNow.current = false; if (live.current) setSaving(false); onBusy(false); }
  };

  // A suite made only of reused saved scenarios is worth saving even with no new scenario chosen.
  const suiteReuses = Boolean(saveSuite && result.suite?.scenarioIds.some(id => result.suite!.saved?.[id] !== undefined || result.suite!.fallbacks?.[id]));
  const nameOf = (id: string) => result.drafts.find(draft => draft.id === id)?.name ?? result.suite?.saved?.[id] ?? id;
  return <section className="api-ai-author-result" aria-label="AI 작성 결과">
    <h3>시나리오 {result.drafts.length}개</h3>
    {notes}
    <ul>{result.drafts.map(draft => <li key={draft.id} className={draft.issues.length ? "has-issues" : ""}>
      <label className="api-check-row"><input type="checkbox" aria-label={`${draft.name} 저장`} checked={chosen.includes(draft.id)} disabled={saving || readOnly} onChange={e => setChosen(e.target.checked ? [...chosen, draft.id] : chosen.filter(id => id !== draft.id))} /><strong>{draft.name}</strong><small>{draft.stepCount ? `${draft.stepCount}단계` : "단계 확인 불가"}{draft.groupPath ? ` · ${draft.groupPath.join(" › ")}` : ""} · {draft.issues.length ? "수정 필요 (초안으로 저장)" : draft.executionIssues.length ? "저장 가능 · 실행 전 설정 필요" : "바로 실행 가능"}</small></label>
      {draft.replaces && <label className="api-ai-author-replace">저장 방식<select aria-label={`${draft.name} 저장 방식`} value={asNew.includes(draft.id) ? "new" : "update"} disabled={saving || readOnly || !chosen.includes(draft.id)} onChange={e => setAsNew(e.target.value === "new" ? [...asNew, draft.id] : asNew.filter(id => id !== draft.id))}><option value="update">기존 시나리오 업데이트</option><option value="new">새 시나리오로 추가</option></select></label>}
      {draft.notices.length > 0 && <p className="api-field-help">{draft.replaces && asNew.includes(draft.id) ? "같은 이름의 기존 시나리오가 있습니다. 저장하면 같은 이름이 하나 더 생깁니다" : draft.notices.join(" · ")}</p>}
      {draft.issues.length > 0 && <ul className="api-ai-author-issues">{draft.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
      {draft.executionIssues.length > 0 && <p className="api-field-help">실행 전에 필요: {draft.executionIssues.join(" · ")}</p>}
      <details><summary>내용 보기</summary><YamlCode source={draft.yaml} /></details>
    </li>)}</ul>
    {result.suite && <div className="api-ai-author-suite">
      <label className="api-check-row"><input type="checkbox" checked={saveSuite} disabled={saving || readOnly} onChange={e => setSaveSuite(e.target.checked)} />스위트 ‘{result.suite.name}’{result.suite.groupPath ? ` (${result.suite.groupPath.join(" › ")})` : ""}{result.suite.replaces ? "도 업데이트 (같은 이름의 기존 스위트)" : "도 저장"}</label>
      <ol>{result.suite.scenarioIds.map(id => <li key={id}>{nameOf(id)}{result.drafts.find(draft => draft.id === id)?.replaces && chosen.includes(id) && !asNew.includes(id) ? " · 기존 시나리오 업데이트" : result.suite!.fallbacks?.[id] && !chosen.includes(id) ? " · 기존 시나리오 사용" : result.drafts.find(draft => draft.id === id)?.issues.length ? " · 수정 필요라 제외" : result.suite!.saved?.[id] !== undefined ? " · 기존 시나리오" : ""}</li>)}</ol>
      {result.suite.problems.map(problem => <p key={problem} className="api-field-help">{problem}</p>)}
    </div>}
    {error && <p className="api-warning" role="alert">{error}</p>}
    {message && <p className="api-ai-step-status" role="status">{message}</p>}
    <div className="api-actions"><button type="button" className="api-primary" disabled={saving || readOnly || (!chosen.length && !suiteReuses)} onClick={() => void save()}>{saving ? "저장 중…" : "선택한 것 저장"}</button></div>
  </section>;
}
