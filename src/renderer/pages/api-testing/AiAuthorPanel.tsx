import { useEffect, useRef, useState } from "react";
import type { ApiAiAuthorRequest, ApiAiAuthorResult, ApiAiCli, ApiAiCliStatus, ApiAiProgress, ApiCatalog, ApiEnvironmentScope, ApiProject, ApiTestingBridge } from "../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");
const cliNames: Record<ApiAiCli, string> = { claude: "Claude Code", codex: "Codex" };
// Claude Code aliases always point at the latest model of each tier; Codex takes any model name.
const modelSuggestions: Record<ApiAiCli, string[]> = { claude: ["sonnet", "opus", "haiku"], codex: [] };
const phaseText = (progress: ApiAiProgress | null) => !progress ? "준비 중…"
  : progress.phase === "writing" ? "AI가 시나리오를 만드는 중… (몇 분 걸릴 수 있어요)"
  : progress.phase === "checking" ? "만든 시나리오를 검사하는 중…"
  : `검사에서 나온 문제를 AI가 고치는 중… (${progress.attempt - 1}번째)`;

/**
 * Runs a local AI CLI (Claude Code / Codex) to write scenarios (and a suite when it splits the flow),
 * then lets the user review Checkly's check results and save the chosen drafts.
 */
export function AiAuthorPanel({ project, scope, bridge, onBusy, onSaved, onProjectChange }: {
  project: ApiProject; scope: ApiEnvironmentScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onSaved: () => void;
  /** Persists a project edit (the backend folder) and refreshes the page's project list. */
  onProjectChange: (project: ApiProject) => Promise<void>;
}) {
  const [backendDraft, setBackendDraft] = useState(project.backendPath ?? "");
  const [backendSaving, setBackendSaving] = useState(false);
  const [backendNotice, setBackendNotice] = useState("");
  const [statuses, setStatuses] = useState<ApiAiCliStatus[] | null>(null);
  const [pathDraft, setPathDraft] = useState<Record<ApiAiCli, string>>({ claude: "", codex: "" });
  const [checking, setChecking] = useState(false);
  const clis = statuses?.filter(status => !status.error).map(status => status.cli) ?? null;
  const [cli, setCli] = useState<ApiAiCli>("claude");
  const [models, setModels] = useState<Record<ApiAiCli, string>>({ claude: "", codex: "" });
  const [goal, setGoal] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [specWarnings, setSpecWarnings] = useState<string[]>([]);
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
  // Set on mount too: StrictMode (dev) runs the cleanup once before the real mount.
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    void applyStatuses(bridge.listAiClis());
    void bridge.getAiSettings().then(settings => { if (live.current) setPathDraft({ claude: settings.paths.claude ?? "", codex: settings.paths.codex ?? "" }); }).catch(() => undefined);
    void Promise.all(project.servers.map(server => bridge.getCatalog({ ...scope, serverId: server.id }).catch(() => null)))
      .then(catalogs => { if (live.current) { setSpecWarnings(specWarningsFor(project, catalogs)); setTags([...new Set(catalogs.flatMap(catalog => catalog?.operations.flatMap(operation => [operation.tag, ...(operation.tags ?? [])]) ?? []))].filter(Boolean).sort()); } });
  }, []);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void bridge.getAiProgress({ projectId: scope.projectId }).then(next => { if (live.current && next) setProgress(next); }).catch(() => undefined); }, 700);
    return () => clearInterval(timer);
  }, [running]);
  async function applyStatuses(pending: Promise<ApiAiCliStatus[]>) {
    setChecking(true);
    try {
      const next = await pending;
      if (!live.current) return;
      setStatuses(next);
      const usable = next.filter(status => !status.error).map(status => status.cli);
      if (usable.length && !usable.includes(cli)) setCli(usable[0]);
    } catch (e) { if (live.current) { setStatuses([]); setError(errorText(e)); } }
    finally { if (live.current) setChecking(false); }
  }
  const request = (): ApiAiAuthorRequest => ({ scope, cli, ...(models[cli].trim() ? { model: models[cli].trim() } : {}), goal, ...(selectedTags.length ? { tags: selectedTags } : {}) });
  const busy = running || saving || backendSaving;
  const saveBackendPath = async (next: string) => {
    setBackendSaving(true); setError(""); setBackendNotice("");
    try {
      const { backendPath: _previous, ...rest } = project;
      await onProjectChange(next.trim() ? { ...rest, backendPath: next.trim() } : rest);
      setBackendDraft(next.trim());
      setBackendNotice(next.trim() ? "저장했습니다." : "지웠습니다. 이제 API 문서만 봅니다.");
    } catch (e) { setError(errorText(e)); }
    finally { setBackendSaving(false); }
  };

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
            suiteNote = ` 스위트 '${result.suite.name}'를 저장했습니다${skipped ? ` (수정이 필요한 ${skipped}개 제외)` : ""}.`;
          } catch (e) { failures.push(`스위트: ${errorText(e)}`); }
        } else suiteNote = " 바로 실행할 수 있는 시나리오가 없어 스위트는 저장하지 않았습니다.";
      }
      if (failures.length) { setError(failures.join("\n")); setMessage(`일부만 저장했습니다.${suiteNote}`); return; }
      onSaved();
    } finally { if (live.current) setSaving(false); onBusy(false); }
  };

  const hasCli = Boolean(clis?.length);
  const nameOf = (id: string) => result?.drafts.find(draft => draft.id === id)?.name ?? id;
  return <section className="api-ai-author" aria-label="AI 시나리오 작성">
    <h2>AI 작성 도우미</h2>
    <p>AI가 API 문서{project.backendPath ? "와 백엔드 코드" : ""}를 보고 테스트 시나리오를 만듭니다. 만든 결과는 확인한 뒤 저장합니다.</p>
    <section className="api-ai-backend" aria-label="백엔드 코드 폴더">
      <label>백엔드 코드 폴더 (선택)<input aria-label="AI 백엔드 폴더 경로" value={backendDraft} disabled={busy} placeholder="비워 두면 API 문서만 봅니다" onChange={e => { setBackendDraft(e.target.value); setBackendNotice(""); }} /></label>
      <div className="api-actions">
        <button type="button" disabled={busy} onClick={async () => { try { const chosen = await bridge.chooseDirectory(); if (chosen) { setBackendDraft(chosen); setBackendNotice(""); } } catch (e) { setError(errorText(e)); } }}>폴더 선택</button>
        <button type="button" className="api-primary" disabled={busy || backendDraft.trim() === (project.backendPath ?? "")} onClick={() => void saveBackendPath(backendDraft)}>저장</button>
        {project.backendPath && <button type="button" disabled={busy} onClick={() => void saveBackendPath("")}>지우기</button>}
      </div>
      {backendNotice && <p role="status" className="api-field-help">{backendNotice}</p>}
    </section>
    {statuses && <ul className="api-ai-cli-status" aria-label="AI 프로그램 상태">{statuses.map(status => <li key={status.cli} className={status.error ? "is-missing" : ""}>
      <strong>{cliNames[status.cli]}</strong>
      <span title={status.path}>{status.error ? status.error : `사용 가능 · ${status.version}${status.custom ? " · 직접 지정한 위치" : ""}`}</span>
    </li>)}</ul>}
    {specWarnings.length > 0 && <div className="api-warning" role="note"><strong>명세를 다시 가져오세요</strong><ul>{specWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>AI는 명세에 있는 API와 필드만 사용합니다. API 문서 탭에서 ‘명세 새로고침’이나 가져오기를 다시 하세요.</div>}
    {clis !== null && !hasCli && <p className="api-warning">Claude Code나 Codex가 설치되어 있지 않습니다. 설치 후 ‘다시 찾기’를 누르거나, ‘프롬프트 복사’로 다른 AI에 붙여넣으세요.</p>}
    <details className="api-ai-cli-paths"><summary>AI 프로그램 위치 바꾸기</summary>
      <p className="api-field-help">자동으로 찾지 못할 때만 실행 파일 위치를 입력하세요. 비워 두면 자동으로 찾습니다.</p>
      {(["claude", "codex"] as const).map(item => <label key={item}>{cliNames[item]} 위치<input value={pathDraft[item]} placeholder={statuses?.find(status => status.cli === item)?.path ?? "자동으로 찾기"} onChange={e => setPathDraft({ ...pathDraft, [item]: e.target.value })} /></label>)}
      <div className="api-actions">
        <button type="button" disabled={busy || checking} onClick={() => { setError(""); void applyStatuses(bridge.saveAiSettings({ paths: pathDraft })); }}>저장</button>
        <button type="button" disabled={busy || checking} onClick={() => void applyStatuses(bridge.listAiClis(true))}>{checking ? "찾는 중…" : "다시 찾기"}</button>
      </div>
    </details>
    <fieldset disabled={busy}>
      <label>무엇을 테스트할까요?<textarea aria-label="AI 시나리오 업무 목표" rows={4} maxLength={10000} value={goal} placeholder="예: 로그인 후 상품을 장바구니에 담고 주문까지 확인. 재고가 없으면 실패하는지도 확인" onChange={e => setGoal(e.target.value)} /></label>
      <div className="api-ai-author-options">
        {hasCli && <label>AI<select aria-label="AI 사용 도구" value={cli} onChange={e => setCli(e.target.value as ApiAiCli)}>{clis!.map(item => <option key={item} value={item}>{cliNames[item]}</option>)}</select></label>}
        {hasCli && <label>모델<input aria-label="AI 모델" list={`api-ai-models-${cli}`} value={models[cli]} placeholder="기본값" onChange={e => setModels({ ...models, [cli]: e.target.value })} /><datalist id={`api-ai-models-${cli}`}>{modelSuggestions[cli].map(model => <option key={model} value={model} />)}</datalist></label>}
      </div>
      {tags.length > 0 && <details className="api-ai-author-tags"><summary>대상 API · {selectedTags.length ? `태그 ${selectedTags.length}개` : "전체"}</summary>
        <div>{tags.map(tag => <label key={tag} className="api-check-row"><input type="checkbox" checked={selectedTags.includes(tag)} onChange={e => setSelectedTags(e.target.checked ? [...selectedTags, tag] : selectedTags.filter(item => item !== tag))} />{tag}</label>)}</div>
      </details>}
    </fieldset>
    <div className="api-actions">
      <button className="api-primary" disabled={busy || !hasCli || !goal.trim()} title={!hasCli ? (clis === null ? "AI 프로그램을 찾는 중입니다." : "Claude Code나 Codex가 필요합니다.") : !goal.trim() ? "무엇을 테스트할지 먼저 적으세요." : undefined} onClick={() => void generate()}>{clis === null ? "AI 프로그램 찾는 중…" : "AI로 시나리오 만들기"}</button>
      {running && <button type="button" onClick={() => void bridge.cancelAiAuthor({ projectId: scope.projectId })}>취소</button>}
      <button type="button" disabled={busy || !goal.trim()} onClick={async () => { setError(""); try { await bridge.copyAiPrompt(request()); setMessage("복사했습니다. 다른 AI에 붙여넣으세요."); } catch (e) { setError(errorText(e)); } }}>프롬프트 복사</button>
    </div>
    {running && <p role="status" className="api-ai-author-progress">{phaseText(progress)}</p>}
    {error && <p className="api-warning" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {result && <section className="api-ai-author-result" aria-label="AI 작성 결과">
      <h3>만든 시나리오 {result.drafts.length}개</h3>
      {result.notes && <p className="api-ai-author-notes"><strong>AI 메모</strong> {result.notes}</p>}
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
