import { useEffect, useState, type ComponentType } from "react";
import { stringifyScenario, parseScenario, scenarioSchema } from "../../../app/api-testing/shared/scenario";
import type { Scenario } from "../../../app/api-testing/shared/scenario";
import type { ApiCatalog, ApiGlobal, ApiProject, ApiScope, ApiTestingBridge, SavedApiScenario } from "../../../app/api-testing/shared/workspace";
import { moveStep } from "./scenario-builder-model";
import type { Step } from "./scenario-builder-model";
import { SimpleStep } from "./SimpleStep";
import { useGlobalVariableAccess } from "./global-variable-access";
import { globalOptions } from "./global-options";

function operationForStep(step: Step, catalogs: Record<string, ApiCatalog | null>, bindings: Record<string, string>) {
  const catalog = catalogs[bindings[step.server] ?? step.server];
  return catalog?.operations.find(operation => "operationId" in step.api
    ? operation.operationId === step.api.operationId
    : operation.path === step.api.path && operation.method.toUpperCase() === step.api.method);
}

export function ScenarioBuilder({ source, bindings, project, scope, bridge, onApply, onCancel, value, onChange, onStepFocus, Markdown, embedded = false, saving = false, suppliedCatalogs }: {
  suppliedCatalogs?: Record<string, ApiCatalog | null>;
  Markdown?: ComponentType<any>;
  source: string; bindings: Record<string, string>; project: ApiProject; scope: ApiScope; bridge: ApiTestingBridge;
  onApply: (source: string) => void; onCancel: () => void;
  value?: Scenario; onChange?: (value: Scenario) => void; onStepFocus?: (step: Step) => void; embedded?: boolean; saving?: boolean;
}) {
  const [initial] = useState(() => {
    try { return { value: source.trim() ? parseScenario(source) : { version: 1 as const, id: `scenario-${crypto.randomUUID()}`, name: "새 시나리오", description: "", onFailure: "stop" as const, inputs: {}, vars: {}, valueBindings: [], steps: [] }, error: "" }; }
    catch { return { value: null, error: "YAML 문법을 먼저 확인하세요. 원본은 변경하지 않았습니다." }; }
  });
  const [localDraft, setLocalDraft] = useState<Scenario | null>(initial.value);
  const draft = value ?? localDraft;
  const setDraft = (next: Scenario) => { if (onChange) onChange(next); else setLocalDraft(next); };
  const [catalogs, setCatalogs] = useState<Record<string, ApiCatalog | null>>({});
  const [error, setError] = useState(initial.error);
  const [visitedSteps, setVisitedSteps] = useState<Set<string>>(() => new Set());
  const [yamlOpen, setYamlOpen] = useState(false);
  const [globals, setGlobals] = useState<ApiGlobal[]>([]);
  const [savedScenarios, setSavedScenarios] = useState<SavedApiScenario[]>([]);
  const globalAccess = useGlobalVariableAccess();
  useEffect(() => {
    let live = true;
    void Promise.all([bridge.listGlobals({ projectId: scope.projectId }), bridge.listScenarios(scope.projectId)]).then(([values, scenarios]) => {
      if (live) { setGlobals(values.filter(item => item.type === "string")); setSavedScenarios(scenarios); }
    }).catch(() => {});
    return () => { live = false; };
  }, [bridge, scope.projectId, globalAccess.revision]);
  useEffect(() => {
    if (suppliedCatalogs) { setCatalogs(suppliedCatalogs); return; }
    let live = true;
    void Promise.all(project.servers.map(async s => [s.id, await bridge.getCatalog({ ...scope, serverId: s.id })] as const))
      .then(entries => { if (live) setCatalogs(Object.fromEntries(entries)); })
      .catch(() => { if (live) setError("API 명세를 읽지 못했습니다. 원본 YAML은 유지됩니다."); });
    return () => { live = false; };
  }, [bridge, project.servers, scope.environmentId, scope.projectId, suppliedCatalogs]);
  if (!draft) return <div role="alert"><p>{error}</p><button onClick={onCancel}>YAML로 돌아가기</button></div>;
  const updateStep = (index: number, patch: Partial<Step>) => setDraft({ ...draft, steps: draft.steps.map((s, i) => i === index ? { ...s, ...patch } : s) });
  const authNames = [...new Set([...globalOptions(draft, draft.steps.length, globals, savedScenarios, scope.environmentId).map(option => option.name), ...(draft.auth ? [draft.auth.slice(8)] : []), ...draft.steps.flatMap(step => step.auth && step.auth !== "none" ? [step.auth.slice(8)] : [])])].sort();
  return <form className="api-builder" aria-label="시나리오 시각 편집기" onInvalidCapture={event => { let element: HTMLElement | null = event.target as HTMLElement; while (element) { if (element instanceof HTMLDetailsElement) element.open = true; element = element.parentElement; } }} onSubmit={event => {
    event.preventDefault();
    const parsed = scenarioSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("\n")); return; }
    onApply(stringifyScenario(parsed.data, true));
  }}>
    <fieldset disabled={saving} style={{ border:0, padding:0, margin:0 }}>
    <label>시나리오 이름<input data-value-visibility="public" aria-label="시나리오 이름" required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
    <label>한글 설명<textarea data-value-visibility="public" aria-label="시나리오 설명" value={draft.description ?? ""} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
    <label>기본 인증<select aria-label="시나리오 기본 인증" value={draft.auth ?? ""} onChange={e => setDraft({ ...draft, auth: e.target.value || undefined })}><option value="">없음</option>{authNames.map(name => <option key={name} value={`globals.${name}`}>전역변수 · {name}</option>)}</select></label>
    <p className="api-field-help">모든 단계에 적용됩니다. 토큰 값은 실행할 때 전역변수에서 읽습니다.</p>
    <div className={embedded ? "api-accordion-editor" : undefined}>
    <div>
    {draft.steps.map((step, index) => { const operation = operationForStep(step, catalogs, bindings); const method = operation?.method ?? ("method" in step.api ? step.api.method : "API"); const path = operation?.path ?? ("path" in step.api ? step.api.path : step.api.operationId); return <details id={`scenario-editor-step-${step.id}`} onToggle={event => { if (event.currentTarget.open) setVisitedSteps(previous => previous.has(step.id) ? previous : new Set([...previous, step.id])); }} className={`api-builder-step api-step-accordion api-selected-${method.toLowerCase()}`} key={step.id} open={embedded ? undefined : true} aria-label={`편집 단계 ${index + 1}`}>
      <summary className="api-step-summary" onClick={() => onStepFocus?.(step)}><span>{index + 1}</span><span className="api-selected-method">{method}</span><code>{path}</code><span className="api-step-summary-name">{step.name || operation?.summary || step.id}</span><small>연결 {step.extract.length}{step.auth ? ` · 인증 ${step.auth === "none" ? "없음" : step.auth.slice(8)}` : draft.auth ? ` · 인증 ${draft.auth.slice(8)}` : ""}</small></summary>
      {(!embedded || visitedSteps.has(step.id)) && <div className="api-step-body">
      {embedded && operation?.description && <details className="api-step-description swagger-ui" aria-label="API 설명"><summary>API 설명 보기</summary>{Markdown ? <Markdown source={operation.description} /> : <p style={{ whiteSpace: "pre-wrap" }}>{operation.description}</p>}</details>}
      <header className="api-actions"><strong>{index + 1}. {method} {path}</strong>{!embedded && <><button type="button" disabled={!index} onClick={() => setDraft(moveStep(draft, index, -1))}>위로</button><button type="button" disabled={index === draft.steps.length - 1} onClick={() => setDraft(moveStep(draft, index, 1))}>아래로</button><button type="button" onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })}>단계 삭제</button></>}</header>
      <label>이 단계의 인증<select aria-label={`${index + 1}단계 인증`} value={step.auth ?? ""} onChange={event => updateStep(index, { auth: event.target.value ? event.target.value as typeof step.auth : undefined })}><option value="">{draft.auth ? `시나리오 인증 따름 · ${draft.auth.slice(8)}` : "시나리오 인증 따름 (없음)"}</option><option value="none">인증 없음</option>{authNames.map(name => <option key={name} value={`globals.${name}`}>전역변수 · {name}</option>)}</select></label>
      {embedded && <SimpleStep scenario={draft} index={index} catalogs={catalogs} bindings={bindings} scope={scope} bridge={bridge} onChange={setDraft} />}
      </div>}
    </details>; })}
    </div></div>
    {!draft.steps.length && <p>{embedded ? "API 문서 목록에서 첫 API를 클릭하세요." : "위 목록에서 첫 API를 추가하세요."}</p>}
    {error && <p role="alert" className="api-warning">{error}</p>}
    </fieldset>
    {embedded && <details onToggle={event => setYamlOpen(event.currentTarget.open)}><summary>간단한 YAML 보기</summary>{yamlOpen && <pre aria-label="작성 중인 시나리오 YAML">{stringifyScenario(draft, false, step => operationForStep(step, catalogs, bindings), Object.fromEntries(project.servers.map(server => [server.id, server.name])))}</pre>}</details>}
    <footer className="api-actions"><button type="submit" className="api-primary" disabled={saving || !draft.steps.length}>{saving ? "검사·저장 중…" : embedded ? "시나리오 검사·저장" : "편집 적용 · 검사"}</button>{!embedded && <button type="button" onClick={onCancel}>시각 편집 취소</button>}</footer>
  </form>;
}

