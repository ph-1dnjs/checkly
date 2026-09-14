import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiCatalog, ApiProject, ApiScope, ApiTestingBridge, ApiScenarioInputRequest, ApiScenarioPreview, ApiScenarioResult, SavedApiScenario } from "../../../app/api-testing/shared/workspace";
import type { Json, Scenario } from "../../../app/api-testing/shared/scenario";
import { useRunAction } from "./useRunAction";
import type { OnRunAction } from "./useRunAction";
import { ScenarioBuilder } from "./ScenarioBuilder";
import { DeleteAction } from "./DeleteAction";
import { ProgressBar } from "../../shared/ui/ProgressBar";

const errorText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

function operationForStep(step: Scenario["steps"][number], catalogs: Record<string, ApiCatalog | null>, bindings: Record<string, string>) {
  return catalogs[bindings[step.server] ?? step.server]?.operations.find(operation => "operationId" in step.api
    ? operation.operationId === step.api.operationId
    : operation.path === step.api.path && operation.method.toUpperCase() === step.api.method.toUpperCase());
}

export function ScenarioPanel({ project, scope, bridge, onBusy, onRunAction, onEditSwagger }: { project: ApiProject; scope: ApiScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onRunAction: OnRunAction; onEditSwagger: (item: SavedApiScenario, preview: ApiScenarioPreview) => Promise<void> }) {
  const [editing, setEditing] = useState(true);
  const [visual, setVisual] = useState(false);
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<SavedApiScenario[]>([]);
  const [current, setCurrent] = useState<SavedApiScenario | null>(null);
  const [source, setSource] = useState("");
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ApiScenarioPreview | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ApiScenarioResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [checkedSource, setCheckedSource] = useState("");
  const [pendingInput, setPendingInput] = useState<ApiScenarioInputRequest | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState("");
  const [inputSubmitting, setInputSubmitting] = useState(false);
  const [catalogs, setCatalogs] = useState<Record<string, ApiCatalog | null>>({});
  const live = useRef(true);
  const runButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    live.current = true;
    void bridge.listScenarios(project.id).then(v => { if (live.current) setSaved(v); }).catch(e => { if (live.current) setError(errorText(e)); });
    return () => { live.current = false; void bridge.cancel(scope); };
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all(project.servers.map(async server => [server.id, await bridge.getCatalog({ ...scope, serverId: server.id })] as const))
      .then(entries => { if (active) setCatalogs(Object.fromEntries(entries)); })
      .catch(() => { if (active) setCatalogs({}); });
    return () => { active = false; };
  }, [bridge, project.servers, scope.environmentId, scope.projectId]);
  useEffect(() => {
    if (!running) {
      setPendingInput(null);
      setInputSubmitting(false);
      return;
    }
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await bridge.getPendingScenarioInput({ projectId: scope.projectId, environmentId: scope.environmentId });
        if (active) setPendingInput(next);
      } catch {
        // 실행 종료와 동시에 브리지가 닫히는 경우에는 결과 오류로 덮어쓰지 않는다.
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), 250);
      }
    };
    void poll();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [bridge, running, scope.projectId, scope.environmentId]);
  useEffect(() => {
    setInputValue("");
    setInputError("");
    setInputSubmitting(false);
  }, [pendingInput?.requestId]);
  const working = (v: boolean) => { setBusy(v); onBusy(v); };
  const check = async (yaml = source, mapping = bindings) => {
    const data = await bridge.previewScenario(scope, yaml, mapping);
    if (live.current) { setPreview(data); setCheckedSource(yaml); }
    return data;
  };
  const load = async (item: SavedApiScenario) => {
    setEditing(false); setCurrent(item); setSource(item.source); setBindings(item.bindings); setInputs({}); setResult(null); setPreview(null); setError(""); setNotice(""); working(true);
    try { await check(item.source, item.bindings); } catch (e) { setError(errorText(e)); } finally { working(false); }
  };
  const canUse = preview && checkedSource === source && preview.issues.length === 0;
  const parseScenarioInput = (request: ApiScenarioInputRequest, raw: string): Json => {
    if (request.type === "string") return raw;
    if (!raw.trim()) return null;
    try { return JSON.parse(raw) as Json; }
    catch { throw new Error(`${request.type} 입력은 JSON 형식으로 입력하세요`); }
  };
  const submitPendingInput = async (event: FormEvent) => {
    event.preventDefault();
    if (!pendingInput) return;
    setInputError(""); setInputSubmitting(true);
    try {
      const value = parseScenarioInput(pendingInput, inputValue);
      if (pendingInput.required && (value === null || value === "")) throw new Error("필수 입력값을 입력하세요");
      await bridge.submitScenarioInput({ projectId: scope.projectId, environmentId: scope.environmentId }, {
        requestId: pendingInput.requestId, runId: pendingInput.runId, stepId: pendingInput.stepId, name: pendingInput.name, value,
      });
      setPendingInput(null);
    } catch (e) {
      setInputError(errorText(e));
      setInputSubmitting(false);
    }
  };
  useRunAction(onRunAction, () => runButton.current?.click(), busy || !canUse);
  return <div className="api-columns api-scenarios">
    <aside aria-label="저장된 시나리오"><input aria-label="시나리오 검색" placeholder="시나리오 검색" value={query} onChange={e => setQuery(e.target.value)} /><h3>시나리오 · {saved.length}</h3><button disabled={busy} onClick={() => { setEditing(true); setCurrent(null); setSource(""); setPreview(null); setResult(null); setBindings({}); setInputs({}); setNotice(""); setError(""); }}>+ 새 시나리오</button>{saved.filter(s => `${s.name} ${s.id}`.toLowerCase().includes(query.toLowerCase())).map(s => <button key={s.id} className={current?.id === s.id ? "selected" : ""} disabled={busy} onClick={() => void load(s)}><strong>{s.name}</strong><small>{s.id}{s.draft ? " · 초안" : ""}</small></button>)}{!saved.length && <p>저장된 시나리오가 없습니다.</p>}</aside>
    <article className="api-request-panel api-scenario-detail">
      {current && <DeleteAction key={current.id} label="시나리오 삭제" disabled={busy} description={`‘${current.name}’${current.draft ? " 초안" : ""}을 프로젝트에서 삭제합니다. 현재 편집 내용도 닫힙니다. API 명세와 전역 변수는 유지됩니다.`} onDelete={async () => {
        await bridge.deleteScenario(project.id, current.id, current.updatedAt);
        setSaved(await bridge.listScenarios(project.id)); setCurrent(null); setSource(""); setPreview(null); setResult(null); setBindings({}); setInputs({}); setEditing(true); setNotice("시나리오를 삭제했습니다."); onRunAction(null);
      }} />}
      <header className="api-detail-heading"><div><h2>{preview?.scenario.name ?? current?.name ?? "새 시나리오"}</h2><p className="api-description">{preview?.scenario.description ?? "YAML을 가져와 호출 흐름을 검토하세요."}</p></div>{current && <button disabled={busy} aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? "편집 닫기" : "시나리오 편집"}</button>}</header>
      {current && preview && !editing && <button disabled={busy} onClick={async () => {
        working(true); setError("");
        try { await onEditSwagger(current, preview); } catch (e) { setError(errorText(e)); } finally { working(false); }
      }}>Swagger에서 편집</button>}
      {editing && <section className="api-source-editor" aria-label="시나리오 편집">
      {!visual && <button type="button" className="api-primary" disabled={busy} onClick={() => { setVisual(true); working(true); }}>화면으로 만들기 · 편집</button>}
      {visual ? <ScenarioBuilder source={source} bindings={bindings} project={project} scope={scope} bridge={bridge} onCancel={() => { setVisual(false); working(false); }} onApply={yaml => {
        setSource(yaml); setPreview(null); setResult(null); setNotice(""); setError(""); setVisual(false);
        void check(yaml).catch(e => setError(errorText(e))).finally(() => working(false));
      }} /> : <>
      <h3>YAML 편집 · 가져오기</h3><p>YAML을 붙여넣거나 파일로 가져온 뒤 서버 연결과 호출 순서를 확인하세요. 엔드포인트 설명과 요청·응답 구조는 연결된 OpenAPI 명세에서 표시합니다. 저장과 실행은 별도 작업입니다.</p>
      <p>비밀번호·토큰은 YAML에 직접 넣지 말고 <code>inputs</code> 또는 <code>globals</code>를 참조하세요.</p>
      <details><summary>지원 문법 예시</summary><pre>{`version: 1\nid: product/read\nname: 상품 조회\ndescription: 상품 상세 조회를 검증합니다.\nsteps:\n  - id: read\n    name: 상품 상세 조회\n    server: member\n    api:\n      method: GET\n      path: /items/{id}\n    request:\n      pathParams:\n        id: 7\n    expect:\n      - source: status\n        operator: equals\n        value: 200`}</pre></details>
      <label>시나리오 YAML<textarea aria-label="시나리오 YAML" rows={14} spellCheck={false} value={source} disabled={busy} onChange={e => { setSource(e.target.value); setPreview(null); setResult(null); setNotice(""); }} /></label>
      <div className="api-actions"><button disabled={busy} onClick={async () => { working(true); setError(""); try { const text = await bridge.readScenarioFile(); if (text !== null) { setSource(text); setPreview(null); setResult(null); setCurrent(null); setInputs({}); setNotice(""); } } catch (e) { setError(errorText(e)); } finally { working(false); } }}>YAML 파일 가져오기</button><button disabled={busy || !source.trim()} onClick={async () => { working(true); setError(""); setNotice(""); try { await check(); } catch (e) { setError(errorText(e)); setPreview(null); } finally { working(false); } }}>검사·미리보기</button></div>
      {preview && <>        <fieldset disabled={busy}><legend>시나리오의 서버 연결</legend>{[...new Set(preview.scenario.steps.map(s => s.server))].map(key => <label key={key}>{key}<select aria-label={`서버 연결 ${key}`} value={bindings[key] ?? (project.servers.some(s => s.id === key) ? key : "")} onChange={async e => {
          const mapping = { ...bindings, [key]: e.target.value }; setBindings(mapping); setPreview(null); working(true);
          try { await check(source, mapping); } catch (err) { setError(errorText(err)); } finally { working(false); }
        }}><option value="" disabled>프로젝트 서버 선택</option>{project.servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>)}</fieldset></>}
      </>}
      </section>}
      {preview && <>
        <p className="api-spec-meta">{preview.scenario.steps.length}개 API · {project.environments.find(e => e.id === scope.environmentId)?.name}{current?.draft ? " · 검토 대기 초안" : ""}</p>
        {Object.keys(preview.scenario.inputs).length > 0 && <fieldset disabled={busy}><legend>이번 실행의 입력값</legend>{Object.entries(preview.scenario.inputs).map(([key, definition]) => <label key={key}>{key}{definition.required ? " *" : ""} · {definition.type}<input aria-label={`시나리오 입력 ${key}`} autoComplete="off" type={definition.sensitive ? "password" : "text"} value={inputs[key] ?? ""} onChange={e => setInputs({ ...inputs, [key]: e.target.value })} /></label>)}</fieldset>}
        <div className="api-actions"><button disabled={busy || checkedSource !== source} onClick={async () => {
          working(true); setError(""); setNotice("");
          try { const item = await (canUse ? bridge.saveScenario : bridge.saveScenarioDraft)(scope, source, bindings, current?.id === preview.scenario.id ? current.updatedAt : undefined); setCurrent(item); setEditing(false); setSaved(await bridge.listScenarios(project.id)); setNotice("시나리오를 저장했습니다."); } catch (e) { setError(errorText(e)); } finally { working(false); }
        }}>{canUse ? "시나리오 저장" : "초안 저장"}</button><button ref={runButton} className="api-primary" disabled={busy || !canUse} onClick={async () => {
          working(true); setRunning(true); setError(""); setNotice("");
          try {
            const parsed = Object.fromEntries(Object.entries(preview.scenario.inputs).filter(([key, d]) => d.required || inputs[key] !== undefined && inputs[key] !== "").map(([key, d]) => [key, d.type === "string" ? inputs[key] ?? "" : JSON.parse(inputs[key] ?? "")]));
            const response = await bridge.runScenario(scope, source, bindings, parsed as Record<string, Json>);
            if (live.current) setResult(response);
          } catch (e) { if (live.current) { setResult(null); setError(e instanceof SyntaxError ? "숫자·불리언·객체·배열 입력은 JSON 형식으로 입력하세요" : errorText(e)); } }
          finally { if (live.current) { working(false); setRunning(false); } }
        }}>{running ? "실행 중…" : result ? "다시 실행" : "시나리오 실행"}</button>{running && <button onClick={() => void bridge.cancel(scope)}>실행 취소</button>}</div>

        {preview.issues.map(issue => <p className="api-warning" key={issue}>{issue}</p>)}
        <h3 className="api-section-title">호출 단계</h3>
        <ol className="api-step-preview">{preview.scenario.steps.map(s => {
          const operation = operationForStep(s, catalogs, bindings);
          const reference = operation ? `${operation.method} ${operation.path}` : "operationId" in s.api ? s.api.operationId : `${s.api.method} ${s.api.path}`;
          return <li key={s.id}>
            <strong>{s.name ?? operation?.summary ?? s.id}</strong>
            {operation?.description && <p>{operation.description}</p>}
            <code>{s.server} · {reference}</code>
            <details><summary>요청·검증·변수 연결</summary><pre>{JSON.stringify({ request: s.request, expect: s.expect, extract: s.extract, valueBindings: preview.scenario.valueBindings }, null, 2)}</pre></details>
            {s.extract.map(e => <p key={e.target}>응답 {e.pointer ?? e.header} → <code>{e.target}</code></p>)}
          </li>;
        })}</ol>

      </>}
      {notice && <p role="status">{notice}</p>}{error && <p className="api-warning" role="alert">{error}</p>}
      {(running || result) && <section className={`api-response${running ? " api-response-running" : ""}`} aria-label={running ? "시나리오 실행 중" : "시나리오 실행 결과"}>
        <h2>{running ? "실행 중" : `실행 결과 · ${result?.status}`}</h2>
        {running ? <ProgressBar label={pendingInput ? "입력 대기 중" : "시나리오 실행 중"} detail={pendingInput ? `${pendingInput.index + 1}/${pendingInput.totalSteps}단계 · ${pendingInput.label ?? pendingInput.name}` : preview ? `${preview.scenario.steps.length}개 API · 순서대로 실행 중` : "순서대로 실행 중"} /> : result?.steps.map(step => <details key={step.id} open><summary>{step.name} · {step.status} · {step.httpStatus ? `HTTP ${step.httpStatus} · ` : ""}{step.durationMs}ms{step.input ? ` · 입력 ${step.input.provided ? "완료" : "없음"}` : ""}</summary>{step.error && <p>{step.error}</p>}<pre>{JSON.stringify({ headers: step.headers, body: step.body }, null, 2)}</pre></details>)}
        {!running && result && <><h3>이번 실행의 시나리오 변수</h3><pre>{JSON.stringify(result.variables, null, 2)}</pre></>}
      </section>}
    </article>
    {pendingInput && <div className="api-input-modal-backdrop" role="presentation"><form className="api-input-modal" role="dialog" aria-modal="true" aria-labelledby="api-input-title" onSubmit={event => void submitPendingInput(event)}>
      <header><div><p className="api-input-kicker">실행 중 입력 · {pendingInput.index + 1}/{pendingInput.totalSteps}단계</p><h2 id="api-input-title">{pendingInput.label ?? pendingInput.name}</h2></div><span>{pendingInput.stepId}</span></header>
      <p>앞 단계 실행이 완료되었습니다. 다음 API를 호출하기 전에 값을 입력하세요.</p>
      <p className="api-input-note">입력값은 이번 실행의 <code>vars.{pendingInput.name}</code>으로만 전달되며 YAML이나 실행 결과에 원문으로 저장되지 않습니다.</p>
      <label>{pendingInput.name}{pendingInput.required ? " *" : ""}<input autoFocus type={pendingInput.sensitive ? "password" : pendingInput.type === "number" ? "number" : "text"} value={inputValue} disabled={inputSubmitting} placeholder={pendingInput.type === "string" ? "값 입력" : `${pendingInput.type} JSON 입력`} onChange={event => setInputValue(event.target.value)} /></label>
      {inputError && <p className="api-warning" role="alert">{inputError}</p>}
      <footer className="api-actions"><button type="button" disabled={inputSubmitting} onClick={() => { setPendingInput(null); void bridge.cancel(scope); }}>실행 취소</button><button type="submit" className="api-primary" disabled={inputSubmitting}>{inputSubmitting ? "전달 중…" : "입력 완료 · 계속"}</button></footer>
    </form></div>}
  </div>;
}
