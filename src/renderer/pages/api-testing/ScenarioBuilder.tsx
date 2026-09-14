import { useEffect, useRef, useState } from "react";
import { stringify } from "yaml";
import { normalizeScenarioForStorage, parseScenario, scenarioSchema, scenarioStepLabel } from "../../../app/api-testing/shared/scenario";
import type { Json, Scenario, ScenarioInput } from "../../../app/api-testing/shared/scenario";
import type { ApiCatalog, ApiProject, ApiScope, ApiTestingBridge } from "../../../app/api-testing/shared/workspace";
import { apiReference, connectResponse, moveStep } from "./scenario-builder-model";
import type { RequestArea, Step } from "./scenario-builder-model";
import { GlobalVariablePicker } from "./GlobalVariablePicker";
import { SimpleStep } from "./SimpleStep";

function JsonField({ label, value, onChange, optional = false }: { label: string; value: unknown; onChange: (v: Json | undefined) => void; optional?: boolean }) {
  const [text, setText] = useState(value === undefined ? "" : JSON.stringify(value, null, 2));
  const emitted = useRef(value);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (emitted.current !== value) { setText(value === undefined ? "" : JSON.stringify(value, null, 2)); field.current?.setCustomValidity(""); emitted.current = value; } }, [value]);
  return <label>{label}<textarea ref={field} aria-label={label} rows={3} value={text} spellCheck={false} onChange={event => {
    const next = event.target.value; setText(next);
    try { const parsed = next.trim() ? JSON.parse(next) : optional ? undefined : JSON.parse(next); event.target.setCustomValidity(""); emitted.current = parsed; onChange(parsed); }
    catch { event.target.setCustomValidity("올바른 JSON을 입력하세요. 문자열은 큰따옴표로 감싸세요."); }
  }} /></label>;
}

function RuntimeInputSettings({ step, onChange }: { step: Step; onChange: (patch: Partial<Step>) => void }) {
  const update = (patch: Partial<ScenarioInput>) => {
    const next = { name: "", type: "string" as const, required: true, sensitive: true, ...step.input, ...patch };
    onChange({ input: next.name.trim() ? next : undefined });
  };
  return <details className="api-runtime-input"><summary>실행 중 사용자 입력 {step.input ? `· ${step.input.name}` : ""}</summary>
    <p>OTP·추가 인증번호처럼 앞 단계 후 사용자가 입력해야 하는 값입니다. 실행이 이 API 직전에 잠시 멈춥니다.</p>
    <label>입력 변수 이름<input aria-label="실행 입력 변수" value={step.input?.name ?? ""} placeholder="phoneCode" onChange={e => update({ name: e.target.value })} /></label>
    {step.input && <>
      <label>입력 안내 문구<input aria-label="실행 입력 안내" value={step.input.label ?? ""} placeholder="SMS 인증번호" onChange={e => update({ label: e.target.value || undefined })} /></label>
      <label>값 형식<select aria-label="실행 입력 형식" value={step.input.type} onChange={e => update({ type: e.target.value as ScenarioInput["type"] })}><option value="string">문자열</option><option value="number">숫자</option><option value="boolean">불리언</option><option value="object">JSON 객체</option><option value="array">JSON 배열</option></select></label>
      <label className="api-check-row"><input type="checkbox" checked={step.input.required} onChange={e => update({ required: e.target.checked })} />필수 입력</label>
      <label className="api-check-row"><input type="checkbox" checked={step.input.sensitive} onChange={e => update({ sensitive: e.target.checked })} />민감값으로 마스킹</label>
      <button type="button" onClick={() => onChange({ input: undefined })}>실행 중 입력 제거</button>
    </>}
  </details>;
}

function operationForStep(step: Step, catalogs: Record<string, ApiCatalog | null>, bindings: Record<string, string>) {
  const catalog = catalogs[bindings[step.server] ?? step.server];
  return catalog?.operations.find(operation => "operationId" in step.api
    ? operation.operationId === step.api.operationId
    : operation.path === step.api.path && operation.method.toUpperCase() === step.api.method);
}

