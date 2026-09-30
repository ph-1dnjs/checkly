import { useEffect, useState, type ReactNode } from "react";
import { type Scenario, type Json, type ScenarioInput } from "../../../../../app/api-testing/shared/scenario";
import type { ApiOperation, ApiScope, ApiTestingBridge } from "../../../../../app/api-testing/shared/workspace";
import { DraftInput, DraftTextarea } from "../../../../shared/ui/DraftFields";
import { type RequestField, type FieldState, suggestedInputName, isStructuredRequestField, requestFieldValueMatches, templateVariable, jsonText } from "../model/step-request-model";
import { jsonValueType } from "../model/step-response-model";

export function RequestBodyEditor({ operation, step, update, bodyFields, renderField }: {
  operation: ApiOperation;
  step: Scenario["steps"][number];
  update: (patch: Partial<Scenario["steps"][number]>) => void;
  bodyFields: RequestField[];
  renderField: (field: RequestField, compact?: boolean, last?: boolean) => ReactNode;
}) {
  const [text, setText] = useState(() => jsonText(step.request.body));
  const [error, setError] = useState("");
  useEffect(() => {
    setText(jsonText(step.request.body));
    setError("");
  }, [step.id, step.request.body]);
  const example = jsonText(operation.bodyExample);
  const canUseFieldEditor = bodyFields.length > 0 && (step.request.body === undefined || (step.request.body !== null && typeof step.request.body === "object" && !Array.isArray(step.request.body)));
  const onChange = (nextText: string, element: HTMLTextAreaElement) => {
    setText(nextText);
    if (!nextText.trim()) {
      setError("");
      const request = { ...step.request };
      delete request.body;
      update({ request });
      return;
    }
    try {
      const value = JSON.parse(nextText) as Json;
      setError("");
      update({ request: { ...step.request, body: value } });
      element.setCustomValidity("");
    } catch {
      const message = "요청 본문의 JSON 문법을 확인하세요.";
      setError(message);
      element.setCustomValidity(message);
    }
  };
  return <section className="api-request-json" aria-label="요청 본문 JSON">
    <header><strong>Request body</strong><small>{operation.bodyRequired ? "required · " : ""}application/json</small></header>
    {canUseFieldEditor
      ? <div className="api-json-field-editor" aria-label="요청 본문 필드 편집">
        <p className="api-field-help">JSON 키를 클릭해 이전 응답·전역변수·사용자 입력을 선택하고, 오른쪽 값은 바로 수정하세요.</p>
        <div className="api-json-edit-code" aria-label="요청 본문 JSON 값 편집">
          <code className="api-json-edit-brace">&#123;</code>
          <div className="api-json-field-list">{bodyFields.map((field, fieldIndex) => renderField(field, true, fieldIndex === bodyFields.length - 1))}</div>
          <code className="api-json-edit-brace">&#125;</code>
        </div>
      </div>
      : <p className="api-field-help">{bodyFields.length > 0 ? "현재 요청 본문이 전체 JSON 값으로 연결되어 있습니다. 아래 고급 JSON 편집에서 수정하세요." : "입력 가능한 JSON 필드가 없습니다. 아래 고급 JSON 편집에서 요청 본문을 입력하세요."}</p>}
    {!canUseFieldEditor && <details className="api-json-advanced" open>
      <summary>고급 JSON 직접 편집</summary>
      <label>요청 본문 JSON<textarea aria-label="시나리오 요청 본문 JSON" spellCheck={false} rows={7} value={text} placeholder={example || '{\n  "key": "value"\n}'} onChange={event => onChange(event.target.value, event.target)} /></label>
      {error && <p className="api-field-menu-error" role="alert">{error} 저장하려면 유효한 JSON을 입력하세요.</p>}
    </details>}
  </section>;
}

