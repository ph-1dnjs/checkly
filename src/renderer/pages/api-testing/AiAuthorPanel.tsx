import { useEffect, useRef, useState } from "react";
import type { ApiAiAuthorRequest, ApiAiAuthorResult, ApiAiCli, ApiAiProgress, ApiEnvironmentScope, ApiProject, ApiTestingBridge } from "../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");
const cliNames: Record<ApiAiCli, string> = { claude: "Claude Code", codex: "Codex" };
// Claude Code aliases always point at the latest model of each tier; Codex takes any model name.
const modelSuggestions: Record<ApiAiCli, string[]> = { claude: ["sonnet", "opus", "haiku"], codex: [] };
const phaseText = (progress: ApiAiProgress | null) => !progress ? "AI 작성 준비 중…"
  : progress.phase === "writing" ? "AI가 명세와 소스를 읽고 시나리오를 작성하는 중…"
  : progress.phase === "checking" ? `Checkly가 작성 결과를 검사하는 중… (${progress.attempt}/${progress.maxAttempts})`
  : `검사에서 발견한 문제를 AI가 고치는 중… (${progress.attempt}/${progress.maxAttempts})`;

/**
 * Runs a local AI CLI (Claude Code / Codex) to write scenarios and an optional suite,
 * then lets the user review Checkly's check results and save the chosen drafts.
 */
