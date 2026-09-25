import { useEffect, useRef, useState } from "react";
import type { ApiAiGuideRequest, ApiAiImportResult, ApiCatalog, ApiEnvironmentScope, ApiProject, ApiTestingBridge } from "../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

/**
 * The user writes scenarios with their own AI (Claude Code, Codex…) in the backend
 * project: Checkly hands over the authoring prompt, then checks the pasted result
 * and saves the chosen scenarios and suite.
 */
export function AiAuthorPanel({ project, scope, bridge, onBusy, onSaved, onProjectChange }: {
  project: ApiProject; scope: ApiEnvironmentScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onSaved: () => void;
  /** Persists a project edit (the backend folder) and refreshes the page's project list. */
  onProjectChange: (project: ApiProject) => Promise<void>;
}) {
  const [backendDraft, setBackendDraft] = useState(project.backendPath ?? "");
  const [backendSaving, setBackendSaving] = useState(false);
  const [backendNotice, setBackendNotice] = useState("");
  const [goal, setGoal] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [specWarnings, setSpecWarnings] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // The saved schema file covers the tags chosen at save time.
  const [catalogFile, setCatalogFile] = useState<{ path: string; tags: string } | null>(null);
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
      .then(catalogs => { if (live.current) { setSpecWarnings(specWarningsFor(project, catalogs)); setTags([...new Set(catalogs.flatMap(catalog => catalog?.operations.flatMap(operation => [operation.tag, ...(operation.tags ?? [])]) ?? []))].filter(Boolean).sort()); } });
  }, []);
  const tagKey = [...selectedTags].sort().join("\n");
  const savedCatalog = catalogFile?.tags === tagKey ? catalogFile.path : undefined;
  const request = (): ApiAiGuideRequest => ({ scope, goal, ...(selectedTags.length ? { tags: selectedTags } : {}), ...(savedCatalog ? { catalogFile: savedCatalog } : {}) });
  const busy = checking || saving || backendSaving;
  const act = async (task: () => Promise<void>) => { setError(""); setMessage(""); try { await task(); } catch (e) { if (live.current) setError(errorText(e)); } };
  const saveBackendPath = async (next: string) => {
    setBackendSaving(true); setError(""); setBackendNotice("");
    try {
      const { backendPath: _previous, ...rest } = project;
      await onProjectChange(next.trim() ? { ...rest, backendPath: next.trim() } : rest);
      setBackendDraft(next.trim());
      setBackendNotice(next.trim() ? "저장했습니다." : "지웠습니다.");
    } catch (e) { setError(errorText(e)); }
    finally { setBackendSaving(false); }
  };

  const check = async (text = answer, fromFile?: () => Promise<string | null>) => {
    setChecking(true); setResult(null);
    await act(async () => {
      if (fromFile) { const loaded = await fromFile(); if (loaded === null || !live.current) return; text = loaded; setAnswer(loaded); }
      const next = await bridge.checkAiScenarios(scope, text);
      if (!live.current) return;
      setResult(next);
      setChosen(next.drafts.map(draft => draft.id));
      setSaveSuite(Boolean(next.suite));
    });
    if (live.current) setChecking(false);
  };

  const save = async () => {
    if (!result) return;
    setSaving(true); onBusy(true); setError(""); setMessage("");
    const runnable = new Set<string>();
    const failures: string[] = [];
    try {
      for (const draft of result.drafts.filter(item => chosen.includes(item.id))) {
        try {
          if (draft.issues.length) await bridge.saveScenarioDraft(scope, draft.yaml, {});
          else { await bridge.saveScenario(scope, draft.yaml, {}); runnable.add(draft.id); }
        } catch (e) { failures.push(`${draft.name}: ${errorText(e)}`); }
      }
      let suiteNote = "";
      if (result.suite && saveSuite) {
        const ids = result.suite.scenarioIds.filter(id => runnable.has(id));
        const skipped = result.suite.scenarioIds.length - ids.length;
        if (ids.length) {
          try {
            await bridge.saveSuite(scope.projectId, { id: crypto.randomUUID(), name: result.suite.name, scenarioIds: ids, onFailure: "stop" });
            suiteNote = ` 스위트 '${result.suite.name}'를 저장했습니다${skipped ? ` (수정이 필요한 ${skipped}개 제외)` : ""}.`;
          } catch (e) { failures.push(`스위트: ${errorText(e)}`); }
        } else suiteNote = " 바로 실행할 수 있는 시나리오가 없어 스위트는 저장하지 않았습니다.";
      }
      if (failures.length) { setError(failures.join("\n")); setMessage(`일부만 저장했습니다.${suiteNote}`); return; }
      onSaved();
    } finally { if (live.current) setSaving(false); onBusy(false); }
  };

  const problems = result ? problemReport(result) : "";
  const nameOf = (id: string) => result?.drafts.find(draft => draft.id === id)?.name ?? id;
  return <section className="api-ai-author" aria-label="AI 시나리오 작성">
    <h2>AI 작성 도우미</h2>
    <p>백엔드 프로젝트에서 쓰는 AI(Claude Code, Codex 등)로 시나리오를 만듭니다. 프롬프트를 복사해 AI에 붙여넣고, AI가 만든 YAML을 아래에 붙여넣으면 검사한 뒤 저장합니다.</p>
    {specWarnings.length > 0 && <div className="api-warning" role="note"><strong>명세를 다시 가져오세요</strong><ul>{specWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>AI는 명세에 있는 API와 필드만 사용합니다. API 문서 탭에서 ‘명세 새로고침’이나 가져오기를 다시 하세요.</div>}

    <h3 className="api-ai-author-step">1. 프롬프트 만들기</h3>
    <section className="api-ai-backend" aria-label="백엔드 코드 폴더">
      <label>백엔드 코드 폴더 (선택)<input aria-label="AI 백엔드 폴더 경로" value={backendDraft} disabled={busy} placeholder="프롬프트에 코드 위치로 적습니다" onChange={e => { setBackendDraft(e.target.value); setBackendNotice(""); }} /></label>
      <div className="api-actions">
        <button type="button" disabled={busy} onClick={() => void act(async () => { const next = await bridge.chooseDirectory(); if (next) { setBackendDraft(next); setBackendNotice(""); } })}>폴더 선택</button>
        <button type="button" className="api-primary" disabled={busy || backendDraft.trim() === (project.backendPath ?? "")} onClick={() => void saveBackendPath(backendDraft)}>저장</button>
        {project.backendPath && <button type="button" disabled={busy} onClick={() => void saveBackendPath("")}>지우기</button>}
      </div>
      {backendNotice && <p role="status" className="api-field-help">{backendNotice}</p>}
    </section>
    <fieldset disabled={busy}>
      <label>무엇을 테스트할까요?<textarea aria-label="AI 시나리오 업무 목표" rows={4} maxLength={10000} value={goal} placeholder="예: 로그인 후 상품을 장바구니에 담고 주문까지 확인. 재고가 없으면 실패하는지도 확인" onChange={e => setGoal(e.target.value)} /></label>
      {tags.length > 0 && <details className="api-ai-author-tags"><summary>대상 API · {selectedTags.length ? `태그 ${selectedTags.length}개` : "전체"}</summary>
        <div>{tags.map(tag => <label key={tag} className="api-check-row"><input type="checkbox" checked={selectedTags.includes(tag)} onChange={e => setSelectedTags(e.target.checked ? [...selectedTags, tag] : selectedTags.filter(item => item !== tag))} />{tag}</label>)}</div>
      </details>}
    </fieldset>
    <p className="api-field-help" role="status" aria-label="상세 명세 위치">{savedCatalog ? `상세 명세: ${savedCatalog} (프롬프트에는 파일 위치만 넣습니다)` : "상세 명세는 프롬프트에 함께 넣습니다. 길면 파일로 저장하세요."}</p>
    <div className="api-actions">
      <button type="button" className="api-primary" disabled={busy || !goal.trim()} onClick={() => void act(async () => { await bridge.copyAiPrompt(request()); setMessage("복사했습니다. 백엔드 프로젝트에서 AI에 붙여넣으세요."); })}>프롬프트 복사</button>
      <button type="button" disabled={busy} onClick={() => void act(async () => { const saved = await bridge.saveAiCatalog({ scope, goal, ...(selectedTags.length ? { tags: selectedTags } : {}) }); if (saved && live.current) setCatalogFile({ path: saved, tags: tagKey }); })}>상세 명세 파일로 저장…</button>
    </div>

    <h3 className="api-ai-author-step">2. AI가 만든 YAML 검사</h3>
    {project.backendPath && <div className="api-ai-author-file">
      <p className="api-field-help">AI는 결과를 <code>{resultFile(project.backendPath)}</code> 에 저장합니다. 저장했으면 불러오세요. 이 파일은 백엔드 저장소의 .gitignore에 추가해 두세요.</p>
      <div className="api-actions"><button type="button" className="api-primary" disabled={busy} onClick={() => void check(answer, async () => {
        const file = await bridge.readAiResult(scope);
        if (!file) { setError(`아직 결과 파일이 없습니다: ${resultFile(project.backendPath!)}`); return null; }
        setMessage(`불러왔습니다: ${file.path}`);
        return file.text;
      })}>AI 결과 파일 불러오기</button></div>
    </div>}
    <label>AI 결과<textarea aria-label="AI가 만든 YAML" rows={10} value={answer} disabled={busy} placeholder={"AI가 출력한 YAML을 그대로 붙여넣으세요.\n시나리오는 --- 로 구분하고, 스위트는 마지막에 suite: { name, scenarios } 로 씁니다."} onChange={e => { setAnswer(e.target.value); setResult(null); }} /></label>
    <div className="api-actions">
      <button type="button" className={project.backendPath ? undefined : "api-primary"} disabled={busy || !answer.trim()} onClick={() => void check()}>{checking ? "검사 중…" : "검사"}</button>
      <button type="button" disabled={busy} onClick={() => void act(async () => { const text = await bridge.readScenarioFile(); if (text !== null && live.current) { setAnswer(text); setResult(null); } })}>YAML 파일 가져오기</button>
    </div>
    {error && <p className="api-warning" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {result && <section className="api-ai-author-result" aria-label="AI 작성 결과">
      <h3>시나리오 {result.drafts.length}개</h3>
      {problems && <div className="api-ai-author-notes">검사에서 문제가 나왔습니다. 문제를 복사해 AI에 붙여넣고 고친 결과를 다시 받아 오세요. 그대로 저장하면 초안이 됩니다.
        <div className="api-actions"><button type="button" onClick={() => void act(async () => { await navigator.clipboard.writeText(problems); setMessage("문제를 복사했습니다. AI에 붙여넣으세요."); })}>문제 복사</button></div>
      </div>}
      <ul>{result.drafts.map(draft => <li key={draft.id} className={draft.issues.length ? "has-issues" : ""}>
        <label className="api-check-row"><input type="checkbox" aria-label={`${draft.name} 저장`} checked={chosen.includes(draft.id)} disabled={saving} onChange={e => setChosen(e.target.checked ? [...chosen, draft.id] : chosen.filter(id => id !== draft.id))} /><strong>{draft.name}</strong><small>{draft.stepCount}단계 · {draft.issues.length ? "수정 필요 (초안으로 저장)" : "바로 실행 가능"}</small></label>
        {draft.issues.length > 0 && <ul className="api-ai-author-issues">{draft.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        {draft.executionIssues.length > 0 && <p className="api-field-help">실행 전에 필요: {draft.executionIssues.join(" · ")}</p>}
        <details><summary>내용 보기</summary><pre>{draft.yaml}</pre></details>
      </li>)}</ul>
      {result.suite && <div className="api-ai-author-suite">
        <label className="api-check-row"><input type="checkbox" checked={saveSuite} disabled={saving} onChange={e => setSaveSuite(e.target.checked)} />스위트 ‘{result.suite.name}’도 저장</label>
        <ol>{result.suite.scenarioIds.map(id => <li key={id}>{nameOf(id)}{result.drafts.find(draft => draft.id === id)?.issues.length ? " · 수정 필요라 제외" : ""}</li>)}</ol>
        {result.suite.problems.map(problem => <p key={problem} className="api-field-help">{problem}</p>)}
      </div>}
      <div className="api-actions"><button className="api-primary" disabled={saving || !chosen.length} onClick={() => void save()}>{saving ? "저장 중…" : "선택한 것 저장"}</button></div>
    </section>}
  </section>;
}

// Mirrors aiResultFile in the main process (display only; the main process decides the path).
const resultFile = (backendPath: string) => `${backendPath.replace(/[\\/]+$/, "")}/.checkly/scenarios.yaml`;

/** Text to paste back into the user's AI; empty when everything passed. */
function problemReport(result: ApiAiImportResult): string {
  const scenarios = result.drafts.filter(draft => draft.issues.length).map(draft => [`### ${draft.name} (${draft.id})`, ...draft.issues.map(issue => `- ${issue}`)].join("\n"));
  const suite = result.suite?.problems.length ? [["### 스위트", ...result.suite.problems.map(problem => `- ${problem}`)].join("\n")] : [];
  if (!scenarios.length && !suite.length) return "";
  return ["Checkly 검사에서 아래 문제가 나왔습니다. 문제를 고친 전체 결과(모든 시나리오와 스위트)를 같은 형식으로 다시 출력하세요.", ...scenarios, ...suite].join("\n\n");
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