export function GlobalVariableCreateForm({ index, field, scope, bridge, onCreated, onClose }: {
  index: number;
  field: RequestField;
  scope: ApiScope;
  bridge: ApiTestingBridge;
  onCreated: (name: string, type: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(() => suggestedInputName(field, index));
  const [value, setValue] = useState("");
  const [type, setType] = useState<"string" | "json">("string");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setError("");
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || ["constructor", "prototype"].includes(name)) {
      setError("변수 이름은 영문으로 시작하는 영문·숫자·밑줄을 사용하세요.");
      return;
    }
    setSaving(true);
    try {
      const parsed = (type === "string" ? value : JSON.parse(value)) as Json;
      await bridge.setGlobal({ projectId: scope.projectId }, name, parsed);
      onCreated(name, type === "string" ? "string" : jsonValueType(parsed));
      setValue("");
      onClose();
    } catch (cause) {
      setError(cause instanceof SyntaxError ? "JSON 형식의 전역변수 값을 입력하세요." : cause instanceof Error ? cause.message : "전역변수를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };
  return <div className="api-global-variable-form">
    <label>변수 이름<input aria-label={`${index + 1}단계 ${field.name} 새 전역변수 이름`} value={name} disabled={saving} onChange={event => setName(event.target.value)} /></label>
    <label>값 형식<select aria-label={`${index + 1}단계 ${field.name} 새 전역변수 형식`} value={type} disabled={saving} onChange={event => setType(event.target.value as "string" | "json")}><option value="string">문자열</option><option value="json">JSON · 숫자, 불리언, 객체, 배열</option></select></label>
    <label>값<input aria-label={`${index + 1}단계 ${field.name} 새 전역변수 값`} type="text" autoComplete="off" spellCheck={false} value={value} disabled={saving} placeholder={type === "string" ? "값 입력" : '{"key":"value"}'} onChange={event => setValue(event.target.value)} /></label>
    {error && <p className="api-field-menu-error" role="alert">{error}</p>}
    <div className="api-actions"><button type="button" className="api-primary" disabled={saving} onClick={() => void save()}>{saving ? "저장 중…" : "추가 후 이 키에 연결"}</button><button type="button" disabled={saving} onClick={() => { onClose(); setError(""); }}>취소</button></div>
  </div>;
}

export function ValueActionModal({ index, field, current, state, globalNames, hasUserInput, scope, bridge, onClose, onDirect, onScenario, onGlobal, onGlobalCreated, onUserInput }: {
  index: number;
  field: RequestField;
  current: Json | undefined;
  state?: FieldState;
  globalNames: string[];
  hasUserInput: boolean;
  scope: ApiScope;
  bridge: ApiTestingBridge;
  onClose: () => void;
  onDirect: (value: Json | undefined) => void;
  onScenario: () => void;
  onGlobal: (name: string) => void;
  onGlobalCreated: (name: string, type: string) => void;
  onUserInput: () => void;
}) {
  const selectedGlobal = templateVariable(current, "globals") ?? "";
  const [globalCreateOpen, setGlobalCreateOpen] = useState(false);
  // A linked value (global, earlier step, user input) is shown under "현재 설정", not as raw {{…}} text.
  const linked = state !== undefined && state.kind !== "cookie";
  const [directText, setDirectText] = useState(() => linked || current === undefined ? "" : typeof current === "string" ? current : jsonText(current));
  const [directError, setDirectError] = useState("");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const applyDirectValue = () => {
    if (!directText.trim()) { onDirect(undefined); return; }
    if (field.type === "string" || !["number", "integer", "boolean", "object", "array"].includes(field.type)) { onDirect(directText); return; }
    try {
      const exactTemplate = /^\{\{(?:inputs|vars|globals)\.[A-Za-z][A-Za-z0-9_]*\}\}$/.test(directText.trim());
      const value = exactTemplate ? directText.trim() : JSON.parse(directText) as Json;
      if (!exactTemplate && !requestFieldValueMatches(value as Json, field.type)) throw new Error();
      onDirect(value as Json);
    } catch { setDirectError(`${field.name} 형식에 맞는 JSON 값을 입력하세요.`); }
  };
  const structured = isStructuredRequestField(field);
  const directPlaceholder = field.type === "string" ? "값 입력" : field.type === "object" ? '{\n  "key": "value"\n}' : field.type === "array" ? '[\n  "value"\n]' : `${field.type} 값`;
  return <div className="api-value-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="api-value-modal api-value-action-modal" role="dialog" aria-modal="true" aria-label={`${field.name} 값 설정`} onMouseDown={event => event.stopPropagation()}>
      <header>
        <div><p className="api-value-modal-kicker">값 설정</p><h2>{field.name} 값 연결</h2><small>{index + 1}단계 · {field.area} · {field.type}</small></div>
        <button type="button" aria-label="값 설정 닫기" onClick={onClose}>×</button>
      </header>
      {state && <div className={`api-value-current api-value-current-${state.kind}`}><span className="api-field-state"><strong>{state.label}</strong>{state.detail && <code>{state.detail}</code>}</span><small>현재 적용 중</small></div>}
      {!state && field.area === "cookies" && <p className="api-value-modal-note">값을 입력하지 않으면 같은 서버의 앞선 응답에서 받은 쿠키를 자동으로 사용합니다.</p>}
      <p className="api-value-modal-note">이 키에 사용할 값을 선택하세요. 직접 입력한 값은 요청 데이터로 사용되고, 출처를 바꾸면 현재 설정을 대체합니다.</p>
      <section className="api-value-direct-editor" aria-label={`${index + 1}단계 ${field.name} 직접 입력`}>
        <header><strong>직접 입력</strong><small>입력한 값을 요청에 사용</small></header>
        <div>{structured
          ? <DraftTextarea aria-label={`${index + 1}단계 ${field.name} 직접 입력 JSON`} rows={4} spellCheck={false} value={directText} placeholder={directPlaceholder} onChange={event => { setDirectText(event.target.value); setDirectError(""); }} />
          : <DraftInput aria-label={`${index + 1}단계 ${field.name} 직접 입력값`} value={directText} placeholder={directPlaceholder} onChange={event => { setDirectText(event.target.value); setDirectError(""); }} />}
          <button type="button" className="api-primary" onClick={applyDirectValue}>입력값 적용</button></div>
        {directError && <p className="api-field-menu-error" role="alert">{directError}</p>}
      </section>
      <div className="api-value-modal-options">
        <button type="button" className="api-value-modal-option" onClick={onScenario}><strong>이전 단계 값 선택</strong><small>다른 단계의 요청·응답 JSON에서 선택</small></button>
        <section className="api-value-modal-option api-global-variable-option" aria-label={globalCreateOpen ? "새 전역변수 추가" : "전역변수 선택"}>
          <header><strong>{globalCreateOpen ? "새 전역변수 추가" : "전역변수 선택"}</strong>{!globalCreateOpen && <button type="button" className="api-global-variable-add" onClick={() => setGlobalCreateOpen(true)}>+ 새 변수 추가</button>}</header>
          {!globalCreateOpen && <>
            <small>프로젝트에 저장된 값 사용 · local/dev URL 공용</small>
            <select aria-label={`${index + 1}단계 ${field.name} 전역변수`} value={selectedGlobal} onChange={event => { if (event.target.value) onGlobal(event.target.value); }}><option value="">선택하지 않음</option>{globalNames.map(name => <option key={name} value={name}>{name}</option>)}</select>
          </>}
          {globalCreateOpen && <GlobalVariableCreateForm index={index} field={field} scope={scope} bridge={bridge} onCreated={(name, type) => { onGlobalCreated(name, type); onGlobal(name); }} onClose={() => setGlobalCreateOpen(false)} />}
        </section>
        <button type="button" className={hasUserInput ? "api-value-modal-option is-active" : "api-value-modal-option"} onClick={onUserInput}><strong>{hasUserInput ? "사용자 입력 설정" : "실행 중 사용자 입력으로 받기"}</strong><small>{hasUserInput ? "안내 문구·형식·필수 여부 수정" : "이 API 직전에 값을 입력받음"}</small></button>
      </div>
      <footer><button type="button" onClick={onClose}>닫기</button></footer>
    </section>
  </div>;
}

export function ScenarioInputSettingsModal({ index, field, userInput, onChange, onRemove, onClose }: {
  index: number;
  field: RequestField;
  userInput: ScenarioInput;
  onChange: (patch: Partial<ScenarioInput>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="api-value-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="api-value-modal api-input-settings-modal" role="dialog" aria-modal="true" aria-label={`${field.name} 사용자 입력 설정`} onMouseDown={event => event.stopPropagation()}>
      <header>
        <div><p className="api-value-modal-kicker">실행 전 사용자 입력</p><h2>{field.name} 입력 설정</h2><small>{index + 1}단계 · {field.area} · {field.type}</small></div>
        <button type="button" aria-label="사용자 입력 설정 닫기" onClick={onClose}>×</button>
      </header>
      <p className="api-value-modal-note">이 API를 실행하기 직전에 값을 입력받아 <code>{field.name}</code>에 사용합니다. 입력값 원문은 시나리오 YAML에 저장하지 않습니다.</p>
      <label>입력 안내 문구<input aria-label={`${index + 1}단계 ${field.name} 사용자 입력 안내`} value={userInput.label ?? ""} placeholder={`${field.name} 입력`} onChange={event => onChange({ label: event.target.value || undefined })} /></label>
      <div className="api-input-settings-grid">
        <label>값 형식<select aria-label={`${index + 1}단계 ${field.name} 사용자 입력 형식`} value={userInput.type} onChange={event => onChange({ type: event.target.value as ScenarioInput["type"] })}><option value="string">문자열</option><option value="number">숫자</option><option value="boolean">불리언</option><option value="object">JSON 객체</option><option value="array">JSON 배열</option></select></label>
        <label className="api-check-row"><input type="checkbox" checked={userInput.required} onChange={event => onChange({ required: event.target.checked })} />필수 입력</label>
      </div>
      <div className="api-value-preview"><span className="api-field-state api-field-state-user-input"><strong>사용자 입력</strong><code>{userInput.name}</code></span><small>필드에는 실행 시 <code>{`{{vars.${userInput.name}}}`}</code>로 전달됩니다.</small></div>
      <footer><button type="button" className="api-danger-action" onClick={onRemove}>사용자 입력 해제</button><button type="button" className="api-primary" onClick={onClose}>완료</button></footer>
    </section>
  </div>;
}
