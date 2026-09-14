import { useEffect, useRef, useState } from "react";
import type { ApiOperation, ApiResponse, ApiScope, ApiTestingBridge } from "../../../app/api-testing/shared/workspace";
import type { Json, Scenario } from "../../../app/api-testing/shared/scenario";
import { useRunAction } from "./useRunAction";
import type { OnRunAction } from "./useRunAction";
import { ResponseDefinitions } from "./ResponseDefinitions";

export function RequestPanel({ operation, scope, bridge, onBusy, onRunAction }: { operation: ApiOperation; scope: ApiScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onRunAction: OnRunAction }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [headers, setHeaders] = useState("{}");
  const [body, setBody] = useState(operation.bodyExample === undefined ? "" : JSON.stringify(operation.bodyExample, null, 2));
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void bridge.cancel(scope); };
  }, []);
  const run = async () => {
    setError(""); setResult(null);
    let request: Scenario["steps"][number]["request"];
    try {
      const extra = JSON.parse(headers);
      if (!extra || Array.isArray(extra) || typeof extra !== "object" || Object.values(extra).some(v => typeof v !== "string")) throw new Error("헤더는 문자열 값의 JSON 객체로 입력하세요");
      request = { headers: extra, pathParams: {}, query: {}, cookies: {} };
      for (const p of operation.parameters) {
        const text = values[`${p.location}:${p.name}`] ?? "";
        if (!text && !p.required) continue;
        let value: Json = text;
        if (text && p.location !== "header" && !text.includes("{{")) {
          if (["number", "integer"].includes(p.type)) {
            value = Number(text);
            if (!Number.isFinite(value) || p.type === "integer" && !Number.isInteger(value)) throw new Error(`${p.name}: 숫자를 입력하세요`);
          }
          if (p.type === "boolean") {
            if (!["true", "false"].includes(text)) throw new Error(`${p.name}: true 또는 false를 입력하세요`);
            value = text === "true";
          }
        }
        if (p.location === "header") request.headers![p.name] = text;
        else if (p.location === "cookie") request.cookies![p.name] = value;
        else if (p.location === "path") request.pathParams![p.name] = value;
        else if (p.location === "query") request.query![p.name] = value;
      }
      if (body.trim()) request.body = JSON.parse(body);
    } catch (e) { setError(e instanceof SyntaxError ? "헤더 또는 본문의 JSON 문법을 확인하세요" : (e as Error).message); return; }
    setBusy(true); onBusy(true);
    try { const response = await bridge.execute(scope, operation.key, request); if (mounted.current) setResult(response); }
    catch (e) { if (mounted.current) setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "")); }
    finally { if (mounted.current) { setBusy(false); onBusy(false); } }
  };
  useRunAction(onRunAction, () => { void run(); }, busy || operation.warnings.length > 0);
  return <article className="api-request-panel">
    <header><span className="api-method">{operation.method}</span><code>{operation.path}</code></header>
    <h2>{operation.summary}</h2>
    <p className="api-description">{operation.description || "명세에 추가 설명이 없습니다."}</p>
    {operation.warnings.map(w => <p className="api-warning" key={w}>{w}</p>)}
    <fieldset disabled={busy}>
      <legend>Parameters · 요청 파라미터</legend>
      {!operation.parameters.length && <p>No parameters · 요청 파라미터가 없습니다.</p>}
      {operation.parameters.map(p => <label key={`${p.location}:${p.name}`}>
        {p.name} {p.required ? "*" : ""} <small>{p.location} · {p.type}</small>
        <input aria-label={`${p.location} ${p.name}`} value={values[`${p.location}:${p.name}`] ?? ""} placeholder={p.example === undefined ? "값 입력" : String(p.example)} onChange={e => setValues({ ...values, [`${p.location}:${p.name}`]: e.target.value })} />
        {p.description && <small>{p.description}</small>}
      </label>)}
      <details><summary>추가 요청 헤더</summary><label>추가 헤더 · JSON<textarea aria-label="추가 헤더 JSON" spellCheck={false} value={headers} onChange={e => setHeaders(e.target.value)} rows={3} /></label></details>
    </fieldset>
    {(operation.bodySchema !== undefined || operation.bodyExample !== undefined || operation.bodyRequired) && <fieldset disabled={busy}><legend>Request body {operation.bodyRequired ? "· required" : ""}</legend><p>application/json</p><label>Example Value · 요청 본문<textarea aria-label="요청 본문 JSON" spellCheck={false} value={body} onChange={e => setBody(e.target.value)} rows={8} /></label><details><summary>Schema</summary><pre>{JSON.stringify(operation.bodySchema, null, 2)}</pre></details></fieldset>}
    <div className="api-actions"><button className="api-primary" disabled={busy || operation.warnings.length > 0} onClick={() => void run()}>{busy ? "호출 중…" : "API 호출"}</button>{busy && <button onClick={() => void bridge.cancel(scope)}>취소</button>}<small>민감값 마스킹 적용 · 최대 30초</small></div>
    {error && <p className="api-warning" role="alert">{error}</p>}
    <ResponseDefinitions responses={operation.responses} />
    <section aria-label="API 응답" aria-live="polite" className="api-response">
      <h3>응답 {result?.httpStatus !== undefined && <span>HTTP {result.httpStatus} · {result.durationMs}ms</span>}</h3>
      {!result ? <p>요청을 실행하면 응답이 여기에 표시됩니다.</p> : <><p>{result.status}{result.error && ` · ${result.error}`}</p><details><summary>응답 헤더</summary><pre>{JSON.stringify(result.headers, null, 2)}</pre></details><pre>{JSON.stringify(result.body, null, 2)}</pre></>}
    </section>
  </article>;
}
