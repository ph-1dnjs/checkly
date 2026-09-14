import { useState } from "react";
import type { Json, Scenario, ValueBinding } from "../../../app/api-testing/shared/scenario";
import type { ApiCatalog, ApiOperation } from "../../../app/api-testing/shared/workspace";
import { connectValue, type BindingArea, type RequestArea } from "./scenario-builder-model";
import { objectValue, responseFields } from "./response-fields";

type RequestValueOption = { pointer: string; type: string };
export type ScenarioValueTarget = { area: RequestArea; name: string };

function findOperation(scenario: Scenario, index: number, catalogs: Record<string, ApiCatalog | null>, bindings: Record<string, string>): ApiOperation | undefined {
  const step = scenario.steps[index];
  if (!step) return undefined;
  return catalogs[bindings[step.server] ?? step.server]?.operations.find(operation => "operationId" in step.api
    ? operation.operationId === step.api.operationId
    : operation.path === step.api.path && operation.method.toUpperCase() === step.api.method.toUpperCase());
}

function requestValueFields(request: Scenario["steps"][number]["request"], area: RequestArea): RequestValueOption[] {
  const value = request[area];
  if (value === undefined) return [];
  const result: RequestValueOption[] = [];
  const visit = (current: Json, pointer: string, depth: number) => {
    if (depth > 12 || result.length >= 500) return;
    if (current === null || typeof current !== "object") {
      result.push({ pointer, type: current === null ? "null" : typeof current });
      return;
    }
    if (Array.isArray(current)) {
      result.push({ pointer, type: "array" });
      current.forEach((item, index) => visit(item, `${pointer}/${index}`, depth + 1));
      return;
    }
    const entries = Object.entries(current);
    result.push({ pointer, type: "object" });
    entries.forEach(([key, item]) => visit(item, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, depth + 1));
  };
  visit(value as Json, "", 0);
  return result;
}

function inputName(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z]/.test(normalized) ? normalized : `value_${normalized || "source"}`;
}

