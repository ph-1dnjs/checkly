import { useEffect, useRef, useState } from "react";
import type { ApiGlobal, ApiProjectScope, ApiTestingBridge } from "../../../app/api-testing/shared/workspace";
import type { Json } from "../../../app/api-testing/shared/scenario";
export function GlobalVariablesPanel({ scope, bridge, targetName = "", targetRequest = 0, onSaved }: { scope: ApiProjectScope; bridge: ApiTestingBridge; targetName?: string; targetRequest?: number; onSaved?: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [variables, setVariables] = useState<ApiGlobal[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [type, setType] = useState("string");
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const focusForm = () => {
    setFormOpen(true);
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ block: "nearest" });
      formRef.current?.querySelector<HTMLInputElement>('[aria-label="전역변수 값"]')?.focus();
    });
  };
  const refresh = async () => setVariables(await bridge.listGlobals(scope));
  const visibleVariables = variables
    .filter(variable => variable.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }));
  useEffect(() => { void refresh().catch(() => setError("전역변수를 읽지 못했습니다")); }, []);
  useEffect(() => {
    if (!targetName) return;
    let active = true;
    void bridge.listGlobals(scope).then(items => {
      if (!active) return;
      const existing = items.find(item => item.name === targetName);
      setName(targetName); setValue(existing?.displayValue ?? ""); setType(existing && existing.type !== "string" ? "json" : "string");
      focusForm();
    }).catch(() => { if (active) setError("전역변수를 읽지 못했습니다"); });
    return () => { active = false; };
  }, [targetName, targetRequest]);
  return <section className="api-globals-panel">
    <h2>전역변수</h2>
    <p>이 프로젝트의 모든 서버·환경·개별 API·시나리오가 같은 값을 사용합니다. <strong>앱을 종료하면 초기화</strong>됩니다.</p>
    {variables.length > 0 && <div className="api-global-list-tools">
      <label className="api-global-search">변수 검색<input data-value-visibility="public" aria-label="전역변수 검색" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="이름으로 검색" /></label>
      <span aria-live="polite">{query.trim() ? `${visibleVariables.length}개 / ${variables.length}개` : `${variables.length}개`}</span>
    </div>}
    <div className="api-global-list">
      {variables.length === 0 && <p>저장된 변수가 없습니다.</p>}
      {variables.length > 0 && visibleVariables.length === 0 && <p>검색 결과가 없습니다.</p>}
      {visibleVariables.map(v => <div className="api-global-row" key={v.name}>
        <div className="api-global-meta"><code title={v.name}>{v.name}</code><small>{({ string: "문자열", number: "숫자", boolean: "불리언", object: "객체", array: "배열", null: "null" } as Record<string, string>)[v.type] ?? v.type}</small></div>
        <span className="api-global-value">{v.displayValue}</span>
        <div className="api-global-actions">
          <button disabled={busy} onClick={() => { setError(""); setName(v.name); setValue(v.displayValue); setType(v.type === "string" ? "string" : "json"); focusForm(); }}>수정</button>
          <button disabled={busy} onClick={async () => { setBusy(true); try { await bridge.deleteGlobal(scope, v.name); await refresh(); } catch { setError("변수를 삭제하지 못했습니다"); } finally { setBusy(false); } }}>삭제</button>
        </div>
      </div>)}
    </div>
    <details className="api-global-editor" open={formOpen} onToggle={event => { const open = event.currentTarget.open; setFormOpen(open); if (!open) { setName(""); setValue(""); setType("string"); } }}>
      <summary onClick={() => { if (!formOpen) { setName(""); setValue(""); setType("string"); setError(""); } }}>{formOpen ? name ? `${name} ${variables.some(variable => variable.name === name) ? "수정" : "추가"}` : "변수 추가" : "변수 추가"}</summary>
    <form ref={formRef} onSubmit={async e => {
      e.preventDefault(); setError(""); setBusy(true);
      try {
        const parsed: Json = type === "string" ? value : JSON.parse(value);
        await bridge.setGlobal(scope, name, parsed); await refresh(); setValue(""); setName(""); setFormOpen(false); onSaved?.();
      } catch { setError("변수 이름(영문 시작, 영문·숫자·밑줄)과 값의 형식을 확인하세요. 실행 중에는 변경할 수 없습니다."); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}><div className="api-global-form-grid"><label>변수 이름<input data-value-visibility="public" aria-label="전역변수 이름" required pattern="[A-Za-z][A-Za-z0-9_]*" value={name} onChange={e => setName(e.target.value)} placeholder="accessToken" /></label><label>값 형식<select aria-label="전역변수 형식" value={type} onChange={e => setType(e.target.value)}><option value="string">문자열</option><option value="json">JSON · 숫자, 불리언, 객체, 배열</option></select></label><label className="api-global-form-value">값<input aria-label="전역변수 값" type="text" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} /></label><div className="api-global-form-actions"><button className="api-primary">전역변수 저장</button><button type="button" onClick={() => setFormOpen(false)}>취소</button></div></div></fieldset>
    </form>
    </details>
    {error && <p role="alert" className="api-warning">{error}</p>}
  </section>;
}
