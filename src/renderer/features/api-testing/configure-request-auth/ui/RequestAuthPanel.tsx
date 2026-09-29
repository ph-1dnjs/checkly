import { useEffect, useState } from "react";
import type { ApiGlobal, ApiScope, ApiTestingBridge } from "../../../../../app/api-testing/shared/workspace";

export function RequestAuthPanel({ scope, bridge }: { scope: ApiScope; bridge: ApiTestingBridge }) {
  const [variables, setVariables] = useState<ApiGlobal[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [token, setToken] = useState("");
  const [tokenName, setTokenName] = useState("docsToken");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const refresh = async () => {
    const [values, reference] = await Promise.all([bridge.listGlobals({ projectId: scope.projectId }), bridge.getRequestAuth(scope)]);
    setVariables(values); setActive(reference); setSelected(reference ?? "");
  };
  useEffect(() => { let live = true;
    void Promise.all([bridge.listGlobals({ projectId: scope.projectId }), bridge.getRequestAuth(scope)]).then(([values, reference]) => {
      if (live) { setVariables(values); setActive(reference); setSelected(reference ?? ""); }
    }).catch(() => { if (live) setError("인증 정보를 읽지 못했습니다. 앱 재실행 후 확인하세요."); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, []);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); await refresh(); }
    catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); }
    finally { setToken(""); setBusy(false); }
  };
  return <section className="api-auth-panel"><h2>API 요청 인증</h2>
    <p>이 연결은 <strong>API 문서에서 개별 API를 호출할 때</strong>만 현재 프로젝트·환경·서버에 Bearer 토큰으로 붙습니다. 시나리오는 편집 화면의 인증 설정을 따르고, 명세 가져오기용 Basic 인증과도 별개입니다.</p>
    <p role="status">{active ? `연결: globals.${active}` : "연결된 인증 없음"}</p>
    {active && !variables.some(v => v.name === active && v.type === "string") && <p className="api-warning">연결된 변수가 없거나 문자열이 아닙니다. 요청이 차단됩니다.</p>}
    <fieldset disabled={busy}><legend>기존 전역변수 사용</legend><label>토큰 변수<select aria-label="API 인증 전역변수" value={selected} onChange={e => setSelected(e.target.value)}><option value="">변수 선택</option>{variables.filter(v => v.type === "string").map(v => <option key={v.name} value={v.name}>{v.name}</option>)}</select></label>
      <div className="api-actions"><button disabled={!selected} onClick={() => void perform(() => bridge.setRequestAuth(scope, selected))}>인증에 연결</button><button onClick={() => void perform(() => bridge.setRequestAuth(scope, null))}>인증 해제</button><button onClick={() => void perform(async () => {})}>목록 새로고침</button></div>
    </fieldset>
    <form onSubmit={e => { e.preventDefault(); void perform(async () => {
      if (!token.trim() || /\s/.test(token) || /^Bearer\b/i.test(token)) throw new Error("Bearer 접두사·공백 없이 토큰만 입력하세요");
      const name = tokenName.trim();
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error("변수 이름은 영문으로 시작하는 영문·숫자·밑줄을 사용하세요");
      // Same name = overwrite, so pasting a fresh token doesn't pile up variables.
      await bridge.setGlobal({ projectId: scope.projectId }, name, token);
      await bridge.setRequestAuth(scope, name);
    }); }}><fieldset disabled={busy}><legend>새 토큰 직접 입력</legend>
      <label>Bearer 토큰<input aria-label="새 API 인증 토큰" data-value-visibility="sensitive" type="text" autoComplete="off" required value={token} onChange={e => setToken(e.target.value)} /></label>
      <label>저장할 전역변수 이름<input aria-label="토큰 전역변수 이름" data-value-visibility="public" autoComplete="off" required value={tokenName} onChange={e => setTokenName(e.target.value)} /><small>같은 이름이면 값을 덮어씁니다. 시나리오의 인증에서도 이 이름으로 고를 수 있습니다.</small></label>
      <button className="api-primary">토큰 저장 후 연결</button>
    </fieldset></form>
    <p>토큰과 연결은 앱 종료 시 초기화됩니다. 토큰 값은 호출 시점에 읽으므로 재로그인 후 갱신된 값이 적용됩니다. 개별 Authorization 헤더와 중복되면 호출을 차단합니다.</p>
    {error && <p role="alert" className="api-warning">{error}</p>}
  </section>;
}
