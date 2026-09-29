import { GlobalVariableSetupLink } from "../../../../entities/api-testing";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { scenarioStepInputs, type Scenario, type Json, type ScenarioInput } from "../../../../../app/api-testing/shared/scenario";
import type { ApiCatalog, ApiOperation, ApiScope, ApiTestingBridge, ApiGlobal } from "../../../../../app/api-testing/shared/workspace";
import { type RequestArea } from "../model/scenario-builder-model";
import { objectValue } from "../../../../entities/api-testing";
import { responseGlobalNameSuggestions } from "../lib/response-global-name";
import { ScenarioValueLink } from "./ScenarioValueLink";
import { isSensitiveKey } from "../../../../../app/api-testing/shared/sensitive";
import { DraftInput, DraftTextarea } from "../../../../shared/ui/DraftFields";
import { type RequestField, type VerificationOperator, type FieldState, suggestedInputName, inputTypeForField, isStructuredRequestField, requestFieldValueMatches, templateVariable, variableReferenceInValue, fieldState, jsonText, requestToken, verificationOperatorLabels, verificationSourceLabels, parseExpectedValue, expectedValueText } from "../model/step-request-model";
import { type ResponseBadge } from "../model/step-response-model";
import { ResponseGlobalNameField, ResponsePicker } from "./StepResponseViews";
import { RequestBodyEditor, ValueActionModal, ScenarioInputSettingsModal } from "./StepValueModals";

export function findStepOperation(scenario: Scenario, index: number, catalogs: Record<string, ApiCatalog | null>, bindings: Record<string, string>) {
  const step = scenario.steps[index];
  return catalogs[bindings[step.server] ?? step.server]?.operations.find(op => "operationId" in step.api ? op.operationId === step.api.operationId : op.path === step.api.path && op.method.toUpperCase() === step.api.method);
}

