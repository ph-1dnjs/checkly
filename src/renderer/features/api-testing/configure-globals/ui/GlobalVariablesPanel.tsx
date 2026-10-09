import { useEffect, useRef, useState } from "react";
import type { ApiCookie, ApiGlobal, ApiProjectScope, ApiTestingBridge } from "../../../../../app/api-testing/shared/workspace";
import type { Json } from "../../../../../app/api-testing/shared/scenario";
import { useGlobalValuesVisible } from "../../../../entities/api-testing";

export function GlobalVariablesPanel({ scope, bridge, targetName = "", targetRequest = 0, onSaved }: { scope: ApiProjectScope; bridge: ApiTestingBridge; targetName?: string; targetRequest?: number; onSaved?: () => void }) {
  const [variables, setVariables] = useState<ApiGlobal[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [type, setType] = useState("string");
  const [query, setQuery] = useState("");
  // The add/edit form is a modal over the panel; the panel itself only lists what is saved.
  const [editing, setEditing] = useState<{ existing: boolean; focus: "name" | "value" } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Tokens gather here, so values start hidden (for screen sharing); the choice is remembered.
  const [showValues, toggleValues] = useGlobalValuesVisible();
  const openEditor = (next: { name: string; value: string; type: string; existing: boolean }) => {
    setError(""); setName(next.name); setValue(next.value); setType(next.type); setEditing({ existing: next.existing, focus: next.existing ? "value" : "name" });
  };
  const closeEditor = () => { setEditing(null); setName(""); setValue(""); setType("string"); };
  const [cookies, setCookies] = useState<ApiCookie[]>([]);
  // The list loaded on open must not land after (and overwrite) the list read right after a save.
  const listRequest = useRef(0);
  const refresh = async () => { const request = ++listRequest.current; const items = await bridge.listGlobals(scope); if (request === listRequest.current) setVariables(items); };
  const refreshCookies = async () => setCookies(await bridge.listCookies(scope));
  const visibleVariables = variables
    .filter(variable => variable.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }));
  useEffect(() => {
    void refresh().catch(() => setError("전역변수를 읽지 못했습니다"));
    void refreshCookies().catch(() => setError("세션 쿠키를 읽지 못했습니다"));
  }, []);
  useEffect(() => {
    if (!targetName) return;
    let active = true;
    void bridge.listGlobals(scope).then(items => {
      if (!active) return;
      const existing = items.find(item => item.name === targetName);
      openEditor({ name: targetName, value: existing?.displayValue ?? "", type: existing && existing.type !== "string" ? "json" : "string", existing: true });
    }).catch(() => { if (active) setError("전역변수를 읽지 못했습니다"); });
    return () => { active = false; };
  }, [targetName, targetRequest]);
  return <section className="api-globals-panel">
    <h2>전역변수 · 쿠키</h2>
    {/* One note for both sections instead of repeating it under each. */}
    <p className="api-globals-note">이 프로젝트의 모든 API·시나리오가 함께 씁니다. <strong>앱을 끄면 초기화</strong>됩니다.</p>
    <header className="api-globals-section-heading"><h3>전역변수 <small aria-live="polite">{query.trim() ? `${visibleVariables.length}개 / ${variables.length}개` : `${variables.length}개`}</small></h3>
      <span className="api-globals-heading-actions">
        {variables.length > 0 && <button type="button" aria-pressed={showValues} onClick={toggleValues}>{showValues ? "값 숨기기" : "값 보기"}</button>}
        <button type="button" disabled={busy} onClick={() => openEditor({ name: "", value: "", type: "string", existing: false })}>+ 변수 추가</button>
      </span>
    </header>
    {variables.length > 5 && <input className="api-global-search" aria-label="전역변수 검색" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="이름으로 검색" />}
    {variables.length === 0 && <p className="api-globals-empty">저장된 변수가 없습니다.</p>}
    {variables.length > 0 && <div className={`api-global-list${showValues ? "" : " is-values-hidden"}`}>
      {variables.length > 0 && visibleVariables.length === 0 && <p>검색 결과가 없습니다.</p>}
      {visibleVariables.map(v => <div className="api-global-row" key={v.name}>
        <div className="api-global-meta"><code title={v.name}>{v.name}</code><small>{({ string: "문자열", number: "숫자", boolean: "불리언", object: "객체", array: "배열", null: "null" } as Record<string, string>)[v.type] ?? v.type}</small></div>
        <span className="api-global-value">{v.displayValue}</span>
        <div className="api-global-actions">
          <button disabled={busy} onClick={() => openEditor({ name: v.name, value: v.displayValue, type: v.type === "string" ? "string" : "json", existing: true })}>수정</button>
          <button disabled={busy} onClick={async () => { setBusy(true); try { await bridge.deleteGlobal(scope, v.name); await refresh(); } catch { setError("변수를 삭제하지 못했습니다"); } finally { setBusy(false); } }}>삭제</button>
        </div>
      </div>)}
    </div>}
    {editing && <div className="api-input-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) closeEditor(); }}>
      <form className="api-input-modal api-global-modal" role="dialog" aria-modal="true" aria-labelledby="api-global-modal-title"
        onKeyDown={event => { if (event.key === "Escape" && !busy) { event.stopPropagation(); closeEditor(); } }}
        onSubmit={async e => {
          e.preventDefault(); setError(""); setBusy(true);
          try {
            const parsed: Json = type === "string" ? value : JSON.parse(value);
            await bridge.setGlobal(scope, name, parsed); await refresh(); closeEditor(); onSaved?.();
          } catch { setError("변수 이름(영문 시작, 영문·숫자·밑줄)과 값의 형식을 확인하세요. 실행 중에는 변경할 수 없습니다."); }
          finally { setBusy(false); }
        }}>
        <header><div><p className="api-input-kicker">전역변수</p><h2 id="api-global-modal-title">{editing.existing ? `${name} 수정` : "변수 추가"}</h2></div></header>
        <fieldset disabled={busy}><div className="api-global-form-grid">
          <label>변수 이름<input aria-label="전역변수 이름" required autoFocus={editing.focus === "name"} pattern="[A-Za-z][A-Za-z0-9_]*" value={name} onChange={e => setName(e.target.value)} placeholder="accessToken" /></label>
          <label>값 형식<select aria-label="전역변수 형식" value={type} onChange={e => setType(e.target.value)}><option value="string">문자열</option><option value="json">JSON · 숫자, 불리언, 객체, 배열</option></select></label>
          <label className="api-global-form-value">값<input aria-label="전역변수 값" autoFocus={editing.focus === "value"} className={showValues ? undefined : "api-secret-input"} type="text" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} /></label>
        </div></fieldset>
        {error && <p role="alert" className="api-warning">{error}</p>}
        <footer className="api-actions"><button type="button" disabled={busy} onClick={closeEditor}>취소</button><button className="api-primary" disabled={busy}>전역변수 저장</button></footer>
      </form>
    </div>}
    <section className="api-cookie-list" aria-label="세션 쿠키">
      <header className="api-globals-section-heading"><h3>세션 쿠키 <small>{cookies.length}개</small></h3><button type="button" aria-label="쿠키 비우기" disabled={busy || !cookies.length} onClick={async () => { setBusy(true); setError(""); try { await bridge.clearCookies(scope); await refreshCookies(); } catch { setError("쿠키를 비우지 못했습니다. 실행 중에는 비울 수 없습니다."); } finally { setBusy(false); } }}>비우기</button></header>
      <p className="api-field-help">응답의 Set-Cookie를 다음 요청에 자동으로 보냅니다. 값은 표시하지 않습니다.</p>
      {cookies.length > 0 && <ul>{cookies.map(cookie => <li key={`${cookie.domain}${cookie.path}${cookie.name}`}><code>{cookie.name}</code><small>{cookie.domain}{cookie.path}</small></li>)}</ul>}
    </section>
    {error && !editing && <p role="alert" className="api-warning">{error}</p>}
  </section>;
}
