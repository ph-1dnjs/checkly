import { useEffect, useState } from "react";
import type { ApiProject, ApiEnvironmentScope, ApiTestingBridge, ApiOperation } from "../../../app/api-testing/shared/workspace";

export function AiContextPanel({ project, scope, bridge }: {
  project: ApiProject; scope: ApiEnvironmentScope; bridge: ApiTestingBridge;
}) {
  const [operations, setOperations] = useState<Array<{ serverId: string; serverName: string; operation: ApiOperation }>>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [goal, setGoal] = useState("");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let live = true;
    void Promise.all(project.servers.map(async server => ({ server, catalog: await bridge.getCatalog({ ...scope, serverId: server.id }) })))
      .then(items => { if (live) setOperations(items.flatMap(({ server, catalog }) => (catalog?.operations ?? []).map(operation => ({ serverId: server.id, serverName: server.name, operation })))); })
      .catch(() => { if (live) setError("API 목록을 불러오지 못했습니다. 명세를 확인하세요."); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, []);
  const key = (serverId: string, operationKey: string) => JSON.stringify([serverId, operationKey]);
  const invalidate = () => { setPreview(""); setMessage(""); setError(""); };
  const request = () => ({ scope, goal, selections: operations.filter(o => selected.includes(key(o.serverId, o.operation.key))).map(o => ({ serverId: o.serverId, operationKey: o.operation.key })) });
  return <section className="api-ai-context">
    <h2>AI 작성용 정보 내보내기</h2>
    <p>필요한 API와 업무 목표를 선택하고, 생성된 정보를 외부 AI에 붙여넣으세요. AI가 만든 YAML은 시나리오 탭에서 가져옵니다.</p>
    <label>만들고 싶은 시나리오<textarea aria-label="AI 시나리오 업무 목표" rows={3} maxLength={10000} disabled={busy} placeholder="예: 회원 로그인 후 문의를 등록하고 관리자 답변을 확인해줘" value={goal} onChange={e => { setGoal(e.target.value); invalidate(); }} /></label>
    <p>실제 서버 URL·전역변수 값·실행 이력·명세 예제값은 제외합니다. 명세 설명과 직접 작성한 목표는 포함되므로 복사 전에 확인하세요.</p>
    <input aria-label="AI 내보내기 API 검색" value={query} onChange={e => setQuery(e.target.value)} placeholder="서버·경로·설명 검색" />
    <fieldset disabled={busy}><legend>포함할 API · {selected.length}개 선택</legend>
      {!operations.length && <p>{busy ? "API 목록을 읽는 중…" : "현재 환경에 가져온 API가 없습니다. API 문서 탭에서 명세를 가져오세요."}</p>}
      {operations.filter(o => `${o.serverName} ${o.operation.path} ${o.operation.summary}`.toLowerCase().includes(query.toLowerCase())).map(o => {
        const id = key(o.serverId, o.operation.key);
        return <label className="api-export-choice" key={id}>
          <input type="checkbox" disabled={o.operation.warnings.length > 0} checked={selected.includes(id)} onChange={e => { setSelected(e.target.checked ? [...selected, id] : selected.filter(v => v !== id)); invalidate(); }} />
          <span><strong>{o.serverName} · {o.operation.method} {o.operation.path}</strong><small>{o.operation.summary}{o.operation.warnings.length ? " · 지원하지 않는 형식" : ""}</small></span>
        </label>;
      })}
    </fieldset>
    <div className="api-actions"><button disabled={busy || !selected.length} onClick={async () => {
      setBusy(true); setError(""); setMessage("");
      try { setPreview(await bridge.buildAiContext(request())); }
      catch { setError("정보를 만들지 못했습니다. 선택한 API와 크기(최대 100개)를 확인하세요."); }
      finally { setBusy(false); }
    }}>AI 전달 정보 미리보기</button><button className="api-primary" disabled={busy || !preview} onClick={async () => {
      setBusy(true); setError("");
      try { await bridge.copyAiContext(request()); setMessage("AI 작성용 정보를 복사했습니다. 외부 AI에 붙여넣으세요."); }
      catch { setError("복사하지 못했습니다. 다시 미리보기를 생성해 주세요."); }
      finally { setBusy(false); }
    }}>AI 작성용 정보 복사</button></div>
    {error && <p className="api-warning" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {preview && <label>전달할 정보 · {preview.length.toLocaleString()}자<textarea aria-label="AI 전달 정보" readOnly rows={20} value={preview} /></label>}
  </section>;
}
