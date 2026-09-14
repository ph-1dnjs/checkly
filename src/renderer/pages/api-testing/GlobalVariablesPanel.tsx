import { useEffect, useState } from "react";
import type { ApiGlobal, ApiEnvironmentScope, ApiTestingBridge } from "../../../app/api-testing/shared/workspace";
import type { Json } from "../../../app/api-testing/shared/scenario";

export function GlobalVariablesPanel({ scope, bridge }: { scope: ApiEnvironmentScope; bridge: ApiTestingBridge }) {
  const [variables, setVariables] = useState<ApiGlobal[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [type, setType] = useState("string");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => setVariables(await bridge.listGlobals(scope));
  useEffect(() => { void refresh().catch(() => setError("전역변수를 읽지 못했습니다")); }, []);
  return <section className="api-globals-panel">
    <h2>전역변수</h2>
    <p>현재 프로젝트·환경의 개별 API와 시나리오에서 공유합니다. 값은 마스킹되며 <strong>앱을 종료하면 초기화</strong>됩니다.</p>
    <p><code>{"{{globals.accessToken}}"}</code>처럼 요청에 사용하세요. 같은 이름으로 저장하면 값을 교체합니다.</p>
    <div className="api-global-list">{variables.length === 0 && <p>저장된 변수가 없습니다.</p>}{variables.map(v => <div className="api-global-row" key={v.name}><code>{v.name}</code><span>{v.type} · {v.displayValue}</span><button disabled={busy} onClick={() => { setName(v.name); setValue(""); setType(v.type === "string" ? "string" : "json"); }}>값 교체</button><button disabled={busy} onClick={async () => { setBusy(true); try { await bridge.deleteGlobal(scope, v.name); await refresh(); } catch { setError("변수를 삭제하지 못했습니다"); } finally { setBusy(false); } }}>삭제</button></div>)}</div>
    <form onSubmit={async e => {
      e.preventDefault(); setError(""); setBusy(true);
      try {
        const parsed: Json = type === "string" ? value : JSON.parse(value);
        await bridge.setGlobal(scope, name, parsed); await refresh(); setValue(""); setName("");
      } catch { setError("변수 이름(영문 시작, 영문·숫자·밑줄)과 값의 형식을 확인하세요. 실행 중에는 변경할 수 없습니다."); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}><legend>변수 추가·교체</legend><label>변수 이름<input aria-label="전역변수 이름" required pattern="[A-Za-z][A-Za-z0-9_]*" value={name} onChange={e => setName(e.target.value)} placeholder="accessToken" /></label><label>값 형식<select aria-label="전역변수 형식" value={type} onChange={e => setType(e.target.value)}><option value="string">문자열</option><option value="json">JSON · 숫자, 불리언, 객체, 배열</option></select></label><label>새 값<input aria-label="전역변수 값" type="password" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} /></label><button className="api-primary">전역변수 저장</button></fieldset>
    </form>
    {error && <p role="alert" className="api-warning">{error}</p>}
  </section>;
}
