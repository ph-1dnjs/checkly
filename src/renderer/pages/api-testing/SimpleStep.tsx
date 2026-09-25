import { useEffect, useState, type ChangeEvent } from "react";
import { scenarioStepInputs, type Scenario, type Json, type ScenarioInput } from "../../../app/api-testing/shared/scenario";
import type { ApiCatalog, ApiScope, ApiTestingBridge, ApiGlobal } from "../../../app/api-testing/shared/workspace";
import { type RequestArea } from "./scenario-builder-model";
import { objectValue } from "./response-fields";
import { responseGlobalNameSuggestions } from "./response-global-name";
import { ScenarioValueLink } from "./ScenarioValueLink";
import { GlobalVariableSetupLink, useGlobalVariableAccess } from "./global-variable-access";
import { isSensitiveKey } from "../../../app/api-testing/shared/sensitive";
import { DraftInput, DraftTextarea } from "./DraftFields";
import { type RequestField, type VerificationOperator, type FieldState, suggestedInputName, inputTypeForField, isStructuredRequestField, requestFieldValueMatches, templateVariable, variableReferenceInValue, fieldState, jsonText, requestToken } from "./step-request-model";
import { type ResponseBadge } from "./step-response-model";
import { ResponseGlobalNameField, ResponsePicker } from "./StepResponseViews";
import { RequestBodyEditor, ValueActionModal, ScenarioInputSettingsModal } from "./StepValueModals";

export function findStepOperation(scenario: Scenario, index: number, catalogs: Record<string, ApiCatalog | null>, bindings: Record<string, string>) {
  const step = scenario.steps[index];
  return catalogs[bindings[step.server] ?? step.server]?.operations.find(op => "operationId" in step.api ? op.operationId === step.api.operationId : op.path === step.api.path && op.method.toUpperCase() === step.api.method);
}