export function AiAuthorPanel({ project, scope, bridge, onBusy, onSaved }: {
  project: ApiProject; scope: ApiEnvironmentScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onSaved: () => void;
}) {
  const [clis, setClis] = useState<ApiAiCli[] | null>(null);
  const [cli, setCli] = useState<ApiAiCli>("claude");
  const [models, setModels] = useState<Record<ApiAiCli, string>>({ claude: "", codex: "" });
  const [goal, setGoal] = useState("");
  const [includeSuite, setIncludeSuite] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ApiAiProgress | null>(null);
  const [result, setResult] = useState<ApiAiAuthorResult | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [saveSuite, setSaveSuite] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => {
    void bridge.listAiClis().then(found => { if (!live.current) return; setClis(found); if (found.length) setCli(found[0]); }).catch(() => { if (live.current) setClis([]); });
    void Promise.all(project.servers.map(server => bridge.getCatalog({ ...scope, serverId: server.id }).catch(() => null)))
      .then(catalogs => { if (live.current) setTags([...new Set(catalogs.flatMap(catalog => catalog?.operations.flatMap(operation => [operation.tag, ...(operation.tags ?? [])]) ?? []))].filter(Boolean).sort()); });
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void bridge.getAiProgress({ projectId: scope.projectId }).then(next => { if (live.current && next) setProgress(next); }).catch(() => undefined); }, 700);
    return () => clearInterval(timer);
  }, [running]);
  const request = (): ApiAiAuthorRequest => ({ scope, cli, ...(models[cli].trim() ? { model: models[cli].trim() } : {}), goal, includeSuite, ...(selectedTags.length ? { tags: selectedTags } : {}) });
  const busy = running || saving;

  const generate = async () => {
    setRunning(true); onBusy(true); setProgress(null); setResult(null); setMessage(""); setError("");
    try {
      const next = await bridge.authorWithAi(request());
      if (!live.current) return;
      setResult(next);
      setChosen(next.drafts.map(draft => draft.id));
      setSaveSuite(Boolean(next.suite));
    } catch (e) { if (live.current) setError(errorText(e)); }
    finally { if (live.current) { setRunning(false); setProgress(null); } onBusy(false); }
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
            suiteNote = ` 스위트 '${result.suite.name}'를 저장했습니다${skipped ? ` (초안·미저장 ${skipped}개 제외)` : ""}.`;
          } catch (e) { failures.push(`스위트: ${errorText(e)}`); }
        } else suiteNote = " 스위트에 넣을 수 있는(검사를 통과한) 시나리오가 없어 스위트는 저장하지 않았습니다.";
      }
      if (failures.length) { setError(failures.join("\n")); setMessage(`일부만 저장했습니다.${suiteNote}`); return; }
      onSaved();
    } finally { if (live.current) setSaving(false); onBusy(false); }
  };

  const hasCli = Boolean(clis?.length);
  return <section className="api-ai-author" aria-label="AI 시나리오 작성">
    <h2>AI 작성 도우미</h2>
    <p>{project.backendPath ? <>백엔드 소스 <code>{project.backendPath}</code>와 현재 환경의 API 명세를 읽고 시나리오를 작성합니다.</> : <>현재 환경의 API 명세로 시나리오를 작성합니다. 프로젝트 설정에서 백엔드 폴더를 지정하면 소스 코드도 참고합니다.</>} AI는 파일을 읽기만 하고 API를 호출하지 않습니다. 전역변수 값·서버 주소는 전달하지 않습니다.</p>
    {clis !== null && !hasCli && <p className="api-warning">Claude Code(claude) 또는 Codex(codex) CLI를 찾을 수 없습니다. 설치 후 다시 열거나, 아래 ‘프롬프트 복사’로 외부 AI를 사용하세요.</p>}
    <fieldset disabled={busy}>
      <label>만들고 싶은 시나리오<textarea aria-label="AI 시나리오 업무 목표" rows={4} maxLength={10000} value={goal} placeholder="예: 회원 로그인 후 상품을 장바구니에 담고 주문까지 확인. 재고가 없을 때 실패도 확인해줘" onChange={e => setGoal(e.target.value)} /></label>
      <div className="api-ai-author-options">
        {hasCli && <label>사용할 AI<select aria-label="AI 사용 도구" value={cli} onChange={e => setCli(e.target.value as ApiAiCli)}>{clis!.map(item => <option key={item} value={item}>{cliNames[item]}</option>)}</select></label>}
        {hasCli && <label>모델<input aria-label="AI 모델" list={`api-ai-models-${cli}`} value={models[cli]} placeholder="CLI 기본 모델" onChange={e => setModels({ ...models, [cli]: e.target.value })} /><datalist id={`api-ai-models-${cli}`}>{modelSuggestions[cli].map(model => <option key={model} value={model} />)}</datalist></label>}
        <label className="api-check-row"><input type="checkbox" checked={includeSuite} onChange={e => setIncludeSuite(e.target.checked)} />스위트도 함께 만들기</label>
      </div>
      {tags.length > 0 && <details className="api-ai-author-tags"><summary>API 범위 · {selectedTags.length ? `${selectedTags.length}개 태그` : "전체"}</summary>
        <div>{tags.map(tag => <label key={tag} className="api-check-row"><input type="checkbox" checked={selectedTags.includes(tag)} onChange={e => setSelectedTags(e.target.checked ? [...selectedTags, tag] : selectedTags.filter(item => item !== tag))} />{tag}</label>)}</div>
      </details>}
    </fieldset>
    <div className="api-actions">
      {hasCli && <button className="api-primary" disabled={busy || !goal.trim()} onClick={() => void generate()}>AI로 시나리오 만들기</button>}
      {running && <button type="button" onClick={() => void bridge.cancelAiAuthor({ projectId: scope.projectId })}>작성 취소</button>}
      <button type="button" disabled={busy || !goal.trim()} onClick={async () => { setError(""); try { await bridge.copyAiPrompt(request()); setMessage("프롬프트를 복사했습니다. 외부 AI에 붙여넣고, 결과 YAML은 시나리오 편집기에서 가져오세요."); } catch (e) { setError(errorText(e)); } }}>프롬프트 복사</button>
    </div>
    {running && <p role="status" className="api-ai-author-progress">{phaseText(progress)}</p>}
    {error && <p className="api-warning" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {result && <section className="api-ai-author-result" aria-label="AI 작성 결과">
      <h3>작성 결과 · 시나리오 {result.drafts.length}개{result.attempts > 1 ? ` · 수정 ${result.attempts - 1}회` : ""}</h3>
      {result.notes && <p className="api-ai-author-notes">{result.notes}</p>}
      <ul>{result.drafts.map(draft => <li key={draft.id} className={draft.issues.length ? "has-issues" : ""}>
        <label className="api-check-row"><input type="checkbox" aria-label={`${draft.name} 저장`} checked={chosen.includes(draft.id)} disabled={saving} onChange={e => setChosen(e.target.checked ? [...chosen, draft.id] : chosen.filter(id => id !== draft.id))} /><strong>{draft.name}</strong><code>{draft.id}</code><small>{draft.stepCount}단계 · {draft.issues.length ? "초안으로 저장" : "검사 통과"}</small></label>
        {draft.issues.length > 0 && <ul className="api-ai-author-issues">{draft.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        {draft.executionIssues.length > 0 && <p className="api-field-help">실행 전 설정 필요: {draft.executionIssues.join(" · ")}</p>}
        <details><summary>YAML 보기</summary><pre>{draft.yaml}</pre></details>
      </li>)}</ul>
      {result.suite && <div className="api-ai-author-suite">
        <label className="api-check-row"><input type="checkbox" checked={saveSuite} disabled={saving} onChange={e => setSaveSuite(e.target.checked)} />스위트 ‘{result.suite.name}’ 저장</label>
        <ol>{result.suite.scenarioIds.map(id => <li key={id}><code>{id}</code>{result.drafts.find(draft => draft.id === id)?.issues.length ? " · 초안이라 스위트에서 제외" : ""}</li>)}</ol>
        {result.suite.problems.map(problem => <p key={problem} className="api-field-help">{problem}</p>)}
      </div>}
      <div className="api-actions"><button className="api-primary" disabled={saving || !chosen.length} onClick={() => void save()}>{saving ? "저장 중…" : "선택한 항목 저장"}</button></div>
    </section>}
  </section>;
}
