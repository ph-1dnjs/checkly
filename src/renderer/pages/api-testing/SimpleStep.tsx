import { useEffect, useState, type ComponentProps } from "react";
import type { Scenario, Json, ScenarioInput } from "../../../app/api-testing/shared/scenario";
import type { ApiCatalog, ApiOperation, ApiScope, ApiTestingBridge, ApiGlobal } from "../../../app/api-testing/shared/workspace";
import { connectResponse, type RequestArea } from "./scenario-builder-model";
import { objectValue, responseFields } from "./response-fields";
import { ScenarioValueLink } from "./ScenarioValueLink";

function DraftInput({ value, onChange, ...props }: ComponentProps<"input">) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return <input {...props} value={text} onChange={event => { setText(event.target.value); onChange?.(event); }} />;
}

export function findStepOperation(scenario: Scenario, index: number, catalogs: Record<string, ApiCatalog | null>, bindings: Record<string, string>) {
  const step = scenario.steps[index];
  return catalogs[bindings[step.server] ?? step.server]?.operations.find(op => "operationId" in step.api ? op.operationId === step.api.operationId : op.path === step.api.path && op.method.toUpperCase() === step.api.method);
}

function ResponsePicker({ operation, spec, onSelect }: { operation?: ApiOperation; spec?: Json; onSelect: (pointer: string) => void }) {
  const fields = operation ? responseFields(operation.responses, spec) : [];
  return <div><p>명세의 응답 구조입니다. 실제 값은 실행 후 결정됩니다. /0은 배열의 첫 항목입니다.</p>
    {!fields.length && <p>선택 가능한 응답 구조가 없습니다. 고급 설정에서 경로를 지정하세요.</p>}
    <div style={{ maxHeight: 220, overflow: "auto" }} data-scroll="light">{fields.map((f, i) => <div key={i}><button type="button" onClick={() => onSelect(f.pointer)}><code>{f.status} · {f.pointer || "전체 응답"}</code> <small>{f.type}</small></button></div>)}</div>
  </div>;
}

