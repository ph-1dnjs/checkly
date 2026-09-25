import { useEffect, useState, type ChangeEvent, type ComponentProps, type ReactNode } from "react";
import { scenarioStepInputs, type Scenario, type Json, type ScenarioInput } from "../../../app/api-testing/shared/scenario";
import type { ApiCatalog, ApiOperation, ApiScope, ApiTestingBridge, ApiGlobal } from "../../../app/api-testing/shared/workspace";
import { type RequestArea } from "./scenario-builder-model";
import { objectValue, responseFields } from "./response-fields";
import { responseGlobalNameSuggestions, type ResponseGlobalNameSuggestion } from "./response-global-name";
import { ScenarioValueLink } from "./ScenarioValueLink";
import { GlobalVariableSetupLink, useGlobalVariableAccess } from "./global-variable-access";
import { JsonCode } from "./JsonCode";
function DraftInput({ value, onChange, ...props }: ComponentProps<"input">) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return <input {...props} value={text} onChange={event => { setText(event.target.value); onChange?.(event); }} />;
}

function DraftTextarea({ value, onChange, ...props }: ComponentProps<"textarea">) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  return <textarea {...props} value={text} onChange={event => { setText(event.target.value); onChange?.(event); }} />;
}

type RequestField = { name: string; area: RequestArea; type: string; required: boolean; description?: string; example?: Json };
type ResponseDocument = { status: string; description: string; mediaType?: string; preview?: Json; previewLabel?: "Example Value" | "Schema" };
type VerificationOperator = "exists" | "equals" | "contains";
type FieldState = { kind: "user-input" | "global" | "scenario" | "cookie"; label: string; detail?: string };

function suggestedInputName(field: RequestField, index: number): string {
  const name = field.name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "");
  return /^[A-Za-z]/.test(name) ? name : `input${index + 1}`;
}

function inputTypeForField(type: string): ScenarioInput["type"] {
  if (type === "number" || type === "integer") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") return "array";
  if (type === "object") return "object";
  return "string";
}

function isStructuredRequestField(field: RequestField): boolean {
  return field.type === "object" || field.type === "array";
}

function requestFieldValueMatches(value: Json, type: string): boolean {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  return true;
}

function templateVariable(value: unknown, namespace: "vars" | "globals"): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(new RegExp(`\\{\\{${namespace}\\.([A-Za-z][A-Za-z0-9_]*)\\}\\}`));
  return match?.[1];
}

function variableReferenceInValue(value: unknown, variable: string): boolean {
  if (typeof value === "string") return value.includes(`{{vars.${variable}}}`);
  if (Array.isArray(value)) return value.some(item => variableReferenceInValue(item, variable));
  if (value && typeof value === "object") return Object.values(value).some(item => variableReferenceInValue(item, variable));
  return false;
}

function sourceStepIndex(scenario: Scenario, id: string): number {
  return scenario.steps.findIndex(step => step.id === id);
}

function fieldState(scenario: Scenario, index: number, field: RequestField, current: Json | undefined, userInput?: ScenarioInput): FieldState | undefined {
  if (userInput) return { kind: "user-input", label: "사용자 입력", detail: userInput.name };
  const global = templateVariable(current, "globals");
  if (global) return { kind: "global", label: "전역변수", detail: global };
  const variable = templateVariable(current, "vars");
  if (variable) {
    const binding = scenario.valueBindings.find(value => value.name === variable);
    if (binding) {
      const from = sourceStepIndex(scenario, binding.step);
      const source = binding.source === "response" ? `응답 ${binding.area === "header" ? binding.header ?? "헤더" : binding.pointer || "전체 응답"}` : `요청 ${binding.area} ${binding.pointer || "전체 값"}`;
      return { kind: "scenario", label: "값 연결", detail: `${from >= 0 ? `${from + 1}단계 ` : ""}${source}` };
    }
    return { kind: "scenario", label: "값 연결", detail: "출처 설정 필요" };
  }
  if (field.area === "cookies" && current === undefined) return { kind: "cookie", label: "자동 쿠키", detail: "앞선 응답의 Set-Cookie" };
  return undefined;
}

