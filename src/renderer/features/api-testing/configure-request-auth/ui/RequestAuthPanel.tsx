import { useEffect, useState } from "react";
import type { ApiGlobal, ApiScope, ApiTestingBridge } from "../../../../../app/api-testing/shared/workspace";

const NEW_TOKEN = "\u0000new";

/** Connects a string global as the Bearer token for the API docs' own calls (not scenarios). */
export function RequestAuthPanel({ scope, bridge }: { scope: ApiScope; bridge: ApiTestingBridge }) {
  const [variables, setVariables] = useState<ApiGlobal[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [token, setToken] = useState("");
  const [tokenName, setTokenName] = useState("docsToken");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const load = () => Promise.all([bridge.listGlobals({ projectId: scope.projectId }), bridge.getRequestAuth(scope)]);
  const apply = ([values, reference]: [ApiGlobal[], string | null]) => {
    setVariables(values); setActive(reference);
    // Point at what is connected; with no string variables yet, start on entering a new token.
    setChoice(reference ?? (values.some(v => v.type === "string") ? "" : NEW_TOKEN));
  };
  const refresh = async () => apply(await load());
  useEffect(() => { let live = true;
    void load().then(result => { if (live) apply(result); }).catch(() => { if (live) setError("인증 정보를 읽지 못했습니다. 앱 재실행 후 확인하세요."); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, []);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); await refresh(); }
    catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); }
    finally { setToken(""); setBusy(false); }
  };
  const strings = variables.filter(v => v.type === "string");
  // With no string globals there is nothing to pick, so a new token is the only way.
  const newToken = choice === NEW_TOKEN || !strings.length;
  const unchanged = !newToken && choice === active;
  return <section className="api-auth-panel">
    <div className="api-auth-status" role="status">
      {active ? <span>연결됨 · <code>{active}</code></span> : <span>연결된 토큰 없음</span>}
      {active && <button type="button" disabled={busy} onClick={() => void perform(() => bridge.setRequestAuth(scope, null))}>연결 해제</button>}
    </div>
    {active && !strings.some(v => v.name === active) && <p className="api-warning">연결된 전역변수가 없거나 문자열이 아니어서 요청이 차단됩니다.</p>}
    <form onSubmit={e => { e.preventDefault(); void perform(async () => {
      if (!newToken) { await bridge.setRequestAuth(scope, choice); return; }
      if (!token.trim() || /\s/.test(token) || /^Bearer\b/i.test(token)) throw new Error("Bearer 접두사·공백 없이 토큰만 입력하세요");
      const name = tokenName.trim();
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error("이름은 영문으로 시작하는 영문·숫자·밑줄을 사용하세요");
      // Same name = overwrite, so pasting a fresh token doesn't pile up variables.
      await bridge.setGlobal({ projectId: scope.projectId }, name, token);
      await bridge.setRequestAuth(scope, name);
    }); }}><fieldset disabled={busy}>
      {/* Nothing to pick yet: skip the list and go straight to entering a token. */}
      {strings.length ? <label>토큰<select aria-label="API 인증 전역변수" value={choice} onChange={e => { setChoice(e.target.value); setError(""); }}>
        <option value="" disabled>전역변수 선택</option>
        {strings.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
        <option value={NEW_TOKEN}>+ 새 토큰 입력</option>
      </select></label> : <p className="api-auth-note">저장된 문자열 전역변수가 없어 새 토큰을 입력합니다.</p>}
      {newToken && <div className="api-auth-new">
        <label>토큰 값<input aria-label="새 API 인증 토큰" data-value-visibility="sensitive" type="text" autoComplete="off" required placeholder="Bearer 없이 토큰만" value={token} onChange={e => setToken(e.target.value)} /></label>
        <label>저장할 전역변수 이름<input aria-label="토큰 전역변수 이름" data-value-visibility="public" autoComplete="off" required value={tokenName} onChange={e => setTokenName(e.target.value)} /><small>같은 이름이면 값을 덮어씁니다.</small></label>
      </div>}
      {error && <p role="alert" className="api-warning">{error}</p>}
      {/* Dialog footer like the app's other dialogs: note on the left, the action on the right. */}
      <div className="api-auth-footer">
        <p className="api-auth-note">API 문서의 개별 호출에만 Bearer 토큰으로 붙습니다. 앱을 끄면 토큰과 연결이 초기화됩니다.</p>
        <button className="api-primary" disabled={(!newToken && !choice) || unchanged}>{newToken ? "저장 후 연결" : "연결"}</button>
      </div>
    </fieldset></form>
  </section>;
}