export function SimpleStep({ scenario, index, catalogs, bindings, scope, bridge, onChange, globalRevision, onConfigureGlobal, catalogLoading = false }: {
  globalRevision: number; onConfigureGlobal: (name: string) => void; catalogLoading?: boolean;
  scenario: Scenario; index: number; catalogs: Record<string, ApiCatalog | null>; bindings: Record<string, string>;
  scope: ApiScope; bridge: ApiTestingBridge; onChange: (next: Scenario) => void;
}) {
  const step = scenario.steps[index];
  const operation = findStepOperation(scenario, index, catalogs, bindings);
  const requestKey = JSON.stringify([bindings[step.server] ?? step.server, step.api]);
  const lastRequestOperation = useRef<{ key: string; operation: ApiOperation } | null>(null);
  const requestOperation = operation ?? (lastRequestOperation.current?.key === requestKey ? lastRequestOperation.current.operation : undefined);
  useEffect(() => {
    // Keep partially typed JSON mounted when the current environment has no catalog.
    lastRequestOperation.current = operation ? { key: requestKey, operation } : lastRequestOperation.current?.key === requestKey ? lastRequestOperation.current : null;
  }, [operation, requestKey]);
  const [target, setTarget] = useState<{ area: RequestArea; name: string } | null>(null);
  const [valueMenu, setValueMenu] = useState<string | null>(null);
  const [inputTarget, setInputTarget] = useState<string | null>(null);
  const [responsePointer, setResponsePointer] = useState<string | null>(null);
  const [action, setAction] = useState<"verify" | "global" | null>(null);
  const [verificationPointer, setVerificationPointer] = useState<string | null>(null);
  const [verificationOperator, setVerificationOperator] = useState<VerificationOperator>("exists");
  const [verificationValue, setVerificationValue] = useState("");
  const [globalName, setGlobalName] = useState("");
  const [error, setError] = useState("");
  const [globals, setGlobals] = useState<ApiGlobal[]>([]);
  const [globalsLoaded, setGlobalsLoaded] = useState(false);
  // A just-added check opens with its value field focused (no silent default like 200).
  const [newExpectation, setNewExpectation] = useState<number | null>(null);
  const responseNameSuggestions = responseGlobalNameSuggestions(operation, responsePointer);
  const existingGlobalExtraction = (pointer: string | null) => pointer === null ? undefined : step.extract.find(extract => extract.source === "body" && (extract.pointer ?? "") === pointer && extract.target.startsWith("globals."));
  const responseBadges = (pointer: string): ResponseBadge[] => {
    const badges: ResponseBadge[] = [];
    const globalExtracts = step.extract.filter(extract => extract.source === "body" && (extract.pointer ?? "") === pointer && extract.target.startsWith("globals."));
    const otherExtracts = step.extract.filter(extract => extract.source === "body" && (extract.pointer ?? "") === pointer && !extract.target.startsWith("globals."));
    const expectations = (step.expect ?? []).filter(expectation => expectation.source === "body" && (expectation.pointer ?? "") === pointer);
    const links = scenario.valueBindings.filter(binding => binding.step === step.id && binding.source === "response" && binding.area === "body" && (binding.pointer ?? "") === pointer);
    globalExtracts.forEach(extract => badges.push({ label: `전역변수 저장 → ${extract.target.slice("globals.".length)}`, tone: "global", title: extract.target }));
    if (otherExtracts.length) badges.push({ label: "값 저장", tone: "save", title: otherExtracts.map(extract => extract.target).join(", ") });
    if (links.length) badges.push({ label: "요청값 연결", tone: "link", title: links.map(link => link.name).join(", ") });
    if (expectations.length) badges.push({ label: "검증", tone: "verify", title: expectations.map(expectation => expectation.operator).join(", ") });
    return badges;
  };
  useEffect(() => {
    let live = true;
    void bridge.listGlobals({ projectId: scope.projectId }).then(v => { if (live) { setGlobals(v); setGlobalsLoaded(true); } }).catch(() => {});
    return () => { live = false; };
  }, [bridge, globalRevision, scope.environmentId, scope.projectId]);
  const availableGlobalNames = [...new Set([
    ...globals.map(global => global.name),
    ...scenario.steps.flatMap(previous => previous.extract
      .filter(extract => extract.target.startsWith("globals."))
      .map(extract => extract.target.slice("globals.".length))),
  ])].sort((a, b) => a.localeCompare(b));
  const configuredGlobalNames = new Set([
    ...globals.filter(global => global.displayValue !== "" && global.displayValue !== "null").map(global => global.name),
    ...scenario.steps.slice(0, index).flatMap(previous => previous.extract.filter(extract => extract.target.startsWith("globals.")).map(extract => extract.target.slice("globals.".length))),
  ]);
  const missingGlobal = (state: FieldState | undefined) => Boolean(state?.kind === "global" && state.detail && globalsLoaded && !configuredGlobalNames.has(state.detail));
  const update = (patch: Partial<typeof step>, scenarioPatch: Partial<Scenario> = {}) => onChange({ ...scenario, ...scenarioPatch, steps: scenario.steps.map((s, i) => i === index ? { ...s, ...patch } : s) });
  const runtimeInputs = scenarioStepInputs(step);
  const updateInputs = (next: ScenarioInput[]) => update({ input: undefined, inputs: next.length ? next : undefined });
  const updateInput = (name: string, patch: Partial<ScenarioInput>) => {
    updateInputs(runtimeInputs.map(input => input.name === name ? { ...input, ...patch } : input));
  };
  const existingVerificationIndex = (pointer: string | null) => pointer === null ? -1 : (step.expect ?? []).findIndex(expectation => expectation.source === "body" && (expectation.pointer ?? "") === pointer);
  const updateExpectations = (next: NonNullable<typeof step.expect>) => update({ expect: next.length ? next : undefined });
  const openResponseAction = (next: "verify" | "global") => {
    setAction(next);
    setVerificationPointer(responsePointer);
    const existing = (step.expect ?? [])[existingVerificationIndex(responsePointer)];
    setVerificationOperator(existing?.operator ?? "exists");
    setVerificationValue(existing ? expectedValueText(existing.value) : "");
    if (next === "global") setGlobalName(current => current || existingGlobalExtraction(responsePointer)?.target.slice("globals.".length) || responseNameSuggestions[0]?.name || "response");
    setError("");
  };
  const closeResponseModal = () => {
    setResponsePointer(null);
    setAction(null);
    setVerificationPointer(null);
    setGlobalName("");
    setError("");
  };
  useEffect(() => {
    if (responsePointer === null) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeResponseModal(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [responsePointer]);
  const fields: RequestField[] = (requestOperation?.parameters ?? []).filter(p => ["path", "query", "header", "cookie"].includes(p.location)).map(p => ({ name: p.name, area: (p.location === "path" ? "pathParams" : p.location === "header" ? "headers" : p.location === "cookie" ? "cookies" : "query") as RequestArea, type: p.type, required: p.required, description: p.description, example: p.example }));
  const body = objectValue(requestOperation?.bodySchema);
  for (const [name, schema] of Object.entries(objectValue(body.properties))) fields.push({ name, area: "body", type: objectValue(schema).type ?? "string", required: requestOperation?.bodyRequired === true && (body.required ?? []).includes(name), description: typeof objectValue(schema).description === "string" ? objectValue(schema).description : undefined, example: objectValue(schema).example ?? objectValue(schema).default });
  const requestWithValue = (area: RequestArea, name: string, value: Json | undefined) => {
    const previous = step.request[area];
    if (previous !== undefined && (!previous || typeof previous !== "object" || Array.isArray(previous))) return null;
    const next = { ...objectValue(previous) }; if (value === undefined) delete next[name]; else next[name] = value;
    return { ...step.request, [area]: next };
  };
  const setValue = (area: RequestArea, name: string, value: Json | undefined, clearInput = false) => {
    const request = requestWithValue(area, name, value);
    if (!request) { setError("요청 본문이 객체가 아니어서 필드별로 설정할 수 없습니다. 요청 본문 JSON 편집에서 수정하세요."); return; }
    const current = objectValue(step.request[area])[name];
    const boundInput = runtimeInputs.find(input => current === `{{vars.${input.name}}}`);
    const replacingUserInput = boundInput && value !== `{{vars.${boundInput.name}}}`;
    const removeInput = Boolean(boundInput && (clearInput || replacingUserInput));
    const nextInputs = boundInput ? runtimeInputs.filter(input => input.name !== boundInput.name) : runtimeInputs;
    const variable = templateVariable(current, "vars");
    const bindingInUseElsewhere = variable && scenario.steps.some((otherStep, otherIndex) => otherIndex !== index && variableReferenceInValue(otherStep.request, variable));
    const nextBindings = variable && !bindingInUseElsewhere ? scenario.valueBindings.filter(binding => binding.name !== variable) : scenario.valueBindings;
    update({ request, ...(removeInput ? { input: undefined, inputs: nextInputs.length ? nextInputs : undefined } : {}) }, { valueBindings: nextBindings });
  };
  /** Drops the whole body, with the runtime inputs and value links only it used (like removing each field). */
  const removeBody = () => {
    const request = { ...step.request, body: undefined };
    const orphaned = (name: string) => variableReferenceInValue(step.request.body, name) && !variableReferenceInValue(request, name);
    const nextInputs = runtimeInputs.filter(input => !orphaned(input.name));
    const nextBindings = scenario.valueBindings.filter(binding => !orphaned(binding.name) || scenario.steps.some((otherStep, otherIndex) => otherIndex !== index && variableReferenceInValue(otherStep.request, binding.name)));
    update({ request, input: undefined, inputs: nextInputs.length ? nextInputs : undefined }, { valueBindings: nextBindings });
  };
  const toggleUserInput = (field: RequestField) => {
    const current = objectValue(step.request[field.area])[field.name];
    const currentInput = runtimeInputs.find(input => current === `{{vars.${input.name}}}`);
    if (currentInput) {
      const request = requestWithValue(field.area, field.name, undefined);
      if (!request) { setError("요청 본문이 객체가 아니어서 필드별로 설정할 수 없습니다. 요청 본문 JSON 편집에서 수정하세요."); return; }
      const nextInputs = runtimeInputs.filter(input => input.name !== currentInput.name);
      update({ request, input: undefined, inputs: nextInputs.length ? nextInputs : undefined });
      setValueMenu(null);
      return;
    }
    const baseName = suggestedInputName(field, index);
    const usedNames = new Set(runtimeInputs.map(input => input.name));
    let name = baseName;
    let suffix = 2;
    while (usedNames.has(name)) name = `${baseName}_${suffix++}`;
    const request = requestWithValue(field.area, field.name, `{{vars.${name}}}`);
    if (!request) { setError("요청 본문이 객체가 아니어서 필드별로 설정할 수 없습니다. 요청 본문 JSON 편집에서 수정하세요."); return; }
    const currentVariable = templateVariable(current, "vars");
    const bindingInUseElsewhere = currentVariable && scenario.steps.some((otherStep, otherIndex) => otherIndex !== index && variableReferenceInValue(otherStep.request, currentVariable));
    const nextBindings = currentVariable && !bindingInUseElsewhere ? scenario.valueBindings.filter(binding => binding.name !== currentVariable) : scenario.valueBindings;
    const input: ScenarioInput = {
      name,
      label: `${field.name} 입력`,
      type: inputTypeForField(field.type),
      required: field.required,
      sensitive: isSensitiveKey(field.name),
    };
    update({
      request,
      input: undefined,
      inputs: [...runtimeInputs, input],
    }, { valueBindings: nextBindings });
    setError("");
    setValueMenu(null);
    setTarget(null);
  };
  const renderField = (field: typeof fields[number], compact = false, last = false) => {
    const current = objectValue(step.request[field.area])[field.name];
    const fieldKey = `${field.area}:${field.name}`;
    const fieldId = `scenario-${index}-${field.area}-${field.name.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    const userInput = runtimeInputs.find(input => current === `{{vars.${input.name}}}`);
    const hasUserInput = Boolean(userInput);
    const inputReference = userInput ? `{{vars.${userInput.name}}}` : "";
    const state = fieldState(scenario, index, field, current, userInput);
    const openValueMenu = () => { setValueMenu(valueMenu === fieldKey ? null : fieldKey); setTarget(null); setInputTarget(null); };
    const valueModal = valueMenu === fieldKey && <ValueActionModal index={index} field={field} current={current} state={state} globalNames={availableGlobalNames} hasUserInput={hasUserInput} scope={scope} bridge={bridge} onClose={() => setValueMenu(null)} onDirect={value => { setValue(field.area, field.name, value); setValueMenu(null); setTarget(null); setInputTarget(null); setError(""); }} onScenario={() => { setValueMenu(null); setInputTarget(null); setTarget(field); }} onGlobalCreated={(name, type) => { setGlobals(current => { const next = { name, type, displayValue: "***" }; const found = current.findIndex(global => global.name === name); return found < 0 ? [...current, next] : current.map((global, index) => index === found ? next : global); }); }} onGlobal={name => { setValue(field.area, field.name, `{{globals.${name}}}`); setValueMenu(null); setTarget(null); setInputTarget(null); }} onUserInput={() => { setValueMenu(null); setTarget(null); setInputTarget(fieldKey); if (!hasUserInput) toggleUserInput(field); }} />;
    const inputSettings = inputTarget === fieldKey && userInput && <ScenarioInputSettingsModal index={index} field={field} userInput={userInput} onChange={patch => updateInput(userInput.name, patch)} onRemove={() => {
      const request = requestWithValue(field.area, field.name, undefined);
      if (!request) { setError("요청 본문이 객체가 아니어서 필드별로 설정할 수 없습니다. 요청 본문 JSON 편집에서 수정하세요."); return; }
      const nextInputs = runtimeInputs.filter(input => input.name !== userInput.name);
      update({ request, input: undefined, inputs: nextInputs.length ? nextInputs : undefined });
      setInputTarget(null);
    }} onClose={() => setInputTarget(null)} />;
    const scenarioLink = target?.area === field.area && target.name === field.name && <ScenarioValueLink scenario={scenario} targetIndex={index} target={target} catalogs={catalogs} bindings={bindings} onChange={onChange} onClose={() => setTarget(null)} />;
    // Shorten only exact, resolved references; keep the original value for editing and execution.
    const linkedValue = typeof current === "string" && scenario.valueBindings.some(binding => current === `{{vars.${binding.name}}}`);
    if (compact) return <span key={fieldKey} data-summary-field={fieldKey} className="api-json-line api-json-request-line">
      <span className="api-json-request-key-group"><button type="button" className="api-json-token api-json-request-key-token" aria-label={`${index + 1}단계 ${field.name} 키 값 연결`} title={`${field.name} · ${field.type} · 값 연결`} aria-pressed={valueMenu === fieldKey} onClick={openValueMenu}>{JSON.stringify(field.name)}</button>{missingGlobal(state) && <GlobalVariableSetupLink onConfigure={onConfigureGlobal} name={state!.detail!} />}{state && <span className={`api-field-state api-field-state-${state.kind}`} title={state.detail}><strong>{state.label}</strong>{state.detail && (state.kind === "global" || state.detail !== field.name) && <code>{state.detail}</code>}</span>}</span><code>: <span className="api-json-value-token">{linkedValue ? <button type="button" className="api-json-token" onClick={openValueMenu} aria-label={`${field.name} 연결값 설정`}>실행 시 연결값 사용</button> : requestToken(current, field)}</span></code>{!last && ","}
      {valueModal}{inputSettings}{scenarioLink}
    </span>;
    const structured = isStructuredRequestField(field);
    const placeholder = field.area === "cookies" && current === undefined
      ? "실행 시 자동 사용 · 필요 시 직접 입력"
      : field.example !== undefined
        ? structured ? jsonText(field.example) : String(field.example)
        : field.type === "object" ? '{\n  "key": "value"\n}'
          : field.type === "array" ? '[\n  "value"\n]'
            : "값 입력";
    const onInputChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const text = event.target.value;
      const clearInput = hasUserInput && text !== inputReference;
      if (!text.trim()) { event.target.setCustomValidity(""); setValue(field.area, field.name, undefined, clearInput); return; }
      try {
        const exactTemplate = /^\{\{(?:inputs|vars|globals)\.[A-Za-z][A-Za-z0-9_]*\}\}$/.test(text.trim());
        const supportedTypedField = ["number", "integer", "boolean", "object", "array"].includes(field.type);
        const value = exactTemplate || field.type === "string" || !supportedTypedField ? text : JSON.parse(text) as Json;
        if (!exactTemplate && supportedTypedField && !requestFieldValueMatches(value as Json, field.type)) throw new Error();
        event.target.setCustomValidity(""); setValue(field.area, field.name, value as Json, clearInput);
      } catch { event.target.setCustomValidity("필드 타입에 맞는 JSON 값을 입력하세요."); }
    };
    const input = structured
      ? <DraftTextarea id={fieldId} aria-label={`${index + 1}단계 ${field.name} JSON`} data-value-visibility={isSensitiveKey(field.name) ? "sensitive" : undefined} rows={4} spellCheck={false} placeholder={placeholder} value={typeof current === "string" ? current : jsonText(current)} onChange={onInputChange} />
      : <DraftInput id={fieldId} aria-label={`${index + 1}단계 ${field.name}`} data-value-visibility={isSensitiveKey(field.name) ? "sensitive" : undefined} placeholder={placeholder} value={typeof current === "object" ? JSON.stringify(current) : current ?? ""} onChange={onInputChange} />;
    return <div key={fieldKey} data-summary-field={fieldKey} className={compact ? "api-json-field-row" : "api-request-field"}>
      <label className="api-request-field-label" htmlFor={fieldId}><span>{field.name}{field.required && field.area !== "cookies" ? " *" : ""} <small>{field.area} · {field.type}{field.area === "cookies" ? " · 자동 쿠키" : ""}</small></span>
        {field.description && <small className="api-request-field-description">{field.description}</small>}
      </label>
      <div className="api-request-field-control">
        <div className="api-field-input-wrap">
          {input}
          {missingGlobal(state) && <GlobalVariableSetupLink onConfigure={onConfigureGlobal} name={state!.detail!} />}{state && <span className={`api-field-state api-field-state-${state.kind}`} title={state.detail}><strong>{state.label}</strong>{state.detail && <code>{state.detail}</code>}</span>}
        </div>
        <div className="api-field-actions"><button type="button" className="api-field-value-trigger" aria-expanded={valueMenu === fieldKey} onClick={openValueMenu}>값 연결</button></div>
      </div>
      {valueModal}{inputSettings}{scenarioLink}
    </div>;
  };
  const hasRequestBody = Boolean(requestOperation && (requestOperation.bodySchema !== undefined || requestOperation.bodyExample !== undefined || requestOperation.bodyRequired));
  const spec = catalogs[bindings[step.server] ?? step.server]?.spec;
  return <div className="api-simple-step">
    <header className="api-simple-section-heading"><h3>요청</h3></header>
    {!operation && (catalogLoading ? <p role="status">명세를 불러오는 중…</p> : <p className="api-warning">현재 API 명세에서 이 API를 찾을 수 없습니다. 경로가 바뀌었다면 위의 <strong>API 바꾸기</strong>로 새 API를 연결하세요. 요청값은 그대로 유지됩니다.{requestOperation && " 요청 필드는 마지막으로 확인한 명세 기준입니다."}</p>)}
    {requestOperation && <>
      {fields.filter(field => field.area !== "body").length > 0 ? <div className="api-request-fields">{fields.filter(field => field.area !== "body").map(field => renderField(field))}</div> : !hasRequestBody && <p>입력 가능한 요청 파라미터가 없습니다.</p>}
      {hasRequestBody && <RequestBodyEditor operation={requestOperation} step={step} update={update} bodyFields={fields.filter(field => field.area === "body")} renderField={renderField} />}
    </>}
    {operation && (() => {
      // Values this API's spec does not define: left over from "API 바꾸기", a spec change, or AI/YAML edits.
      const known = new Set(fields.map(field => `${field.area}:${field.name}`));
      const bodyIsObject = step.request.body !== undefined && step.request.body !== null && typeof step.request.body === "object" && !Array.isArray(step.request.body);
      const extra = (["pathParams", "query", "headers", "cookies", ...(bodyIsObject && fields.some(field => field.area === "body") ? ["body"] : [])] as RequestArea[])
        .flatMap(area => Object.keys(objectValue(step.request[area])).filter(name => !known.has(`${area}:${name}`) && !(area === "headers" && name.toLowerCase() === "authorization")).map(name => ({ area, name })));
      // A body the new API does not take at all has no editor, so it is listed as a whole.
      const staleBody = !hasRequestBody && step.request.body !== undefined;
      const count = extra.length + (staleBody ? 1 : 0);
      if (!count) return null;
      return <div className="api-warning api-extra-fields" role="status"><strong>이 API 명세에 없는 요청값 {count}개</strong><ul>
        {staleBody && <li><code>body (요청 본문 전체)</code><button type="button" className="api-compose-link" onClick={removeBody}>제거</button></li>}
        {extra.map(item => <li key={`${item.area}:${item.name}`}><code>{item.area}.{item.name}</code><button type="button" className="api-compose-link" onClick={() => setValue(item.area, item.name, undefined)}>제거</button></li>)}
      </ul></div>;
    })()}
    <header className="api-simple-section-heading"><h3>응답</h3></header>
    <ResponsePicker operation={operation} spec={spec} actionLabel="설정" selectedPointer={responsePointer} showPreview={false} badges={responseBadges} onSelect={pointer => { setResponsePointer(pointer); setAction(null); setVerificationPointer(pointer); setGlobalName(existingGlobalExtraction(pointer)?.target.slice("globals.".length) || responseGlobalNameSuggestions(operation, pointer)[0]?.name || "response"); setError(""); }} />
    {responsePointer !== null && <div className="api-value-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeResponseModal(); }}>
      <section className="api-value-modal api-response-action-modal" role="dialog" aria-modal="true" aria-label="응답값 사용 설정" onMouseDown={event => event.stopPropagation()}>
        <header>
          <div><p className="api-value-modal-kicker">응답값 사용</p><h2>{responsePointer || "전체 응답"}</h2><small>{index + 1}단계 · 응답 JSON</small></div>
          <button type="button" aria-label="응답값 설정 닫기" onClick={closeResponseModal}>×</button>
        </header>
        <div className="api-value-selection-summary"><span>선택한 응답 항목</span><code>{responsePointer || "전체 응답"}</code></div>
        <p className="api-value-modal-note">응답값의 검증 또는 전역변수 저장을 설정하세요. 다른 요청에서 사용하려면 해당 요청의 ‘값 연결’을 이용하세요.</p>
        <div className="api-response-action-options">
          <button type="button" className={action === "verify" ? "api-value-modal-option is-active" : "api-value-modal-option"} onClick={() => openResponseAction("verify")}><strong>이 값 검증</strong><small>실행 결과가 존재하거나 기대값과 일치하는지 확인</small></button>
          <button type="button" className={action === "global" ? "api-value-modal-option is-active" : "api-value-modal-option"} onClick={() => openResponseAction("global")}><strong>전역변수로 저장</strong><small>다른 시나리오나 요청에서 재사용할 값으로 저장</small></button>
        </div>
        {action === "global" && <section className="api-action-editor" aria-label="응답 전역변수 저장 설정">
          <ResponseGlobalNameField value={globalName} suggestions={responseNameSuggestions} onChange={setGlobalName} />
          <label className="api-response-global-existing">기존 전역변수 이름으로 업데이트
            <select aria-label="응답 전역변수 기존 변수 선택" value={globals.some(global => global.name === globalName) ? globalName : ""} disabled={!globalsLoaded || globals.length === 0} onChange={event => setGlobalName(event.target.value)}>
              <option value="">{!globalsLoaded ? "기존 전역변수를 불러오는 중…" : globals.length ? "선택 안 함 · 새 이름 사용" : "등록된 전역변수가 없습니다"}</option>
              {globals.map(global => <option key={global.name} value={global.name}>{global.name} · {global.type}</option>)}
            </select>
            <small>{globals.some(global => global.name === globalName) ? "선택한 기존 변수는 시나리오 실행 시 응답값으로 덮어씁니다." : "입력한 이름의 전역변수가 없으면 시나리오 실행 시 새로 추가됩니다."}</small>
          </label>
          {verificationPointer !== null && <button type="button" className="api-primary" onClick={() => {
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(globalName) || ["constructor", "prototype"].includes(globalName)) { setError("전역변수 이름은 영문으로 시작하는 영문·숫자·밑줄을 사용하세요."); return; }
            const previous = existingGlobalExtraction(verificationPointer);
            update({ extract: [...step.extract.filter(e => e !== previous && e.target !== `globals.${globalName}`), { source: "body", pointer: verificationPointer, target: `globals.${globalName}`, sensitive: isSensitiveKey(globalName) }] }); closeResponseModal();
          }}>저장 설정 적용</button>}
          {existingGlobalExtraction(verificationPointer) && <button type="button" className="api-danger-action" onClick={() => { const existing = existingGlobalExtraction(verificationPointer); if (existing) update({ extract: step.extract.filter(extract => extract !== existing) }); closeResponseModal(); }}>전역변수 저장 해제</button>}
        </section>}
        {action === "verify" && verificationPointer !== null && <section className="api-verification-form" aria-label="응답 검증 설정">
          <p><strong>선택한 응답 필드</strong> · <code>{verificationPointer || "전체 응답"}</code></p>
          <label>검증 방식<select aria-label="응답 검증 방식" value={verificationOperator} onChange={e => setVerificationOperator(e.target.value as VerificationOperator)}>{(Object.keys(verificationOperatorLabels) as VerificationOperator[]).map(operator => <option key={operator} value={operator}>{verificationOperatorLabels[operator]}</option>)}</select></label>
          {verificationOperator !== "exists" && <label>기대값<input aria-label="응답 검증 기대값" value={verificationValue} placeholder="예: success 또는 200" onChange={e => setVerificationValue(e.target.value)} /><small className="api-field-help">숫자·true/false·JSON은 그 형식으로 비교합니다. 문자열 "200"은 따옴표를 붙여 입력하세요.</small></label>}
          <div className="api-actions"><button type="button" className="api-primary" onClick={() => {
            if (verificationOperator !== "exists" && !verificationValue.trim()) { setError("검증할 기대값을 입력하세요."); return; }
            const expectation = verificationOperator === "exists" ? { source: "body" as const, pointer: verificationPointer, operator: verificationOperator } : { source: "body" as const, pointer: verificationPointer, operator: verificationOperator, value: parseExpectedValue(verificationValue) };
            const found = existingVerificationIndex(verificationPointer);
            const current = step.expect ?? [];
            updateExpectations(found < 0 ? [...current, expectation] : current.map((item, i) => i === found ? expectation : item)); closeResponseModal();
          }}>{existingVerificationIndex(verificationPointer) < 0 ? "검증 추가" : "검증 수정"}</button>{existingVerificationIndex(verificationPointer) >= 0 && <button type="button" className="api-danger-action" onClick={() => { const found = existingVerificationIndex(verificationPointer); updateExpectations((step.expect ?? []).filter((_, i) => i !== found)); closeResponseModal(); }}>검증 제거</button>}</div>
        </section>}
        {error && <p className="api-field-menu-error" role="alert">{error}</p>}
        <footer><button type="button" onClick={closeResponseModal}>닫기</button></footer>
      </section>
    </div>}
    <header className="api-simple-section-heading"><h3>검증</h3><button type="button" onClick={() => { setNewExpectation((step.expect ?? []).length); updateExpectations([...(step.expect ?? []), { source: "status", operator: "equals" }]); }}>+ HTTP 상태 검증</button></header>
    <p className="api-field-help">상태 검증이 없으면 2xx 응답이면 통과합니다. 201·404처럼 특정 코드를 기대할 때만 상태 검증을 추가하세요. 값 검증은 응답 항목의 ‘설정’에서 추가합니다.</p>
    {(step.expect ?? []).map((expectation, n) => {
      const change = (patch: Partial<typeof expectation>) => updateExpectations(step.expect!.map((v, i) => i === n ? { ...v, ...patch } : v));
      const target = expectation.source === "status" ? "" : ` ${expectation.pointer || expectation.header || "전체 응답"}`;
      return <details key={n} className="api-verification-item" open={newExpectation === n || undefined}><summary>검증 {n + 1} · {verificationSourceLabels[expectation.source]}{target} · {verificationOperatorLabels[expectation.operator]}{expectation.operator !== "exists" ? ` ${expectedValueText(expectation.value)}` : ""}</summary>
      <label>검증 대상<select value={expectation.source} onChange={e => { const source = e.target.value as typeof expectation.source; change(source === "status" ? { source, pointer: undefined, header: undefined, operator: "equals", value: expectation.value ?? 200 } : { source, pointer: source === "body" ? "" : undefined, header: source === "header" ? "content-type" : undefined }); }}>{(Object.keys(verificationSourceLabels) as (keyof typeof verificationSourceLabels)[]).map(source => <option key={source} value={source}>{verificationSourceLabels[source]}</option>)}</select></label>
      {expectation.source !== "status" && <label>{expectation.source === "body" ? "응답 경로 (JSON Pointer)" : "헤더 이름"}<input value={expectation.pointer ?? expectation.header ?? ""} onChange={e => change(expectation.source === "body" ? { pointer: e.target.value } : { header: e.target.value })} /></label>}
      <label>검증 방식<select value={expectation.operator} onChange={e => change({ operator: e.target.value as VerificationOperator })}>{(Object.keys(verificationOperatorLabels) as VerificationOperator[]).filter(operator => expectation.source !== "status" || operator !== "exists").map(operator => <option key={operator} value={operator}>{verificationOperatorLabels[operator]}</option>)}</select></label>
      {expectation.operator !== "exists" && <label>기대값<DraftInput autoFocus={newExpectation === n} required value={expectedValueText(expectation.value)} placeholder={expectation.source === "status" ? "예: 201 또는 404" : "예: success 또는 200"} onChange={e => change({ value: e.target.value === "" ? undefined : parseExpectedValue(e.target.value) })} /></label>}
      <button type="button" className="api-danger-action" onClick={() => updateExpectations(step.expect!.filter((_, i) => i !== n))}>검증 제거</button>
    </details>; })}
    {error && <p role="alert" className="api-warning">{error}</p>}
  </div>;
}