function jsonText(value: Json | undefined): string {
  if (value === undefined) return "";
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function resolveSchema(value: unknown, spec: Json | undefined, seen = new Set<string>()): Record<string, any> {
  let node = objectValue(value);
  while (typeof node.$ref === "string" && node.$ref.startsWith("#/") && !seen.has(node.$ref)) {
    const ref = node.$ref;
    seen.add(ref);
    let resolved: unknown = spec;
    for (const key of ref.slice(2).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"))) resolved = Object.hasOwn(objectValue(resolved), key) ? objectValue(resolved)[key] : undefined;
    if (resolved === undefined) break;
    node = objectValue(resolved);
  }
  return node;
}

function sampleSchema(value: unknown, spec: Json | undefined, depth = 0): Json {
  if (depth > 12) return null;
  const node = resolveSchema(value, spec);
  if (node.example !== undefined) return node.example as Json;
  if (node.default !== undefined) return node.default as Json;
  if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0] as Json;
  if (node.type === "object" || node.properties) return Object.fromEntries(Object.entries(objectValue(node.properties)).map(([key, child]) => [key, sampleSchema(child, spec, depth + 1)]));
  if (node.type === "array") return [];
  if (node.type === "number" || node.type === "integer") return 0;
  if (node.type === "boolean") return false;
  return "string";
}

function responseExample(media: Record<string, any>, spec?: Json): { value?: Json; label?: "Example Value" | "Schema" } {
  if (media.example !== undefined) return { value: media.example, label: "Example Value" };
  const firstExample = Object.values(objectValue(media.examples))[0];
  if (firstExample !== undefined) {
    const example = objectValue(firstExample);
    return { value: example.value !== undefined ? example.value : firstExample, label: "Example Value" };
  }
  if (media.schema !== undefined) return { value: sampleSchema(media.schema, spec), label: "Schema" };
  return {};
}

function responseDocuments(responses: Json, spec?: Json): ResponseDocument[] {
  return Object.entries(objectValue(responses)).map(([status, raw]) => {
    const response = objectValue(raw);
    const media = Object.entries(objectValue(response.content)).find(([type]) => type === "application/json") ?? Object.entries(objectValue(response.content))[0];
    const mediaValue = media ? objectValue(media[1]) : {};
    const preview = responseExample(mediaValue, spec);
    return {
      status,
      description: typeof response.description === "string" ? response.description : "응답 명세",
      ...(media ? { mediaType: media[0] } : {}),
      ...(preview.value !== undefined ? { preview: preview.value, previewLabel: preview.label } : {}),
    };
  });
}

export function findStepOperation(scenario: Scenario, index: number, catalogs: Record<string, ApiCatalog | null>, bindings: Record<string, string>) {
  const step = scenario.steps[index];
  return catalogs[bindings[step.server] ?? step.server]?.operations.find(op => "operationId" in step.api ? op.operationId === step.api.operationId : op.path === step.api.path && op.method.toUpperCase() === step.api.method);
}

type ResponseField = { pointer: string; type: string; status: string };
type ResponseBadge = { label: string; tone: "global" | "link" | "verify" | "save"; title?: string };

function responseFieldName(pointer: string): string {
  const last = pointer.split("/").filter(Boolean).pop();
  if (!last) return "전체 응답";
  return last.replace(/~1/g, "/").replace(/~0/g, "~");
}

function responseFieldKey(pointer: string): string {
  const name = responseFieldName(pointer);
  return JSON.stringify(name);
}

function jsonPointerValue(value: Json | undefined, pointer: string): Json | undefined {
  if (!pointer) return value;
  let current: unknown = value;
  for (const part of pointer.slice(1).split("/").map(segment => segment.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else if (current && typeof current === "object") current = Object.hasOwn(current, part) ? (current as Record<string, unknown>)[part] : undefined;
    else return undefined;
  }
  return current as Json | undefined;
}

function jsonValueType(value: Json): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function responseFieldsFromValue(value: Json, status: string): ResponseField[] {
  const result: ResponseField[] = [];
  const visit = (current: Json, pointer: string, depth: number) => {
    if (depth > 12 || result.length >= 500) return;
    result.push({ pointer, type: jsonValueType(current), status });
    if (Array.isArray(current)) current.forEach((child, index) => visit(child, `${pointer}/${index}`, depth + 1));
    else if (current !== null && typeof current === "object") Object.entries(current).forEach(([key, child]) => visit(child, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, depth + 1));
  };
  visit(value, "", 0);
  return result;
}

function responseFieldsWithoutArrayItems(fields: ResponseField[]): ResponseField[] {
  const arrays = fields.filter(field => field.type === "array").map(field => field.pointer);
  return fields.filter(field => !arrays.some(arrayPointer => {
    const prefix = arrayPointer ? `${arrayPointer}/` : "/";
    if (!field.pointer.startsWith(prefix)) return false;
    return /^\d+(?:\/|$)/.test(field.pointer.slice(prefix.length));
  }));
}

function responseToken(value: Json | undefined, type: string): string {
  if (value !== undefined) {
    if (value !== null && typeof value === "object") return Array.isArray(value) ? "[" : "{";
    return JSON.stringify(value) ?? "null";
  }
  if (type === "object") return "{";
  if (type === "array") return "[";
  if (type === "string") return '"string"';
  if (type === "boolean") return "false";
  if (type === "number" || type === "integer") return "0";
  return "null";
}

function ResponseGlobalNameField({ value, suggestions, onChange }: { value: string; suggestions: ResponseGlobalNameSuggestion[]; onChange: (value: string) => void }) {
  return <label>전역변수 이름
    <input data-value-visibility="public" aria-label="응답 전역변수 이름" value={value} onChange={event => onChange(event.target.value)} placeholder="예: accessToken" />
    <span className="api-global-name-quick-label">빠른 설정</span>
    <span className="api-global-name-quick" aria-label="전역변수 이름 빠른 설정">
      {suggestions.map(suggestion => <button type="button" key={suggestion.id} className={value === suggestion.name ? "is-selected" : ""} title={suggestion.detail} onClick={() => onChange(suggestion.name)}><strong>{suggestion.label}</strong><code>{suggestion.name}</code></button>)}
    </span>
    <small className="api-global-name-help">필드명 또는 엔드포인트 경로를 기준으로 자동 입력할 수 있습니다.</small>
  </label>;
}

function requestToken(value: Json | undefined, field: RequestField): string {
  if (value !== undefined) return JSON.stringify(value) ?? "null";
  if (field.example !== undefined) return JSON.stringify(field.example) ?? "null";
  if (field.type === "string") return '"string"';
  if (field.type === "boolean") return "false";
  if (field.type === "number" || field.type === "integer") return "0";
  if (field.type === "object") return "{}";
  if (field.type === "array") return "[]";
  return "null";
}

function ResponseBadgeList({ badges }: { badges: ResponseBadge[] }) {
  if (!badges.length) return null;
  return <span className="api-response-json-badges" aria-label="응답값 설정">{badges.map((badge, index) => <span key={`${badge.tone}-${badge.label}-${index}`} className={`api-response-json-badge is-${badge.tone}`} title={badge.title}>{badge.label}</span>)}</span>;
}

function ResponseJson({ fields, preview, onSelect, selected, badges }: { fields: ResponseField[]; preview?: Json; onSelect: (pointer: string) => void; selected: string | null; badges?: (pointer: string) => ResponseBadge[] }) {
  const visibleFields = responseFieldsWithoutArrayItems(fields);
  const render = (field: ResponseField): ReactNode => {
    const children = visibleFields.filter(child => child.pointer !== field.pointer && child.pointer.slice(0, child.pointer.lastIndexOf("/")) === field.pointer);
    const container = field.type === "object" || field.type === "array";
    const compactContainer = container && children.length === 0;
    const value = jsonPointerValue(preview, field.pointer);
    const token = compactContainer ? field.type === "array" ? "[]" : "{}" : responseToken(value, field.type);
    const responseBadges = badges?.(field.pointer) ?? [];
    return <span key={field.pointer} data-summary-field={field.pointer ? `response:body:${field.pointer}` : undefined}>
      {field.pointer ? <><button type="button" className="api-json-token api-json-key-token" aria-label={`${field.pointer} 키 선택`} aria-pressed={selected === field.pointer} onClick={() => onSelect(field.pointer)}>{responseFieldKey(field.pointer)}</button><ResponseBadgeList badges={responseBadges} /><code>: <span className={`api-json-value-token api-json-type-${field.type}`}>{token}</span></code></> : <><button type="button" className="api-json-token api-json-root-token" aria-label="전체 응답 선택" aria-pressed={selected === field.pointer} onClick={() => onSelect(field.pointer)}>{token}</button><ResponseBadgeList badges={responseBadges} /></>}
      {children.map((child, i) => <span className="api-json-line" key={child.pointer}>{render(child)}{i < children.length - 1 ? "," : ""}</span>)}
      {container && !compactContainer && <span>{field.type === "array" ? "]" : "}"}</span>}
    </span>;
  };
  return <div className="api-json-code">{visibleFields.filter(field => field.pointer === "").map(field => render(field))}</div>;
}

function ResponsePicker({ operation, spec, onSelect, actionLabel = "값 사용", selectedPointer = null, showPreview = true, badges }: { operation?: ApiOperation; spec?: Json; onSelect: (pointer: string) => void; actionLabel?: string; selectedPointer?: string | null; showPreview?: boolean; badges?: (pointer: string) => ResponseBadge[] }) {
  const fields = operation ? responseFields(operation.responses, spec) : [];
  const documents = responseDocuments(operation?.responses ?? {}, spec);
  return <div className="api-response-picker">
    {!fields.length && <p>선택 가능한 응답 구조가 없습니다. OpenAPI 응답 스키마를 확인하세요.</p>}
    {documents.map(document => {
      const documentFields: ResponseField[] = fields.filter(field => field.status === document.status);
      const selectableFields = documentFields.length > 0 ? documentFields : document.preview === undefined ? [] : responseFieldsFromValue(document.preview, document.status);
      return <details className="api-response-definition" key={document.status} open={documents.length === 1}>
        <summary><code>{document.status}</code><span>{document.description}</span></summary>
        {document.mediaType && <small className="api-response-media">{document.mediaType}</small>}
        {showPreview && document.preview !== undefined && <details className="api-response-json-reference">
          <summary>{document.previewLabel === "Schema" ? "응답 구조 원문 보기" : "응답 예시 원문 보기"}</summary>
          <JsonCode value={document.preview} copyable={false} />
        </details>}
        {selectableFields.length > 0 && <div className="api-response-json-selector" aria-label={`${document.status} 응답 JSON 항목 선택`}>
          <header><strong>응답 JSON</strong><small>항목을 눌러 {actionLabel}</small></header>
          <ResponseJson fields={selectableFields} preview={document.preview} onSelect={onSelect} selected={selectedPointer} badges={badges} />
        </div>}
      </details>;
    })}
  </div>;
}

function RequestBodyEditor({ operation, step, update, bodyFields, renderField }: {
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

function GlobalVariableCreateForm({ index, field, scope, bridge, onCreated, onClose }: {
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
    <label>변수 이름<input data-value-visibility="public" aria-label={`${index + 1}단계 ${field.name} 새 전역변수 이름`} value={name} disabled={saving} onChange={event => setName(event.target.value)} /></label>
    <label>값 형식<select aria-label={`${index + 1}단계 ${field.name} 새 전역변수 형식`} value={type} disabled={saving} onChange={event => setType(event.target.value as "string" | "json")}><option value="string">문자열</option><option value="json">JSON · 숫자, 불리언, 객체, 배열</option></select></label>
    <label>값<input aria-label={`${index + 1}단계 ${field.name} 새 전역변수 값`} type="text" autoComplete="off" spellCheck={false} value={value} disabled={saving} placeholder={type === "string" ? "값 입력" : '{"key":"value"}'} onChange={event => setValue(event.target.value)} /></label>
    {error && <p className="api-field-menu-error" role="alert">{error}</p>}
    <div className="api-actions"><button type="button" className="api-primary" disabled={saving} onClick={() => void save()}>{saving ? "저장 중…" : "추가 후 이 키에 연결"}</button><button type="button" disabled={saving} onClick={() => { onClose(); setError(""); }}>취소</button></div>
  </div>;
}

function ValueActionModal({ index, field, current, state, globalNames, hasUserInput, scope, bridge, onClose, onDirect, onScenario, onGlobal, onGlobalCreated, onUserInput }: {
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
  const [directText, setDirectText] = useState(() => current === undefined ? "" : typeof current === "string" ? current : jsonText(current));
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

function ScenarioInputSettingsModal({ index, field, userInput, onChange, onRemove, onClose }: {
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
      <label>입력 안내 문구<input data-value-visibility="public" aria-label={`${index + 1}단계 ${field.name} 사용자 입력 안내`} value={userInput.label ?? ""} placeholder={`${field.name} 입력`} onChange={event => onChange({ label: event.target.value || undefined })} /></label>
      <div className="api-input-settings-grid">
        <label>값 형식<select aria-label={`${index + 1}단계 ${field.name} 사용자 입력 형식`} value={userInput.type} onChange={event => onChange({ type: event.target.value as ScenarioInput["type"] })}><option value="string">문자열</option><option value="number">숫자</option><option value="boolean">불리언</option><option value="object">JSON 객체</option><option value="array">JSON 배열</option></select></label>
        <label className="api-check-row"><input type="checkbox" checked={userInput.required} onChange={event => onChange({ required: event.target.checked })} />필수 입력</label>
        <label className="api-check-row"><input type="checkbox" checked={userInput.sensitive} onChange={event => onChange({ sensitive: event.target.checked })} />민감값 마스킹</label>
      </div>
      <div className="api-value-preview"><span className="api-field-state api-field-state-user-input"><strong>사용자 입력</strong><code>{userInput.name}</code></span><small>필드에는 실행 시 <code>{`{{vars.${userInput.name}}}`}</code>로 전달됩니다.</small></div>
      <footer><button type="button" className="api-danger-action" onClick={onRemove}>사용자 입력 해제</button><button type="button" className="api-primary" onClick={onClose}>완료</button></footer>
    </section>
  </div>;
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
      ? <DraftTextarea id={fieldId} aria-label={`${index + 1}단계 ${field.name} JSON`} rows={4} spellCheck={false} placeholder={placeholder} value={typeof current === "string" ? current : jsonText(current)} onChange={onInputChange} />
      : <DraftInput id={fieldId} aria-label={`${index + 1}단계 ${field.name}`} placeholder={placeholder} value={typeof current === "object" ? JSON.stringify(current) : current ?? ""} onChange={onInputChange} />;
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