export function ScenarioValueLink({ scenario, targetIndex, target, catalogs, bindings, onChange, onClose }: {
  scenario: Scenario;
  targetIndex: number;
  target: ScenarioValueTarget;
  catalogs: Record<string, ApiCatalog | null>;
  bindings: Record<string, string>;
  onChange: (next: Scenario) => void;
  onClose: () => void;
}) {
  const sourceSteps = scenario.steps.map((step, index) => ({ step, index })).filter(item => item.index !== targetIndex);
  const initialSource = sourceSteps.find(item => item.index < targetIndex)?.index ?? sourceSteps[0]?.index ?? -1;
  const [source, setSource] = useState<ValueBinding["source"]>("response");
  const [from, setFrom] = useState(initialSource);
  const [requestArea, setRequestArea] = useState<RequestArea>("body");
  const [responseArea, setResponseArea] = useState<"body" | "header">("body");
  const [pointer, setPointer] = useState<string | null>(null);
  const [header, setHeader] = useState("");
  const [variable, setVariable] = useState(inputName(target.name));
  const [prefix, setPrefix] = useState("");
  const [error, setError] = useState("");
  const sourceStep = scenario.steps[from];
  const sourceOperation = sourceStep ? findOperation(scenario, from, catalogs, bindings) : undefined;
  const requestOptions = source === "request" && sourceStep ? requestValueFields(sourceStep.request, requestArea) : [];
  const responseOptions = source === "response" && responseArea === "body" && sourceOperation ? responseFields(sourceOperation.responses, catalogs[bindings[sourceStep.server] ?? sourceStep.server]?.spec) : [];
  const sourceIsLater = from > targetIndex;
  const ready = source === "request" ? pointer !== null : responseArea === "body" ? pointer !== null : Boolean(header.trim());
  const apply = () => {
    if (from < 0 || !variable.trim() || !ready) return;
    try {
      onChange(connectValue(scenario, from, targetIndex, source, source === "request" ? requestArea : responseArea, pointer ?? undefined, header.trim() || undefined, variable.trim(), target.area, target.name, prefix));
      onClose();
    } catch (value) {
      setError(value instanceof Error ? value.message : "값 연결을 적용하지 못했습니다.");
    }
  };
  return <section className="api-scenario-value-link" aria-label="시나리오 값 연결">
    <header><strong>{target.name || "요청 본문"}에 시나리오 값 사용</strong><button type="button" onClick={onClose}>닫기</button></header>
    {!sourceSteps.length ? <p>연결할 다른 단계가 없습니다.</p> : <>
      <p className="api-field-menu-help">현재 시나리오의 모든 단계에서 요청값 또는 응답값을 선택합니다. 출처가 뒤 단계면 저장 검사에서 순서 오류로 안내합니다.</p>
      <label>값 출처<select value={source} onChange={event => { setSource(event.target.value as ValueBinding["source"]); setPointer(null); setHeader(""); }}><option value="request">요청값</option><option value="response">응답값</option></select></label>
      <label>출처 단계<select value={from} onChange={event => { setFrom(Number(event.target.value)); setPointer(null); setHeader(""); }}>{sourceSteps.map(({ step, index }) => <option key={step.id} value={index}>{index + 1}. {step.name || findOperation(scenario, index, catalogs, bindings)?.summary || step.id}</option>)}</select></label>
      {sourceIsLater && <p className="api-field-menu-help">현재 단계보다 뒤의 출처입니다. 실행 전에 단계 순서를 바꾸거나 검사에서 순서 오류를 해결해야 합니다.</p>}
      {source === "request" && <>
        <label>요청 영역<select value={requestArea} onChange={event => { setRequestArea(event.target.value as RequestArea); setPointer(null); }}>{(["pathParams", "query", "headers", "cookies", "body"] as const).map(area => <option key={area} value={area}>{area}</option>)}</select></label>
        {requestOptions.length ? <div className="api-scenario-value-options" data-scroll="light">{requestOptions.map((option, index) => <button type="button" key={`${option.pointer}:${index}`} className={pointer === option.pointer ? "selected" : ""} onClick={() => setPointer(option.pointer)}><code>{requestArea} · {option.pointer || "전체 값"}</code><small>{option.type}</small></button>)}</div> : <p className="api-field-menu-help">저장된 요청값이 없습니다. 먼저 요청 입력을 설정하세요.</p>}
        <label>요청 JSON Pointer<input value={pointer ?? ""} onChange={event => setPointer(event.target.value)} placeholder="/id 또는 /data/id" /></label>
      </>}
      {source === "response" && <>
        <label>응답 영역<select value={responseArea} onChange={event => { setResponseArea(event.target.value as "body" | "header"); setPointer(null); setHeader(""); }}><option value="body">본문</option><option value="header">헤더</option></select></label>
        {responseArea === "body" ? <>
          {responseOptions.length ? <div className="api-scenario-value-options" data-scroll="light">{responseOptions.map((option, index) => <button type="button" key={`${option.status}:${option.pointer}:${index}`} className={pointer === option.pointer ? "selected" : ""} onClick={() => setPointer(option.pointer)}><code>{option.status} · {option.pointer || "전체 응답"}</code><small>{option.type}</small></button>)}</div> : <p className="api-field-menu-help">선택 가능한 응답 구조가 없습니다. JSON Pointer를 직접 입력하세요.</p>}
          <label>응답 JSON Pointer<input value={pointer ?? ""} onChange={event => setPointer(event.target.value)} placeholder="/data/id" /></label>
        </> : <label>응답 헤더 이름<input value={header} onChange={event => setHeader(event.target.value)} placeholder="X-Request-Id" /></label>}
      </>}
      <label>저장할 시나리오 변수<input value={variable} onChange={event => setVariable(event.target.value)} placeholder="itemId" /></label>
      <label>문자열 접두사 · 선택<input value={prefix} onChange={event => setPrefix(event.target.value)} placeholder="Bearer  " /></label>
      <button type="button" className="api-primary" disabled={!ready || from < 0 || !variable.trim()} onClick={apply}>현재 요청값에 연결</button>
    </>}
    {error && <p role="alert" className="api-field-menu-error">{error}</p>}
  </section>;
}