export function SimpleStep({ scenario, index, catalogs, bindings, scope, bridge, onChange }: {
  scenario: Scenario; index: number; catalogs: Record<string, ApiCatalog | null>; bindings: Record<string, string>;
  scope: ApiScope; bridge: ApiTestingBridge; onChange: (next: Scenario) => void;
}) {
  const step = scenario.steps[index];
  const operation = findStepOperation(scenario, index, catalogs, bindings);
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
  const globalAccess = useGlobalVariableAccess();
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
  }, [bridge, globalAccess.revision, scope.environmentId, scope.projectId]);
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
  const openResponseAction = (next: "verify" | "global") => {
    setAction(next);
    setVerificationPointer(responsePointer);
    setVerificationOperator("exists");
    setVerificationValue("");
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
  const fields: RequestField[] = (operation?.parameters ?? []).filter(p => ["path", "query", "header", "cookie"].includes(p.location)).map(p => ({ name: p.name, area: (p.location === "path" ? "pathParams" : p.location === "header" ? "headers" : p.location === "cookie" ? "cookies" : "query") as RequestArea, type: p.type, required: p.required, description: p.description, example: p.example }));
  const body = objectValue(operation?.bodySchema);
  for (const [name, schema] of Object.entries(objectValue(body.properties))) fields.push({ name, area: "body", type: objectValue(schema).type ?? "string", required: operation?.bodyRequired === true && (body.required ?? []).includes(name), description: typeof objectValue(schema).description === "string" ? objectValue(schema).description : undefined, example: objectValue(schema).example ?? objectValue(schema).default });
  const requestWithValue = (area: RequestArea, name: string, value: Json | undefined) => {
    const previous = step.request[area];
    if (previous !== undefined && (!previous || typeof previous !== "object" || Array.isArray(previous))) return null;
    const next = { ...objectValue(previous) }; if (value === undefined) delete next[name]; else next[name] = value;
    return { ...step.request, [area]: next };
  };
  const setValue = (area: RequestArea, name: string, value: Json | undefined, clearInput = false) => {
    const request = requestWithValue(area, name, value);
    if (!request) { setError("기존 본문을 유지하기 위해 고급 설정에서 편집하세요."); return; }
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
  const toggleUserInput = (field: RequestField) => {
    const current = objectValue(step.request[field.area])[field.name];
    const currentInput = runtimeInputs.find(input => current === `{{vars.${input.name}}}`);
    if (currentInput) {
      const request = requestWithValue(field.area, field.name, undefined);
      if (!request) { setError("기존 본문을 유지하기 위해 고급 설정에서 편집하세요."); return; }
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
    if (!request) { setError("기존 본문을 유지하기 위해 고급 설정에서 편집하세요."); return; }
    const currentVariable = templateVariable(current, "vars");
    const bindingInUseElsewhere = currentVariable && scenario.steps.some((otherStep, otherIndex) => otherIndex !== index && variableReferenceInValue(otherStep.request, currentVariable));
    const nextBindings = currentVariable && !bindingInUseElsewhere ? scenario.valueBindings.filter(binding => binding.name !== currentVariable) : scenario.valueBindings;
    const input: ScenarioInput = {
      name,
      label: `${field.name} 입력`,
      type: inputTypeForField(field.type),
      required: field.required,
      sensitive: /token|password|secret|code|인증|비밀번호/i.test(field.name),
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
      if (!request) { setError("기존 본문을 유지하기 위해 고급 설정에서 편집하세요."); return; }
      const nextInputs = runtimeInputs.filter(input => input.name !== userInput.name);
      update({ request, input: undefined, inputs: nextInputs.length ? nextInputs : undefined });
      setInputTarget(null);
    }} onClose={() => setInputTarget(null)} />;
    const scenarioLink = target?.area === field.area && target.name === field.name && <ScenarioValueLink scenario={scenario} targetIndex={index} target={target} catalogs={catalogs} bindings={bindings} onChange={onChange} onClose={() => setTarget(null)} />;
    // Shorten only exact, resolved references; keep the original value for editing and execution.
    const linkedValue = typeof current === "string" && scenario.valueBindings.some(binding => current === `{{vars.${binding.name}}}`);
    if (compact) return <span key={fieldKey} data-summary-field={fieldKey} className="api-json-line api-json-request-line">
      <span className="api-json-request-key-group"><button type="button" className="api-json-token api-json-request-key-token" aria-label={`${index + 1}단계 ${field.name} 키 값 연결`} title={`${field.name} · ${field.type} · 값 연결`} aria-pressed={valueMenu === fieldKey} onClick={openValueMenu}>{JSON.stringify(field.name)}</button>{missingGlobal(state) && <GlobalVariableSetupLink name={state!.detail!} />}{state && <span className={`api-field-state api-field-state-${state.kind}`} title={state.detail}><strong>{state.label}</strong>{state.detail && (state.kind === "global" || state.detail !== field.name) && <code>{state.detail}</code>}</span>}</span><code>: <span className="api-json-value-token">{linkedValue ? <button type="button" className="api-json-token" onClick={openValueMenu} aria-label={`${field.name} 연결값 설정`}>실행 시 연결값 사용</button> : requestToken(current, field)}</span></code>{!last && ","}
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
          {missingGlobal(state) && <GlobalVariableSetupLink name={state!.detail!} />}{state && <span className={`api-field-state api-field-state-${state.kind}`} title={state.detail}><strong>{state.label}</strong>{state.detail && <code>{state.detail}</code>}</span>}
        </div>
        <div className="api-field-actions"><button type="button" className="api-field-value-trigger" aria-expanded={valueMenu === fieldKey} onClick={openValueMenu}>값 연결</button></div>
      </div>
      {valueModal}{inputSettings}{scenarioLink}
    </div>;
  };
  const hasRequestBody = Boolean(operation && (operation.bodySchema !== undefined || operation.bodyExample !== undefined || operation.bodyRequired));
  const spec = catalogs[bindings[step.server] ?? step.server]?.spec;
  return <div className="api-simple-step">
    <header className="api-simple-section-heading"><h3>요청</h3><small>Swagger 입력값</small></header>
    {!operation ? <p>명세를 확인할 수 없습니다. 고급 설정을 사용하세요.</p> : <>
      {fields.filter(field => field.area !== "body").length > 0 ? <div className="api-request-fields">{fields.filter(field => field.area !== "body").map(field => renderField(field))}</div> : !hasRequestBody && <p>입력 가능한 요청 파라미터가 없습니다.</p>}
      {hasRequestBody && <RequestBodyEditor operation={operation} step={step} update={update} bodyFields={fields.filter(field => field.area === "body")} renderField={renderField} />}
    </>}
    <header className="api-simple-section-heading"><h3>응답 · 명세 구조</h3><small>선택해서 검증·연결</small></header>
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
            update({ extract: [...step.extract.filter(e => e !== previous && e.target !== `globals.${globalName}`), { source: "body", pointer: verificationPointer, target: `globals.${globalName}`, sensitive: /token|password|secret|code/i.test(globalName) }] }); closeResponseModal();
          }}>저장 설정 적용</button>}
          {existingGlobalExtraction(verificationPointer) && <button type="button" className="api-danger-action" onClick={() => { const existing = existingGlobalExtraction(verificationPointer); if (existing) update({ extract: step.extract.filter(extract => extract !== existing) }); closeResponseModal(); }}>전역변수 저장 해제</button>}
        </section>}
        {action === "verify" && verificationPointer !== null && <section className="api-verification-form" aria-label="응답 검증 설정">
          <p><strong>선택한 응답 필드</strong> · <code>{verificationPointer || "전체 응답"}</code></p>
          <label>검증 방식<select aria-label="응답 검증 방식" value={verificationOperator} onChange={e => setVerificationOperator(e.target.value as VerificationOperator)}><option value="exists">존재하는지</option><option value="equals">기대값과 같은지</option><option value="contains">문자열·배열에 포함되는지</option></select></label>
          {verificationOperator !== "exists" && <label>기대값<input aria-label="응답 검증 기대값" value={verificationValue} placeholder="예: success 또는 200" onChange={e => setVerificationValue(e.target.value)} /></label>}
          <div className="api-actions"><button type="button" className="api-primary" onClick={() => {
            if (verificationOperator !== "exists" && !verificationValue.trim()) { setError("검증할 기대값을 입력하세요."); return; }
            let value: Json | undefined;
            if (verificationOperator !== "exists") { try { value = JSON.parse(verificationValue) as Json; } catch { value = verificationValue; } }
            const expectation = verificationOperator === "exists" ? { source: "body" as const, pointer: verificationPointer, operator: verificationOperator } : { source: "body" as const, pointer: verificationPointer, operator: verificationOperator, value };
            update({ expect: [...(step.expect ?? []), expectation] }); closeResponseModal();
          }}>검증 추가</button></div>
        </section>}
        {error && <p className="api-field-menu-error" role="alert">{error}</p>}
        <footer><button type="button" onClick={closeResponseModal}>닫기</button></footer>
      </section>
    </div>}
    {(step.expect ?? []).map((expectation, n) => <details key={n}><summary>검증 {n + 1} · {expectation.source} {expectation.pointer ?? expectation.header} · {expectation.operator}</summary>
      <label>검증 대상<select value={expectation.source} onChange={e => update({ expect: step.expect!.map((v, i) => i === n ? { ...v, source: e.target.value as typeof v.source, pointer: e.target.value === "body" ? "" : undefined, header: e.target.value === "header" ? "content-type" : undefined } : v) })}><option value="body">응답 본문</option><option value="status">HTTP 상태</option><option value="header">응답 헤더</option></select></label>
      {expectation.source !== "status" && <label>응답 경로·헤더<input value={expectation.pointer ?? expectation.header ?? ""} onChange={e => update({ expect: step.expect!.map((v, i) => i === n ? { ...v, ...(v.source === "body" ? { pointer: e.target.value } : { header: e.target.value }) } : v) })} /></label>}
      <label>검증 방식<select value={expectation.operator} onChange={e => update({ expect: step.expect!.map((v, i) => i === n ? { ...v, operator: e.target.value as typeof v.operator } : v) })}><option value="exists">존재</option><option value="equals">같음</option><option value="contains">포함</option></select></label>
      {expectation.operator !== "exists" && <label>기대값 JSON<DraftInput value={jsonText(expectation.value)} onChange={e => { try { const value = JSON.parse(e.target.value) as Json; e.target.setCustomValidity(""); update({ expect: step.expect!.map((v, i) => i === n ? { ...v, value } : v) }); } catch { e.target.setCustomValidity('JSON 형식으로 입력하세요. 문자열 예: "success"'); } }} /></label>}
      <button type="button" onClick={() => update({ expect: step.expect!.length === 1 ? undefined : step.expect!.filter((_, i) => i !== n) })}>검증 삭제</button>
    </details>)}
    {error && <p role="alert">{error}</p>}
  </div>;
}
