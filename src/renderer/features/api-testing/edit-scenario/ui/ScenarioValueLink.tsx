import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Json, Scenario, ValueBinding } from "../../../../../app/api-testing/shared/scenario";
import type { ApiCatalog, ApiOperation } from "../../../../../app/api-testing/shared/workspace";
import { connectValue, type RequestArea } from "../model/scenario-builder-model";
import { responseFields } from "../../../../entities/api-testing";

type RequestValueOption = { pointer: string; type: string };
// `expect` set: the picked value becomes that check's expected value instead of a request field.
export type ScenarioValueTarget = { area: RequestArea; name: string; expect?: number };

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
      if (current.length) visit(current[0], `${pointer}/0`, depth + 1);
      return;
    }
    const entries = Object.entries(current);
    result.push({ pointer, type: "object" });
    entries.forEach(([key, item]) => visit(item, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, depth + 1));
  };
  visit(value as Json, "", 0);
  return result;
}

function pointerLabel(pointer: string): string {
  return pointer || "전체 값";
}

function pointerSegments(pointer: string): string[] {
  return pointer.split("/").filter(Boolean).map(segment => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function jsonTreeKey(pointer: string, rootLabel: string): string {
  const segment = pointerSegments(pointer).pop();
  if (!segment) return rootLabel;
  return /^\d+$/.test(segment) ? `[${segment}]` : JSON.stringify(segment);
}

function isJsonContainer(type: string): boolean {
  return type === "object" || type === "array";
}

function JsonValueTree({ options, selected, onSelect, area, rootLabel }: {
  options: Array<{ pointer: string; type: string; status?: string }>;
  selected: string | null;
  onSelect: (pointer: string) => void;
  area: string;
  rootLabel?: string;
}) {
  const statuses = [...new Set(options.map(option => option.status))];
  return <div className="api-value-json-picker" aria-label={`${area} JSON 값 선택`}>
    {options.some(option => option.type === "array") && <small>배열은 예시 원소 하나를 표시하며, 내부 필드는 첫 번째 항목을 사용합니다.</small>}
    {statuses.map(status => {
      const fields = options.filter(option => option.status === status);
      const render = (option: typeof fields[number], depth: number, last: boolean, arrayItem = false): ReactNode => {
        const children = fields.filter(child => child.pointer !== option.pointer && child.pointer.slice(0, child.pointer.lastIndexOf("/")) === option.pointer);
        const container = isJsonContainer(option.type);
        const token = option.type === "array" ? "[" : option.type === "object" ? "{" : option.type === "string" ? '"string"' : option.type === "boolean" ? "false" : ["integer", "number"].includes(option.type) ? "0" : "null";
        return <div key={option.pointer}>
          <div style={{ paddingLeft: depth * 16 }} className="api-value-json-line">
            <button type="button" className="api-json-token api-json-key-token" aria-label={`${option.pointer || "전체 값"} ${option.type} 값 선택`} aria-pressed={selected === option.pointer} title={option.pointer || "전체 값"} onClick={() => onSelect(option.pointer)}>{!option.pointer || arrayItem ? token : jsonTreeKey(option.pointer, rootLabel ?? area)}</button>
            {option.pointer && !arrayItem && <code>: <span className={`api-json-type-${option.type}`}>{token}</span></code>}
            {!container && !last && <code>,</code>}
          </div>
          {container && <>{children.map((child, index) => render(child, depth + 1, index === children.length - 1, option.type === "array"))}<div style={{ paddingLeft: depth * 16 }}><code>{option.type === "array" ? "]" : "}"}{!last && ","}</code></div></>}
        </div>;
      };
      const root = fields.find(option => option.pointer === "");
      const body = <div className="api-json-code">{root && render(root, 0, true)}</div>;
      // Values usually come from a success response: error bodies stay folded unless there is no 2xx.
      const success = !status || /^2/.test(status) || !statuses.some(other => other && /^2/.test(other));
      return success
        ? <section key={status ?? area}>{status && <small>HTTP {status}</small>}{body}</section>
        : <details key={status} className="api-value-json-other"><summary>HTTP {status} 응답</summary>{body}</details>;
    })}
  </div>;
}

function sourceStepLabel(scenario: Scenario, index: number, catalogs: Record<string, ApiCatalog | null>, bindings: Record<string, string>): string {
  const step = scenario.steps[index];
  return `${index + 1}. ${step.name || findOperation(scenario, index, catalogs, bindings)?.summary || step.id}`;
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
  const sourceSteps = scenario.steps.map((step, index) => ({ step, index }));
  const previousSourceSteps = sourceSteps.filter(item => item.index < targetIndex);
  const initialSource = previousSourceSteps.at(-1)?.index ?? -1;
  const [source, setSource] = useState<ValueBinding["source"]>(target.expect !== undefined ? "request" : "response");
  const [from, setFrom] = useState(initialSource);
  const [requestArea, setRequestArea] = useState<RequestArea>(target.area);
  const [responseArea, setResponseArea] = useState<"body" | "header">("body");
  const [pointer, setPointer] = useState<string | null>(null);
  const [header, setHeader] = useState("");
  const [variable, setVariable] = useState("");
  const [prefix, setPrefix] = useState("");
  const [error, setError] = useState("");
  const sourceStep = from >= 0 && from < targetIndex ? scenario.steps[from] : undefined;
  const sourceOperation = sourceStep ? findOperation(scenario, from, catalogs, bindings) : undefined;
  const sourceSpec = sourceStep ? catalogs[bindings[sourceStep.server] ?? sourceStep.server]?.spec : undefined;
  const requestOptions = source === "request" && sourceStep ? requestValueFields(sourceStep.request, requestArea) : [];
  const responseOptions = source === "response" && responseArea === "body" && sourceOperation ? responseFields(sourceOperation.responses, sourceSpec) : [];
  const ready = source === "request" ? pointer !== null : responseArea === "body" ? pointer !== null : Boolean(header.trim());

  const resetSelection = () => { setPointer(null); setHeader(""); setError(""); };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (from === initialSource || (from >= 0 && from < targetIndex)) return;
    setFrom(initialSource);
    resetSelection();
  }, [from, initialSource, targetIndex]);
  const apply = () => {
    if (from < 0 || !ready) return;
    try {
      onChange(connectValue(scenario, from, targetIndex, source, source === "request" ? requestArea : responseArea, pointer ?? undefined, header.trim() || undefined, variable.trim(), target.area, target.name, prefix, target.expect));
      onClose();
    } catch (value) {
      setError(value instanceof Error ? value.message : "값 연결을 적용하지 못했습니다.");
    }
  };

  return <div className="api-value-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="api-value-modal api-scenario-value-modal" role="dialog" aria-modal="true" aria-label={`${target.name} 값 연결`} onMouseDown={event => event.stopPropagation()}>
      <header>
        <div><p className="api-value-modal-kicker">값 연결</p><h2>{target.name} 값 연결</h2><small>{targetIndex + 1}단계 · {target.expect !== undefined ? "검증 기대값" : `${target.area} · 요청값`}</small></div>
        <button type="button" aria-label="값 연결 닫기" onClick={onClose}>×</button>
      </header>

      <div className="api-value-target"><span>사용할 곳</span><code>{targetIndex + 1}단계 · {target.expect !== undefined ? `검증 ${target.name} 기대값` : `${target.area}.${target.name}`}</code></div>
      {!previousSourceSteps.length ? <>
        <p className="api-value-modal-note">이 단계는 첫 단계라 앞에서 가져올 수 있는 요청값·응답값이 없습니다. 현재 단계와 뒤 단계의 값은 실행 순서상 연결할 수 없습니다.</p>
        <label>출처 단계<select aria-label="값 출처 단계" value={from} disabled title="현재 단계보다 앞선 단계가 없어 값을 연결할 수 없습니다.">
          <option value={-1}>선택 가능한 이전 단계 없음</option>
          {sourceSteps.map(({ step, index }) => <option key={step.id} value={index} disabled>{sourceStepLabel(scenario, index, catalogs, bindings)} · {index === targetIndex ? "현재 단계" : "뒤 단계"}</option>)}
        </select></label>
        <p className="api-value-order-warning" role="note">현재 단계보다 앞선 단계만 값 출처로 선택할 수 있습니다.</p>
      </> : <>
        <p className="api-value-modal-note">다른 단계의 요청값 또는 응답값을 선택해 {target.expect !== undefined ? "이 검증의 기대값으로 씁니다" : "이 입력값에 연결합니다"}. 실행 순서는 시나리오 검사에서 확인합니다.</p>
        <div className="api-value-source-tabs" role="tablist" aria-label="값 출처 선택">
          <button type="button" role="tab" aria-selected={source === "response"} className={source === "response" ? "selected" : ""} onClick={() => { setSource("response"); resetSelection(); }}>응답값</button>
          <button type="button" role="tab" aria-selected={source === "request"} className={source === "request" ? "selected" : ""} onClick={() => { setSource("request"); resetSelection(); }}>요청값</button>
        </div>
        <label>출처 단계<select aria-label="값 출처 단계" aria-describedby="api-value-order-help" value={from} onChange={event => { setFrom(Number(event.target.value)); resetSelection(); }} title="현재 단계보다 앞선 단계만 선택할 수 있습니다.">{sourceSteps.map(({ step, index }) => <option key={step.id} value={index} disabled={index >= targetIndex}>{sourceStepLabel(scenario, index, catalogs, bindings)}{index === targetIndex ? " · 현재 단계" : index > targetIndex ? " · 뒤 단계" : ""}</option>)}</select>{sourceSteps.some(item => item.index >= targetIndex) && <small id="api-value-order-help" className="api-value-order-help">현재 단계와 뒤 단계는 실행 순서상 고를 수 없습니다.</small>}</label>

        {source === "request" && <section className="api-value-source-section" aria-label="요청값 출처 설정">
          <label>요청 영역<select aria-label="요청 출처 영역" value={requestArea} onChange={event => { setRequestArea(event.target.value as RequestArea); resetSelection(); }}>{(["pathParams", "query", "headers", "cookies", "body"] as const).map(area => <option key={area} value={area}>{area}</option>)}</select></label>
          {requestOptions.length ? <JsonValueTree options={requestOptions} selected={pointer} onSelect={setPointer} area={requestArea} /> : <p className="api-field-menu-help">저장된 요청값이 없습니다. 출처 단계의 요청 입력을 먼저 설정하세요.</p>}
        </section>}

        {source === "response" && <section className="api-value-source-section" aria-label="응답값 출처 설정">
          <label>응답 영역<select aria-label="응답 출처 영역" value={responseArea} onChange={event => { setResponseArea(event.target.value as "body" | "header"); resetSelection(); }}><option value="body">본문 JSON</option><option value="header">응답 헤더</option></select></label>
          {responseArea === "body" ? responseOptions.length ? <JsonValueTree options={responseOptions} selected={pointer} onSelect={setPointer} area="응답" /> : <p className="api-field-menu-help">선택 가능한 응답 구조가 없습니다. 고급 설정에서 JSON Pointer를 직접 입력할 수 있습니다.</p> : <label>응답 헤더 이름<input value={header} onChange={event => setHeader(event.target.value)} placeholder="X-Request-Id" /></label>}
        </section>}

        <details className="api-value-advanced"><summary>고급 설정 · 연결 이름·JSON Pointer</summary>
          <label>연결 이름 (선택)<input value={variable} onChange={event => setVariable(event.target.value)} placeholder="단계와 값 출처를 기준으로 자동 생성" /></label>
          <label>문자열 접두사 · 선택<input value={prefix} onChange={event => setPrefix(event.target.value)} placeholder="Bearer  " /></label>
          {source === "request" && <label>요청 JSON Pointer<input value={pointer ?? ""} onChange={event => setPointer(event.target.value)} placeholder="/id 또는 /data/id" /></label>}
          {source === "response" && responseArea === "body" && <label>응답 JSON Pointer<input value={pointer ?? ""} onChange={event => setPointer(event.target.value)} placeholder="/data/id" /></label>}
        </details>
      </>}
      {error && <p role="alert" className="api-field-menu-error">{error}</p>}
      {/* Stays in view while the JSON above scrolls: what is picked, and the button to use it. */}
      <footer className="api-value-link-footer">{ready && <span className="api-value-selection-summary"><span>선택</span><code>{sourceStepLabel(scenario, from, catalogs, bindings)} · {source === "response" ? responseArea === "header" ? `헤더 ${header}` : `응답 ${pointerLabel(pointer ?? "")}` : `요청 ${requestArea} ${pointerLabel(pointer ?? "")}`}</code></span>}<button type="button" onClick={onClose}>{previousSourceSteps.length > 0 ? "취소" : "닫기"}</button>{previousSourceSteps.length > 0 && <button type="button" className="api-primary" disabled={!ready || from < 0} onClick={apply}>이 값으로 연결</button>}</footer>
    </section>
  </div>;
}