export function SimpleStep({ scenario, index, catalogs, bindings, scope, bridge, onChange }: {
  scenario: Scenario; index: number; catalogs: Record<string, ApiCatalog | null>; bindings: Record<string, string>;
  scope: ApiScope; bridge: ApiTestingBridge; onChange: (next: Scenario) => void;
}) {
  const step = scenario.steps[index];
  const operation = findStepOperation(scenario, index, catalogs, bindings);
  const [target, setTarget] = useState<{ area: RequestArea; name: string } | null>(null);
  const [responsePointer, setResponsePointer] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const destinations = scenario.steps.flatMap((s, i) => {
    if (i <= index) return [];
    const op = findStepOperation(scenario, i, catalogs, bindings);
    return [
      ...(op?.parameters ?? []).filter(p => ["query", "path", "header", "cookie"].includes(p.location)).map(p => ({ area: (p.location === "path" ? "pathParams" : p.location === "header" ? "headers" : p.location === "cookie" ? "cookies" : "query") as RequestArea, field: p.name })),
      ...Object.keys(objectValue(objectValue(op?.bodySchema).properties)).map(field => ({ area: "body" as RequestArea, field })),
    ].map(f => ({ ...f, index: i, key: JSON.stringify([s.id, f.area, f.field]), label: `${i + 1}. ${s.name || op?.summary || s.id} → ${f.area}.${f.field}` }));
  });
  const [action, setAction] = useState<"verify" | "global" | null>(null);
  const [globalName, setGlobalName] = useState("");
  const [error, setError] = useState("");
  const [globals, setGlobals] = useState<ApiGlobal[]>([]);
  useEffect(() => { let live = true; bridge.listGlobals(scope).then(v => { if (live) setGlobals(v); }).catch(() => {}); return () => { live = false; }; }, [bridge, scope.projectId, scope.environmentId]);
  const update = (patch: Partial<typeof step>) => onChange({ ...scenario, steps: scenario.steps.map((s, i) => i === index ? { ...s, ...patch } : s) });
  const updateInput = (patch: Partial<ScenarioInput>) => {
    const next = { name: "", type: "string" as const, required: true, sensitive: true, ...step.input, ...patch };
    update({ input: next.name.trim() ? next : undefined });
  };
  const fields = (operation?.parameters ?? []).filter(p => ["path", "query", "header", "cookie"].includes(p.location)).map(p => ({ name: p.name, area: (p.location === "path" ? "pathParams" : p.location === "header" ? "headers" : p.location === "cookie" ? "cookies" : "query") as RequestArea, type: p.type, required: p.required }));
  const body = objectValue(operation?.bodySchema);
  for (const [name, schema] of Object.entries(objectValue(body.properties))) fields.push({ name, area: "body", type: objectValue(schema).type ?? "string", required: operation?.bodyRequired === true && (body.required ?? []).includes(name) });
  const setValue = (area: RequestArea, name: string, value: Json | undefined) => {
    const previous = step.request[area];
    if (previous !== undefined && (!previous || typeof previous !== "object" || Array.isArray(previous))) { setError("기존 본문을 유지하기 위해 고급 설정에서 편집하세요."); return; }
    const next = { ...objectValue(previous) }; if (value === undefined) delete next[name]; else next[name] = value;
    update({ request: { ...step.request, [area]: next } });
  };
  const renderField = (field: typeof fields[number]) => {
    const current = objectValue(step.request[field.area])[field.name];
    return <div key={`${field.area}:${field.name}`}><label>{field.name}{field.required ? " *" : ""} <small>{field.area} · {field.type}</small>
      <DraftInput aria-label={`${index + 1}단계 ${field.name}`} value={typeof current === "object" ? JSON.stringify(current) : current ?? ""} onChange={e => {
        const text = e.target.value;
        if (!text) { e.target.setCustomValidity(""); setValue(field.area, field.name, undefined); return; }
        try {
          const value = text.includes("{{") || field.type === "string" ? text : JSON.parse(text);
          if (!text.includes("{{") && ((field.type === "number" || field.type === "integer") && typeof value !== "number" || field.type === "boolean" && typeof value !== "boolean")) throw new Error();
          e.target.setCustomValidity(""); setValue(field.area, field.name, value);
        } catch { e.target.setCustomValidity("필드 타입에 맞는 값을 입력하세요. 복잡한 값은 고급 설정을 사용하세요."); }
      }} /></label>
      <div className="api-actions"><button type="button" onClick={() => setTarget(field)}>시나리오 값 사용</button>
        <select aria-label={`${index + 1}단계 ${field.name} 전역변수`} value="" onChange={e => { if (e.target.value) setValue(field.area, field.name, `{{globals.${e.target.value}}}`); }}><option value="">전역변수 선택</option>{globals.map(g => <option key={g.name} value={g.name}>{g.name}</option>)}</select>
      </div></div>;
  };
  return <div>
    <h3>요청</h3>
    {!operation ? <p>명세를 확인할 수 없습니다. 고급 설정을 사용하세요.</p> : <>
      {fields.filter(f => f.required).map(renderField)}
      {!fields.some(f => f.required) && <p>필수 입력값 없음</p>}
      {fields.some(f => !f.required) && <details><summary>선택 입력값</summary>{fields.filter(f => !f.required).map(renderField)}</details>}
      {operation.bodyRequired && !Object.keys(objectValue(body.properties)).length && <p>요청 본문이 필요합니다. 고급 설정에서 본문을 입력하세요.</p>}
    </>}
    <details className="api-runtime-input"><summary>실행 중 사용자 입력 {step.input ? `· ${step.input.name}` : ""}</summary>
      <p>OTP·추가 인증번호처럼 앞 단계 후 사용자가 입력해야 하는 값입니다. 실행이 이 API 직전에 잠시 멈춥니다.</p>
      <label>입력 변수 이름<input aria-label={`${index + 1}단계 실행 입력 변수`} value={step.input?.name ?? ""} placeholder="phoneCode" onChange={e => updateInput({ name: e.target.value })} /></label>
      {step.input && <>
        <label>입력 안내 문구<input aria-label={`${index + 1}단계 실행 입력 안내`} value={step.input.label ?? ""} placeholder="SMS 인증번호" onChange={e => updateInput({ label: e.target.value || undefined })} /></label>
        <label>값 형식<select aria-label={`${index + 1}단계 실행 입력 형식`} value={step.input.type} onChange={e => updateInput({ type: e.target.value as ScenarioInput["type"] })}><option value="string">문자열</option><option value="number">숫자</option><option value="boolean">불리언</option><option value="object">JSON 객체</option><option value="array">JSON 배열</option></select></label>
        <label className="api-check-row"><input type="checkbox" checked={step.input.required} onChange={e => updateInput({ required: e.target.checked })} />필수 입력</label>
        <label className="api-check-row"><input type="checkbox" checked={step.input.sensitive} onChange={e => updateInput({ sensitive: e.target.checked })} />민감값으로 마스킹</label>
        <button type="button" onClick={() => update({ input: undefined })}>실행 중 입력 제거</button>
      </>}
    </details>
    {target && <ScenarioValueLink scenario={scenario} targetIndex={index} target={target} catalogs={catalogs} bindings={bindings} onChange={onChange} onClose={() => setTarget(null)} />}
    <h3>응답 · 명세 구조</h3>
    <ResponsePicker operation={operation} spec={catalogs[bindings[step.server] ?? step.server]?.spec} onSelect={pointer => { setResponsePointer(pointer); setDestination(""); }} />
    {responsePointer !== null && <section aria-label="응답 연결 대상">
      <p>선택한 응답: <code>{responsePointer || "전체 응답"}</code></p>
      <select aria-label={`${index + 1}단계 응답 연결 대상`} value={destination} onChange={e => setDestination(e.target.value)}><option value="">연결할 이후 단계의 요청값 선택</option>{destinations.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select>
      <button type="button" disabled={!destinations.some(d => d.key === destination)} onClick={() => {
        const target = destinations.find(d => d.key === destination); if (!target) return;
        try { onChange(connectResponse(scenario, index, target.index, responsePointer, `response_${crypto.randomUUID().replace(/-/g, "")}`, target.area, target.field)); setResponsePointer(null); setError(""); } catch (e) { setError((e as Error).message); }
      }}>요청값에 연결</button><button type="button" onClick={() => setResponsePointer(null)}>취소</button>
      {!destinations.length && <p>연결할 이후 단계의 요청 필드가 없습니다.</p>}
    </section>}
    {step.extract.map((extract, n) => <p key={n}><code>{extract.pointer ?? extract.header} → {extract.target}</code></p>)}
    <p>{step.expect?.length ? `추가 검증 ${step.expect.length}개` : "기본 검증 · HTTP 2xx"} · 응답 저장 {step.extract.length}개</p>
    <div className="api-actions"><button type="button" onClick={() => setAction("verify")}>검증 추가</button><button type="button" onClick={() => setAction("global")}>응답을 전역변수로 저장</button></div>
    {action && <section>{action === "global" && <label>전역변수 이름<input value={globalName} onChange={e => setGlobalName(e.target.value)} /></label>}
      <ResponsePicker operation={operation} spec={catalogs[bindings[step.server] ?? step.server]?.spec} onSelect={pointer => {
        if (action === "verify") update({ expect: [...(step.expect ?? []), { source: "body", pointer, operator: "exists" }] });
        else { if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(globalName) || ["constructor", "prototype"].includes(globalName)) { setError("전역변수 이름은 영문으로 시작하는 영문·숫자·밑줄을 사용하세요."); return; } update({ extract: [...step.extract.filter(e => e.target !== `globals.${globalName}`), { source: "body", pointer, target: `globals.${globalName}`, sensitive: false }] }); }
        setAction(null); setError("");
      }} /><button type="button" onClick={() => setAction(null)}>선택 취소</button><p>선택한 필드의 존재를 검증합니다. 값 비교는 고급 설정에서 변경할 수 있습니다. 전역변수는 실제 실행 시 저장됩니다.</p></section>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
