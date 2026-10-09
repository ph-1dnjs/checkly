import { useEffect, useRef, useState, type ReactNode } from "react";
import { AiResultReview } from "./AiResultReview";
import { problemReport } from "../model/problem-report";
import type { ApiAiQuick, ApiEnvironmentScope, ApiProject, ApiTestingBridge, SavedApiScenario } from "../../../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

/**
 * 바로 만들기: the user writes what to test, the AI makes it without asking, Checkly checks it (problems
 * go back to the AI on their own) and only the result is shown. 내용 바꾸기 (before saving) continues the same AI
 * session; after saving, a failed run's AI로 고치기 starts a new one with that run.
 */
export function AiQuickPanel({ project, scope, bridge, onBusy, onSaved, toolChoice, noSpec, specNote }: {
  project: ApiProject; scope: ApiEnvironmentScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onSaved: (first?: SavedApiScenario) => void;
  noSpec: boolean; specNote: string;
  /** Which AI a new request uses, shown next to 만들기. */
  toolChoice?: ReactNode;
}) {
  const projectId = scope.projectId;
  const [quick, setQuick] = useState<ApiAiQuick | null>(null);
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState("");
  const [revision, setRevision] = useState("");
  const [pending, setPending] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    const unsubscribe = bridge.onAiQuickEvent(event => { if (event.projectId === projectId && live.current) setQuick(event.quick); });
    void bridge.getAiQuick(projectId).then(current => { if (live.current) { setQuick(current); setLoading(false); } })
      .catch(e => { if (live.current) { setError(errorText(e)); setLoading(false); } });
    return () => { live.current = false; unsubscribe(); };
  }, [bridge, projectId]);
  const running = quick?.status === "running";
  useEffect(() => { onBusy(pending || running || reviewBusy); }, [pending, running, reviewBusy, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);

  const act = async (task: () => Promise<void>) => {
    if (pending) return;
    setPending(true); setError("");
    try { await task(); } catch (e) { if (live.current) setError(errorText(e)); } finally { if (live.current) setPending(false); }
  };
  const create = () => act(async () => {
    const next = await bridge.startAiQuick({ scope, request });
    if (live.current) setQuick(next);
  });
  const revise = () => act(async () => {
    const next = await bridge.reviseAiQuick(projectId, revision);
    if (live.current) { setQuick(next); setRevision(""); }
  });
  const startOver = () => act(async () => {
    if (quick?.check && quick.saved?.modifiedAt !== quick.check.modifiedAt && !window.confirm("저장하지 않은 결과가 사라집니다. 새로 만들까요?")) return;
    await bridge.clearAiQuick(projectId);
    if (live.current) { setQuick(null); setRequest(quick?.requests[0] ?? ""); }
  });
  const openSaved = async (scenarioId?: string) => {
    try {
      const first = scenarioId ? (await bridge.listScenarios(projectId)).find(item => item.id === scenarioId) : undefined;
      if (live.current) onSaved(first);
    } catch (e) { if (live.current) setError(errorText(e)); }
  };

  const environmentName = (id: string) => project.environments.find(environment => environment.id === id)?.name ?? id;
  if (loading) return <p role="status" className="api-field-help">불러오는 중…</p>;
  if (!quick) {
    return <section className="api-ai-quick" aria-label="바로 만들기">
      <h3 className="api-ai-quick-title">무엇을 테스트할까요?</h3>
      {/* A chat-style box: the request on top, the AI choice and 만들기 on its bottom bar. */}
      <div className="api-ai-composer">
        <textarea rows={3} aria-label="무엇을 테스트할까요?" value={request} disabled={pending || noSpec} placeholder={"예: 회원가입 후 로그인해서 내 정보를 조회하는 흐름. 비밀번호가 틀리면 로그인이 실패하는지도 확인"}
          onChange={e => setRequest(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && request.trim()) { e.preventDefault(); void create(); } }} />
        <div className="api-ai-composer-bar">
          {toolChoice}
          <span className="api-ai-composer-hint">⌘/Ctrl + Enter</span>
          <button type="button" className="api-primary" disabled={pending || noSpec || !request.trim()} title={noSpec ? "명세를 먼저 가져오세요" : undefined} onClick={() => void create()}>{pending ? "시작하는 중…" : "만들기"}</button>
        </div>
      </div>
      <p className="api-field-help">AI가 백엔드 코드를 읽고 질문 없이 바로 만듭니다. 결과를 확인하고 저장하세요.</p>
      {specNote && <div className="api-warning" role="note">{specNote}</div>}
      {error && <p className="api-warning" role="alert">{error}</p>}
    </section>;
  }

  const check = quick.check;
  const savedThis = Boolean(check && quick.saved?.modifiedAt === check.modifiedAt);
  const report = check ? problemReport(check.result) : "";
  const quickScope = { projectId, environmentId: quick.environmentId };
  return <section className="api-ai-quick" aria-label="바로 만들기">
    <div className="api-ai-quick-asked">
      <span>요청</span>
      <ol>{quick.requests.map((item, index) => <li key={index}>{item}</li>)}</ol>
      <button type="button" disabled={pending || running || reviewBusy} onClick={() => void startOver()}>새로 만들기</button>
    </div>
    {quick.environmentId !== scope.environmentId && <p className="api-warning" role="note">이 결과는 {environmentName(quick.environmentId)} 환경 기준입니다. 현재 환경으로 만들려면 새로 만드세요.</p>}
    {running && <div className="api-ai-quick-progress" role="status">
      <span className="api-ai-quick-spinner" aria-hidden="true" />
      <span>{quick.tool === "claude" ? "Claude" : "Codex"}가 만드는 중{quick.progress ? ` · ${quick.progress}` : "…"}</span>
      <button type="button" disabled={pending} onClick={() => void act(() => bridge.stopAiQuick(projectId))}>중단</button>
    </div>}
    {quick.status === "stopped" && <p className="api-field-help" role="status">중단했습니다.</p>}
    {quick.error && <p className="api-warning" role="alert">{quick.error}</p>}
    {error && <p className="api-warning" role="alert">{error}</p>}
    {quick.note && !running && <div className="api-ai-quick-note" aria-label="AI 메모"><strong>AI 메모</strong><p>{quick.note}</p></div>}
    {check && !running && (savedThis
      ? <div className="api-ai-quick-saved">
        <p role="status">저장했습니다. 실행해 보고 실패하면 실행 결과의 <strong>AI로 고치기</strong>로 고칠 수 있습니다.</p>
        <button type="button" className="api-primary" onClick={() => void openSaved(quick.saved?.scenarioId)}>시나리오 보기·실행</button>
      </div>
      : <AiResultReview key={check.modifiedAt} result={check.result} scope={quickScope} bridge={bridge} onBusy={setReviewBusy}
        onSaved={first => {
          setReviewBusy(false);
          const saved = { modifiedAt: check.modifiedAt, ...(first ? { scenarioId: first.id } : {}) };
          setQuick(current => current && { ...current, saved });
          void bridge.markAiQuickResultSaved(projectId, saved).catch(() => undefined);
          // The AI reads the saved scenarios before the next request.
          void bridge.refreshAiTerminalFiles(quickScope).catch(() => undefined);
        }}
        notes={report && <div className="api-ai-author-notes">{quick.fixes ? `AI가 ${quick.fixes}번 고쳤지만 문제가 남았습니다. ` : "검사에서 문제가 나왔습니다. "}아래 내용 바꾸기에 바꿀 점을 적거나, 그대로 저장하면 초안이 됩니다.</div>} />)}
    {/* Before saving only: once saved, the run result's AI로 고치기 takes over. */}
    {!running && !savedThis && <div className="api-ai-composer api-ai-quick-revise">
      <textarea rows={2} aria-label="내용 바꾸기" value={revision} disabled={pending || reviewBusy} placeholder={report ? "바꿀 내용 (예: 검사 문제를 고쳐 주세요)" : "바꿀 내용 (예: 로그인 실패 경우도 추가해 주세요)"}
        onChange={e => setRevision(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && revision.trim()) { e.preventDefault(); void revise(); } }} />
      <div className="api-ai-composer-bar">
        <span className="api-ai-composer-hint">⌘/Ctrl + Enter</span>
        <button type="button" className="api-primary" disabled={pending || reviewBusy || !revision.trim()} onClick={() => void revise()}>내용 바꾸기</button>
      </div>
    </div>}
  </section>;
}