export function ScenarioBuilder({ source, bindings, project, scope, bridge, onApply, onCancel, value, onChange, embedded = false, saving = false }: {
  source: string; bindings: Record<string, string>; project: ApiProject; scope: ApiScope; bridge: ApiTestingBridge;
  onApply: (source: string) => void; onCancel: () => void;
  value?: Scenario; onChange?: (value: Scenario) => void; embedded?: boolean; saving?: boolean;
}) {
  const [initial] = useState(() => {
    try { return { value: source.trim() ? parseScenario(source) : { version: 1 as const, id: `scenario-${crypto.randomUUID()}`, name: "새 시나리오", description: "", onFailure: "stop" as const, inputs: {}, vars: {}, valueBindings: [], steps: [] }, error: "" }; }
    catch { return { value: null, error: "YAML 문법을 먼저 확인하세요. 원본은 변경하지 않았습니다." }; }
  });
  const [localDraft, setLocalDraft] = useState<Scenario | null>(initial.value);
  const draft = value ?? localDraft;
  const setDraft = (next: Scenario) => { if (onChange) onChange(next); else setLocalDraft(next); };
  const [catalogs, setCatalogs] = useState<Record<string, ApiCatalog | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(initial.error);
  const [server, setServer] = useState(scope.serverId);
  const [operationKey, setOperationKey] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    let live = true;
    void Promise.all(project.servers.map(async s => [s.id, await bridge.getCatalog({ ...scope, serverId: s.id })] as const))
      .then(entries => { if (live) setCatalogs(Object.fromEntries(entries)); })
      .catch(() => { if (live) setError("API 명세를 읽지 못했습니다. 원본 YAML은 유지됩니다."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  if (!draft) return <div role="alert"><p>{error}</p><button onClick={onCancel}>YAML로 돌아가기</button></div>;
  const updateStep = (index: number, patch: Partial<Step>) => setDraft({ ...draft, steps: draft.steps.map((s, i) => i === index ? { ...s, ...patch } : s) });
  const operations = catalogs[server]?.operations.filter(o => `${o.method} ${o.path} ${o.summary} ${o.tag}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <form className="api-builder" aria-label="시나리오 시각 편집기" onInvalidCapture={event => { let element: HTMLElement | null = event.target as HTMLElement; while (element) { if (element instanceof HTMLDetailsElement) element.open = true; element = element.parentElement; } }} onSubmit={event => {
    event.preventDefault();
    const parsed = scenarioSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("\n")); return; }
    onApply(stringify(normalizeScenarioForStorage(parsed.data)));
  }}>
    <fieldset disabled={saving} style={{ border:0, padding:0, margin:0 }}>
    <p>{embedded ? "선택한 단계의 요청값을 설정하세요. 엔드포인트 설명과 요청·응답 구조는 OpenAPI 명세에서 표시하고 YAML에는 실행 설정만 저장합니다. API 추가로 돌아가도 작성 내용은 유지됩니다. 저장해도 실행되지는 않습니다." : "화면에서 수정한 내용을 YAML에 적용한 뒤 검사·저장합니다. 엔드포인트 설명과 요청·응답 구조는 OpenAPI 명세에서 읽으며 YAML에는 실행 설정만 저장합니다. 적용 전 원본은 유지되며 YAML 주석·서식은 다시 작성됩니다."}</p>
    <label>시나리오 이름<input aria-label="시나리오 이름" required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
    <label>한글 설명<textarea aria-label="시나리오 설명" value={draft.description ?? ""} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
    <details><summary>시나리오 설정 · 입력 변수</summary>
      <label>시나리오 ID<input required value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} /></label>
      <label>실패 시<select value={draft.onFailure} onChange={e => setDraft({ ...draft, onFailure: e.target.value as Scenario["onFailure"] })}><option value="stop">중단</option><option value="continue">계속</option></select></label>
      <JsonField label="지원 환경 JSON" value={draft.environments} optional onChange={v => setDraft({ ...draft, environments: v as Scenario["environments"] })} />
      <JsonField label="입력 변수 정의 JSON" value={draft.inputs} onChange={v => setDraft({ ...draft, inputs: v as Scenario["inputs"] })} />
      <JsonField label="초기 시나리오 변수 JSON" value={draft.vars} onChange={v => setDraft({ ...draft, vars: v as Scenario["vars"] })} />
      <JsonField label="요청·응답 값 출처 연결 JSON" value={draft.valueBindings} optional onChange={v => setDraft({ ...draft, valueBindings: (v ?? []) as Scenario["valueBindings"] })} />
    </details>
    <details open={!embedded}><summary>{embedded ? "다른 서버 API 추가" : "API 선택 · 단계 추가"}</summary><fieldset disabled={loading}><legend>서버별 API 선택</legend>
      <label>서버<select aria-label="추가할 API 서버" value={server} onChange={e => { setServer(e.target.value); setOperationKey(""); }}>{project.servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <input aria-label="추가할 API 검색" placeholder="태그·경로·이름 검색" value={query} onChange={e => { setQuery(e.target.value); setOperationKey(""); }} />
      <select aria-label="추가할 API" value={operationKey} onChange={e => setOperationKey(e.target.value)}><option value="">API 선택</option>{operations.map(o => <option key={o.key} value={o.key}>{o.method} {o.path} · {o.summary}</option>)}</select>
      {!loading && !catalogs[server] && <p>이 서버·환경의 API 문서에서 Swagger를 먼저 가져오세요.</p>}
      <button type="button" disabled={!operationKey} onClick={() => {
        const operation = catalogs[server]?.operations.find(o => o.key === operationKey);
        if (!operation) return;
        setDraft({ ...draft, steps: [...draft.steps, { id: `step-${crypto.randomUUID()}`, server, api: apiReference(operation), request: {}, extract: [] }] });
      }}>단계 추가</button>
    </fieldset></details>
    <div className={embedded ? "api-accordion-editor" : undefined}>
    <div>
    {draft.steps.map((step, index) => { const operation = operationForStep(step, catalogs, bindings); return <details className={`api-builder-step api-step-accordion api-selected-${"method" in step.api ? step.api.method.toLowerCase() : "api"}`} key={step.id} open={embedded ? undefined : true} aria-label={`편집 단계 ${index + 1}`}>
      <summary className="api-step-summary"><span>{index + 1}</span><span className="api-selected-method">{"method" in step.api ? step.api.method : "API"}</span><code>{"path" in step.api ? step.api.path : step.api.operationId}</code><span className="api-step-summary-name">{step.name || operation?.summary || step.id}</span><small>연결 {step.extract.length}</small></summary>
      <div className="api-step-body">
      <header className="api-actions"><strong>{index + 1}. {"operationId" in step.api ? step.api.operationId : `${step.api.method} ${step.api.path}`}</strong><button type="button" disabled={!index} onClick={() => setDraft(moveStep(draft, index, -1))}>위로</button><button type="button" disabled={index === draft.steps.length - 1} onClick={() => setDraft(moveStep(draft, index, 1))}>아래로</button><button type="button" onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })}>단계 삭제</button></header>
      {embedded && <SimpleStep scenario={draft} index={index} catalogs={catalogs} bindings={bindings} scope={scope} bridge={bridge} onChange={setDraft} />}
      <details open={!embedded}><summary>{embedded ? "고급 설정 · JSON / 이름 / 검증 수정" : `${step.name || "단계 설정"} · 요청·변수·검증 설정`}</summary>
      <small>{project.servers.find(s => s.id === (bindings[step.server] ?? step.server))?.name ?? step.server}</small>
      <label>단계 이름 · 선택<input value={step.name ?? ""} placeholder={operation?.summary || operation?.path || step.id} onChange={e => updateStep(index, { name: e.target.value || undefined })} /></label>
      {operation?.description && <p className="api-description"><strong>Swagger 설명</strong> · {operation.description}</p>}
      {!embedded && <RuntimeInputSettings step={step} onChange={patch => updateStep(index, patch)} />}
      <div className="api-builder-request-grid">{(["pathParams", "query", "headers", "cookies", "body"] as const).map(area => <JsonField key={area} label={`${index + 1}단계 ${area} JSON`} value={step.request[area]} optional onChange={value => updateStep(index, { request: { ...step.request, [area]: value } })} />)}</div>
      <p>문자열은 큰따옴표로 입력합니다. 기존 변수는 <code>{"{{globals.token}}"}</code>, <code>{"{{vars.itemId}}"}</code>처럼 참조하세요. 요청·응답 값 출처 연결은 고급 설정의 <code>valueBindings</code>에서 관리합니다.</p>
      {!embedded && index > 0 && <ResponseLink scenario={draft} index={index} onLink={next => { setDraft(next); setError(""); }} />}
      <GlobalVariablePicker scenario={draft} index={index} scope={scope} bridge={bridge} onChange={setDraft} />
      <details><summary>검증 설정 · 응답 변수 추출</summary>
        <p>검증을 추가하지 않으면 HTTP 2xx를 성공으로 봅니다.</p>
        {(step.expect ?? []).map((expectation, i) => <fieldset key={i}><legend>검증 {i + 1}</legend>
          <label>검증 대상<select value={expectation.source} onChange={e => { const source = e.target.value as typeof expectation.source; updateStep(index, { expect: step.expect!.map((v, n) => n === i ? { ...v, source, pointer: source === "body" ? "/" : undefined, header: source === "header" ? "content-type" : undefined } : v) }); }}><option value="status">HTTP 상태</option><option value="body">응답 본문</option><option value="header">응답 헤더</option></select></label>
          {expectation.source !== "status" && <label>응답 경로·헤더<input value={expectation.source === "body" ? expectation.pointer ?? "" : expectation.header ?? ""} onChange={e => updateStep(index, { expect: step.expect!.map((v, n) => n === i ? { ...v, [v.source === "body" ? "pointer" : "header"]: e.target.value } : v) })} /></label>}
          <label>연산자<select value={expectation.operator} onChange={e => updateStep(index, { expect: step.expect!.map((v, n) => n === i ? { ...v, operator: e.target.value as typeof v.operator } : v) })}><option value="equals">equals · 같음</option><option value="exists">exists · 존재</option><option value="contains">contains · 포함</option></select></label>
          {expectation.operator !== "exists" && <JsonField label={`${index + 1}단계 검증 ${i + 1} 기대값 JSON`} value={expectation.value} onChange={value => updateStep(index, { expect: step.expect!.map((v, n) => n === i ? { ...v, value } : v) })} />}
          <button type="button" onClick={() => updateStep(index, { expect: step.expect!.length === 1 ? undefined : step.expect!.filter((_, n) => n !== i) })}>검증 삭제</button>
        </fieldset>)}
        <button type="button" onClick={() => updateStep(index, { expect: [...(step.expect ?? []), { source: "status", operator: "equals", value: 200 }] })}>검증 추가</button>
        <JsonField label={`${index + 1}단계 응답 추출 JSON`} value={step.extract} onChange={value => updateStep(index, { extract: value as Step["extract"] })} />
      </details>
      </details>
      </div>
    </details>; })}
    </div></div>
    {!draft.steps.length && <p>{embedded ? "Swagger 목록에서 첫 API를 클릭하세요." : "위 목록에서 첫 API를 추가하세요."}</p>}
    {error && <p role="alert" className="api-warning">{error}</p>}
    </fieldset>
    {embedded && <details><summary>YAML 보기</summary><pre aria-label="작성 중인 시나리오 YAML">{stringify(normalizeScenarioForStorage(draft))}</pre></details>}
    <footer className="api-actions"><button type="submit" className="api-primary" disabled={saving || !draft.steps.length}>{saving ? "검사·저장 중…" : embedded ? "시나리오 검사·저장" : "편집 적용 · 검사"}</button>{!embedded && <button type="button" onClick={onCancel}>시각 편집 취소</button>}</footer>
  </form>;
}

function ResponseLink({ scenario, index, onLink }: { scenario: Scenario; index: number; onLink: (value: Scenario) => void }) {
  const [from, setFrom] = useState(0);
  const [pointer, setPointer] = useState("/data/id");
  const [variable, setVariable] = useState("");
  const [area, setArea] = useState<RequestArea>("query");
  const [field, setField] = useState("");
  const [prefix, setPrefix] = useState("");
  const [error, setError] = useState("");
  return <details><summary>이전 단계 응답 연결</summary>
    <label>응답 단계<select aria-label={`${index + 1}단계 연결 원본`} value={from} onChange={e => setFrom(Number(e.target.value))}>{scenario.steps.slice(0, index).map((s, i) => <option key={s.id} value={i}>{i + 1}. {scenarioStepLabel(s)}</option>)}</select></label>
    <label>응답 JSON Pointer<input aria-label={`${index + 1}단계 연결 응답 경로`} value={pointer} onChange={e => setPointer(e.target.value)} /></label>
    <label>새 시나리오 변수 이름<input aria-label={`${index + 1}단계 연결 변수`} value={variable} onChange={e => setVariable(e.target.value)} placeholder="itemId" /></label>
    <label>요청 위치<select aria-label={`${index + 1}단계 연결 요청 위치`} value={area} onChange={e => setArea(e.target.value as RequestArea)}>{["pathParams", "query", "headers", "cookies", "body"].map(v => <option key={v}>{v}</option>)}</select></label>
    <label>요청 필드 이름<input aria-label={`${index + 1}단계 연결 요청 필드`} value={field} onChange={e => setField(e.target.value)} placeholder="id" /></label>
    <label>접두사 · 선택<input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="예: Bearer 뒤에 공백" /></label>
    <button type="button" onClick={() => { try { onLink(connectResponse(scenario, from, index, pointer, variable, area, field, prefix)); setError(""); } catch (e) { setError((e as Error).message); } }}>응답 연결 적용</button>
    {error && <p role="alert" className="api-warning">{error}</p>}
  </details>;
}
