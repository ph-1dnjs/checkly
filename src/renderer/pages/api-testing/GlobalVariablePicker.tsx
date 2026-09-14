import { useEffect, useState } from "react";
import type { Scenario } from "../../../app/api-testing/shared/scenario";
import type { ApiGlobal, ApiScope, ApiTestingBridge, SavedApiScenario } from "../../../app/api-testing/shared/workspace";
import { globalOptions } from "./global-options";
import type { RequestArea } from "./scenario-builder-model";

export function GlobalVariablePicker({ scenario, index, scope, bridge, onChange }: {
  scenario: Scenario; index: number; scope: ApiScope; bridge: ApiTestingBridge; onChange: (scenario: Scenario) => void;
}) {
  const [globals, setGlobals] = useState<ApiGlobal[]>([]);
  const [saved, setSaved] = useState<SavedApiScenario[]>([]);
  const [name, setName] = useState("");
  const [area, setArea] = useState<RequestArea>("headers");
  const [field, setField] = useState("Authorization");
  const [prefix, setPrefix] = useState("Bearer ");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setGlobals([]); setSaved([]);
    void Promise.all([bridge.listGlobals(scope), bridge.listScenarios(scope.projectId)])
      .then(([g, s]) => { if (live) { setGlobals(g); setSaved(s); setError(""); } })
      .catch(() => { if (live) setError("전역변수 목록을 읽지 못했습니다. 닫았다 다시 열어 갱신하세요."); });
    return () => { live = false; };
  }, [open, bridge, scope.projectId, scope.environmentId]);
  const options = globalOptions(scenario, index, globals, saved, scope.environmentId);
  const selected = options.find(o => o.name === name);
  return <details onToggle={e => setOpen(e.currentTarget.open)}><summary>전역변수에서 요청값 선택</summary>
    <p>등록된 값과 응답 저장 정의를 표시합니다. 다른 시나리오는 자동 실행되지 않습니다.</p>
    <label>전역변수<select value={name} onChange={e => setName(e.target.value)}><option value="">변수 선택</option>{options.map(o => <option key={o.name} value={o.name}>{o.name} · {o.status}</option>)}</select></label>
    {!options.length && <p>등록된 값이나 YAML의 전역변수 저장 정의가 없습니다.</p>}
    {selected && <p role="status">{selected.status}{selected.sources.length > 0 && ` · ${selected.sources.join(" / ")}`}</p>}
    <label>요청 위치<select value={area} onChange={e => setArea(e.target.value as RequestArea)}>{["headers", "cookies", "query", "pathParams", "body"].map(a => <option key={a}>{a}</option>)}</select></label>
    <label>요청 필드<input value={field} onChange={e => setField(e.target.value)} /></label>
    <label>접두사<input value={prefix} onChange={e => setPrefix(e.target.value)} /></label>
    <button type="button" disabled={!selected || !field} onClick={() => {
      if (!selected) return;
      if (["__proto__", "constructor", "prototype"].includes(field)) { setError("다른 요청 필드 이름을 사용하세요."); return; }
      const step = scenario.steps[index];
      const previous = step.request[area];
      if (previous !== undefined && (!previous || typeof previous !== "object" || Array.isArray(previous))) { setError("객체의 최상위 필드에만 적용할 수 있습니다. 본문 전체·배열은 JSON 편집을 사용하세요."); return; }
      onChange({ ...scenario, steps: scenario.steps.map((s, i) => i !== index ? s : { ...s, request: { ...s.request, [area]: { ...previous as object, [field]: `${prefix}{{globals.${name}}}` } } }) });
      setError("");
    }}>변수 참조 적용</button>
    {error && <p role="alert">{error}</p>}
  </details>;
}
