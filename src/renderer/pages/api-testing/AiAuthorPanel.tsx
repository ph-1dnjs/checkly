import { useEffect, useRef, useState } from "react";
import { YamlCode } from "./YamlCode";
import { ApiPicker, type PickableOperation } from "./ApiPicker";
import type { ApiAiImportResult, ApiCatalog, ApiEnvironmentScope, ApiProject, ApiTestingBridge, SavedApiScenario } from "../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

/**
 * The user writes scenarios with their own AI (Claude Code, Codex…) opened in the
 * backend project: Checkly hands over a guide, the AI asks what to test and writes a
 * result file, and Checkly checks it and saves the chosen scenarios and suite.
 */
export function AiAuthorPanel({ project, scope, bridge, onBusy, onSaved }: {
  project: ApiProject; scope: ApiEnvironmentScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onSaved: (first?: SavedApiScenario) => void;
}) {
  // Every operation the AI could use, and the ones picked for it (empty = all).
  const [operations, setOperations] = useState<PickableOperation[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [specWarnings, setSpecWarnings] = useState<string[]>([]);
  const [guide, setGuide] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ApiAiImportResult | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [saveSuite, setSaveSuite] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const live = useRef(true);
  // Set on mount too: StrictMode (dev) runs the cleanup once before the real mount.
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    void Promise.all(project.servers.map(server => bridge.getCatalog({ ...scope, serverId: server.id }).catch(() => null)))
      .then(catalogs => {
        if (!live.current) return;
        setSpecWarnings(specWarningsFor(project, catalogs));
        setOperations(project.servers.flatMap((server, index) => (catalogs[index]?.operations ?? []).map(operation => ({
          id: `${server.id} ${operation.key}`, method: operation.method, path: operation.path, summary: operation.summary,
          tags: [...new Set([operation.tag, ...(operation.tags ?? [])].filter(Boolean))],
          ...(operation.warnings.length ? { unavailable: operation.warnings.join(" · ") } : {}),
        }))));
      });
  }, []);
  const busy = checking || saving;
  const guideRequest = () => ({ scope, ...(picked.length ? { operations: picked } : {}) });
  const act = async (task: () => Promise<void>) => { setError(""); setMessage(""); try { await task(); } catch (e) { if (live.current) setError(errorText(e)); } };

  const check = async (load?: () => Promise<string | null>) => {
    setChecking(true); setResult(null);
    await act(async () => {
      let text = answer;
      if (load) { const loaded = await load(); if (loaded === null || !live.current) return; text = loaded; setAnswer(loaded); }
      const next = await bridge.checkAiScenarios(scope, text);
      if (!live.current) return;
      setResult(next);
      setChosen(next.drafts.map(draft => draft.id));
      setSaveSuite(Boolean(next.suite));
    });
    if (live.current) setChecking(false);
  };
  const loadResult = () => check(async () => {
    const file = await bridge.readAiResult(scope);
    if (!file) { setError("아직 AI 결과가 없습니다. AI가 결과를 저장했는지 확인하세요."); return null; }
    setMessage(`${new Date(file.modifiedAt).toLocaleString()}에 저장된 결과를 불러왔습니다.`);
    return file.text;
  });

  const save = async () => {
    if (!result) return;
    setSaving(true); onBusy(true); setError(""); setMessage("");
    const runnable = new Set<string>();
    const failures: string[] = [];
    let first: SavedApiScenario | undefined;
    try {
      for (const draft of result.drafts.filter(item => chosen.includes(item.id))) {
        try {
          const metadata = draft.groupPath ? { groupPath: draft.groupPath } : undefined;
          const item = draft.issues.length ? await bridge.saveScenarioDraft(scope, draft.yaml, {}, undefined, metadata) : await bridge.saveScenario(scope, draft.yaml, {}, undefined, metadata);
          if (!draft.issues.length) runnable.add(draft.id);
          first ??= item;
        } catch (e) { failures.push(`${draft.name}: ${errorText(e)}`); }
      }
      let suiteNote = "";
      if (result.suite && saveSuite) {
        const ids = result.suite.scenarioIds.filter(id => runnable.has(id));
        const skipped = result.suite.scenarioIds.length - ids.length;
        if (ids.length) {
          try {
            await bridge.saveSuite(scope.projectId, { id: crypto.randomUUID(), name: result.suite.name, scenarioIds: ids, onFailure: "stop", ...(result.suite.groupPath ? { groupPath: result.suite.groupPath } : {}) });
            suiteNote = ` 스위트 '${result.suite.name}'를 저장했습니다${skipped ? ` (수정이 필요한 ${skipped}개 제외)` : ""}.`;
          } catch (e) { failures.push(`스위트: ${errorText(e)}`); }
        } else suiteNote = " 바로 실행할 수 있는 시나리오가 없어 스위트는 저장하지 않았습니다.";
      }
      if (failures.length) { setError(failures.join("\n")); setMessage(`일부만 저장했습니다.${suiteNote}`); return; }
      onSaved(first);
    } finally { if (live.current) setSaving(false); onBusy(false); }
  };

  const problems = result ? problemReport(result) : "";
  const nameOf = (id: string) => result?.drafts.find(draft => draft.id === id)?.name ?? id;
  return <section className="api-ai-author" aria-label="AI 시나리오 작성">
    <h2>AI 작성 도우미</h2>
    <p>백엔드 프로젝트 폴더에서 Claude Code나 Codex를 열고 가이드를 붙여넣으세요. AI가 어떤 시나리오를 원하는지 물어본 뒤 작성해 저장합니다.</p>
    {specWarnings.length > 0 && <div className="api-warning" role="note"><strong>명세를 다시 가져오세요</strong><ul>{specWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>AI는 명세에 있는 API와 필드만 사용합니다. API 문서 탭에서 ‘명세 새로고침’이나 가져오기를 다시 하세요.</div>}
    <div className="api-actions">
      <button type="button" className="api-primary" disabled={busy} onClick={() => void act(async () => { await bridge.copyAiPrompt(guideRequest()); setMessage("가이드를 복사했습니다. AI에 붙여넣으세요."); })}>AI 가이드 복사</button>
      <button type="button" aria-expanded={guide !== null} disabled={busy} onClick={() => void act(async () => { if (guide !== null) { setGuide(null); return; } const text = await bridge.getAiPrompt(guideRequest()); if (live.current) setGuide(text); })}>{guide === null ? "가이드 보기" : "가이드 닫기"}</button>
      <button type="button" disabled={busy} onClick={() => void loadResult()}>{checking ? "검사 중…" : "AI 결과 불러오기"}</button>
    </div>
    {guide !== null && <pre className="api-ai-author-guide" aria-label="AI 가이드 내용">{guide}</pre>}
    {operations.length > 0 && <details className="api-ai-author-tags"><summary>AI가 쓸 API · {picked.length ? `${picked.length}개 선택` : `전체 ${operations.filter(operation => !operation.unavailable).length}개`}</summary>
      <ApiPicker operations={operations} picked={picked} disabled={busy} onChange={next => { setGuide(null); setPicked(next); }} />
    </details>}
    <details className="api-ai-author-paste"><summary>YAML 직접 붙여넣기·파일 가져오기</summary>
      <textarea aria-label="AI가 만든 YAML" rows={10} value={answer} disabled={busy} placeholder="AI가 대화에 출력한 답이나 시나리오 YAML을 그대로 붙여넣으세요." onChange={e => { setAnswer(e.target.value); setResult(null); }} />
      <div className="api-actions">
        <button type="button" disabled={busy || !answer.trim()} onClick={() => void check()}>검사</button>
        <button type="button" disabled={busy} onClick={() => void act(async () => { const text = await bridge.readScenarioFile(); if (text !== null && live.current) { setAnswer(text); setResult(null); } })}>YAML 파일 가져오기</button>
      </div>
    </details>
    {error && <p className="api-warning" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {result && <section className="api-ai-author-result" aria-label="AI 작성 결과">
      <h3>시나리오 {result.drafts.length}개</h3>
      {problems && <div className="api-ai-author-notes">검사에서 문제가 나왔습니다. 문제를 복사해 AI에 붙여넣고, AI가 고쳐 저장하면 다시 불러오세요. 그대로 저장하면 초안이 됩니다.
        <div className="api-actions"><button type="button" onClick={() => void act(async () => { await navigator.clipboard.writeText(problems); setMessage("문제를 복사했습니다. AI에 붙여넣으세요."); })}>문제 복사</button></div>
      </div>}
      <ul>{result.drafts.map(draft => <li key={draft.id} className={draft.issues.length ? "has-issues" : ""}>
        <label className="api-check-row"><input type="checkbox" aria-label={`${draft.name} 저장`} checked={chosen.includes(draft.id)} disabled={saving} onChange={e => setChosen(e.target.checked ? [...chosen, draft.id] : chosen.filter(id => id !== draft.id))} /><strong>{draft.name}</strong><small>{draft.stepCount}단계{draft.groupPath ? ` · ${draft.groupPath.join(" › ")}` : ""} · {draft.issues.length ? "수정 필요 (초안으로 저장)" : "바로 실행 가능"}</small></label>
        {draft.notices.length > 0 && <p className="api-field-help">{draft.notices.join(" · ")}</p>}
        {draft.issues.length > 0 && <ul className="api-ai-author-issues">{draft.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        {draft.executionIssues.length > 0 && <p className="api-field-help">실행 전에 필요: {draft.executionIssues.join(" · ")}</p>}
        <details><summary>내용 보기</summary><YamlCode source={draft.yaml} /></details>
      </li>)}</ul>
      {result.suite && <div className="api-ai-author-suite">
        <label className="api-check-row"><input type="checkbox" checked={saveSuite} disabled={saving} onChange={e => setSaveSuite(e.target.checked)} />스위트 ‘{result.suite.name}’{result.suite.groupPath ? ` (${result.suite.groupPath.join(" › ")})` : ""}도 저장</label>
        <ol>{result.suite.scenarioIds.map(id => <li key={id}>{nameOf(id)}{result.drafts.find(draft => draft.id === id)?.issues.length ? " · 수정 필요라 제외" : ""}</li>)}</ol>
        {result.suite.problems.map(problem => <p key={problem} className="api-field-help">{problem}</p>)}
      </div>}
      <div className="api-actions"><button className="api-primary" disabled={saving || !chosen.length} onClick={() => void save()}>{saving ? "저장 중…" : "선택한 것 저장"}</button></div>
    </section>}
  </section>;
}

/** Text to paste back into the user's AI; empty when everything passed. */
function problemReport(result: ApiAiImportResult): string {
  const scenarios = result.drafts.filter(draft => draft.issues.length).map(draft => [`### ${draft.name} (${draft.id})`, ...draft.issues.map(issue => `- ${issue}`)].join("\n"));
  const suite = result.suite?.problems.length ? [["### 스위트", ...result.suite.problems.map(problem => `- ${problem}`)].join("\n")] : [];
  if (!scenarios.length && !suite.length) return "";
  return ["Checkly 검사에서 아래 문제가 나왔습니다. 문제를 고친 전체 결과(모든 시나리오와 스위트)를 같은 결과 파일에 다시 저장하세요.", ...scenarios, ...suite].join("\n\n");
}

const staleDays = 30;
/** Servers whose spec is missing, lacks the original document (schemas unresolved) or is old. */
function specWarningsFor(project: ApiProject, catalogs: Array<ApiCatalog | null>): string[] {
  return project.servers.flatMap((server, index) => {
    const catalog = catalogs[index];
    if (!catalog) return [`${server.name}: 가져온 명세가 없습니다.`];
    if (catalog.spec === undefined) return [`${server.name}: 예전 방식으로 저장된 명세라 요청·응답 구조를 AI에 전달하지 못합니다.`];
    const days = Math.floor((Date.now() - Date.parse(catalog.importedAt)) / 86_400_000);
    return days >= staleDays ? [`${server.name}: ${days}일 전에 가져온 명세입니다.`] : [];
  });
}
