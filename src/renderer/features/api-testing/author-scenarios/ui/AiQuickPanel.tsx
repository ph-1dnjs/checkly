import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AiResultReview } from "./AiResultReview";
import { problemReport } from "../model/problem-report";
import type { ApiAiQuick, ApiEnvironmentScope, ApiProject, ApiTestingBridge, SavedApiScenario } from "../../../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

/**
 * 바로 만들기: the user writes what to test, the AI makes it without asking, Checkly checks it (problems
 * go back to the AI on their own). Like the terminal, the page holds the conversation (requests and the
 * AI's answers, the input at the bottom) and the result opens in a panel over its right side.
 * 내용 바꾸기 (before saving) continues the same AI session; after saving, a failed run's AI로 고치기 starts a new one.
 */
export function AiQuickPanel({ project, scope, bridge, onBusy, onSaved, onOpenSpecs, toolChoice, noSpec, specNote }: {
  project: ApiProject; scope: ApiEnvironmentScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onSaved: (first?: SavedApiScenario) => void;
  /** API 문서 tab, where a missing spec is imported again. */
  onOpenSpecs?: () => void;
  noSpec: boolean; specNote: string;
  /** Which AI a new request uses, shown in the first input. */
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
  const [sideOpen, setSideOpen] = useState(false);
  const live = useRef(true);
  const log = useRef<HTMLDivElement>(null);
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
  const check = quick?.check;
  const savedThis = Boolean(check && quick?.saved?.modifiedAt === check.modifiedAt);
  const unsaved = Boolean(check && !savedThis);
  // A new result not saved yet opens the panel (also when coming back to the tab).
  useEffect(() => { if (unsaved && !running) setSideOpen(true); }, [check?.modifiedAt, running]);
  // The newest message stays in view.
  const lastNote = quick?.turns.at(-1)?.note;
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [quick?.turns.length, lastNote, quick?.progress, quick?.status]);

  const act = async (task: () => Promise<void>) => {
    if (pending) return;
    setPending(true); setError("");
    try { await task(); } catch (e) { if (live.current) setError(errorText(e)); } finally { if (live.current) setPending(false); }
  };
  const create = () => act(async () => {
    const next = await bridge.startAiQuick({ scope, request });
    if (live.current) { setQuick(next); setSideOpen(false); }
  });
  const revise = () => act(async () => {
    const next = await bridge.reviseAiQuick(projectId, revision);
    if (live.current) { setQuick(next); setRevision(""); setSideOpen(false); }
  });
  const startOver = () => act(async () => {
    if (unsaved && !window.confirm("저장하지 않은 결과가 사라집니다. 새로 만들까요?")) return;
    await bridge.clearAiQuick(projectId);
    if (live.current) { setQuick(null); setSideOpen(false); setRequest(quick?.turns[0]?.request ?? ""); }
  });
  const openSaved = async (scenarioId?: string) => {
    try {
      const first = scenarioId ? (await bridge.listScenarios(projectId)).find(item => item.id === scenarioId) : undefined;
      if (live.current) onSaved(first);
    } catch (e) { if (live.current) setError(errorText(e)); }
  };
  const onShortcut = (send: () => void, ready: boolean) => (e: KeyboardEvent) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) { e.preventDefault(); send(); } };

  if (loading) return <p role="status" className="api-field-help">불러오는 중…</p>;
  if (!quick) {
    return <section className="api-ai-quick" aria-label="바로 만들기">
      <h3 className="api-ai-quick-title">무엇을 테스트할까요?</h3>
      {/* A chat-style box: the request on top, the AI choice and 만들기 on its bottom bar. */}
      <div className="api-ai-composer">
        <textarea rows={3} aria-label="무엇을 테스트할까요?" value={request} disabled={pending || noSpec} placeholder={"예: 회원가입 후 로그인해서 내 정보를 조회하는 흐름. 비밀번호가 틀리면 로그인이 실패하는지도 확인"}
          onChange={e => setRequest(e.target.value)} onKeyDown={onShortcut(() => void create(), Boolean(request.trim()))} />
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

  const toolName = quick.tool === "claude" ? "Claude" : "Codex";
  const report = check ? problemReport(check.result) : "";
  const quickScope = { projectId, environmentId: quick.environmentId };
  const environmentName = (id: string) => project.environments.find(environment => environment.id === id)?.name ?? id;
  // No result to check: say what to do next instead of only that it failed.
  const failedWithoutResult = quick.status === "failed" && !check;
  // After an answer without a result the input goes on with the conversation.
  const nextLabel = failedWithoutResult ? "다시 요청" : check ? "내용 바꾸기" : "이어서 요청";
  const statusText = running ? "만드는 중" : quick.status === "done" ? (savedThis ? "저장함" : check ? "완료" : "답변함") : quick.status === "stopped" ? "중단됨" : "실패";
  return <section className="api-ai-quick is-active" aria-label="바로 만들기">
    <header className="api-ai-terminal-heading">
      <div className="api-ai-terminal-title">
        <strong>{toolName}로 만들기</strong>
        <small className="api-field-help">{environmentName(quick.environmentId)} · {statusText}</small>
      </div>
      <button type="button" disabled={pending || running || reviewBusy} onClick={() => void startOver()}>새로 만들기</button>
    </header>
    {quick.environmentId !== scope.environmentId && <p className="api-warning" role="note">이 결과는 {environmentName(quick.environmentId)} 환경 기준입니다. 현재 환경으로 만들려면 새로 만드세요.</p>}
    <div className="api-ai-terminal-body">
      <div className="api-ai-quick-chat">
        <div className="api-ai-quick-log" ref={log} aria-label="대화">
          {quick.turns.map((turn, index) => <div key={index} className="api-ai-quick-turn">
            <p className="api-ai-bubble is-user">{turn.request}</p>
            {turn.note && <div className="api-ai-bubble is-ai" aria-label="AI 메모"><strong>{toolName}</strong><p>{turn.note}</p></div>}
          </div>)}
          {running && <div className="api-ai-quick-progress" role="status">
            <span className="api-ai-quick-spinner" aria-hidden="true" />
            <span>{toolName}가 만드는 중{quick.progress ? ` · ${quick.progress}` : "…"}</span>
            <button type="button" disabled={pending} onClick={() => void act(() => bridge.stopAiQuick(projectId))}>중단</button>
          </div>}
          {quick.status === "stopped" && <p className="api-field-help" role="status">중단했습니다.</p>}
          {quick.error && (failedWithoutResult
            ? <div className="api-ai-quick-next" role="alert">
              <strong>{quick.error}</strong>
              <p>위 {toolName}의 답에서 이유를 확인한 뒤 다음 중 하나를 하세요.</p>
              <ul>
                <li>요청이 부족했다면 아래 입력창에 더 알려 주고 <strong>다시 요청</strong>하세요. 같은 대화로 이어집니다.</li>
                <li>필요한 API가 명세에 없다면 <button type="button" className="api-issue-step-link" onClick={onOpenSpecs}>API 문서</button>에서 명세를 다시 가져온 뒤 <strong>새로 만들기</strong>를 누르세요.</li>
              </ul>
            </div>
            : <p className="api-warning" role="alert">{quick.error}</p>)}
          {check && !running && !sideOpen && <p className="api-ai-quick-ready" role="status">{savedThis ? "저장했습니다." : `시나리오 ${check.result.drafts.length}개를 만들었습니다.`} <button type="button" className="api-issue-step-link" onClick={() => setSideOpen(true)}>결과 보기</button></p>}
        </div>
        {error && <p className="api-warning" role="alert">{error}</p>}
        {/* Before saving only: once saved, the run result's AI로 고치기 takes over. */}
        {savedThis ? <p className="api-ai-quick-after">실행해 보고 실패하면 실행 결과의 <strong>AI로 고치기</strong>로 고칠 수 있습니다.</p>
          : <div className="api-ai-composer">
            <textarea rows={2} aria-label={nextLabel} value={revision} disabled={pending || running || reviewBusy} placeholder={running ? "AI가 만드는 동안 기다려 주세요" : failedWithoutResult ? "더 알려 줄 내용 (예: 관리자 로그인 API는 POST /bos/login 이에요)" : !check ? "이어서 물어보거나 요청할 내용" : report ? "바꿀 내용 (예: 검사 문제를 고쳐 주세요)" : "바꿀 내용 (예: 로그인 실패 경우도 추가해 주세요)"}
              onChange={e => setRevision(e.target.value)} onKeyDown={onShortcut(() => void revise(), Boolean(revision.trim()) && !running)} />
            <div className="api-ai-composer-bar">
              <span className="api-ai-composer-hint">⌘/Ctrl + Enter</span>
              <button type="button" className="api-primary" disabled={pending || running || reviewBusy || !revision.trim()} onClick={() => void revise()}>{nextLabel}</button>
            </div>
          </div>}
      </div>
      {/* The result opens over the right side, from a handle that marks a result not saved yet (as in the terminal). */}
      {check && !running && !sideOpen && <button type="button" className={`api-ai-result-handle${unsaved ? " has-pending" : ""}`} aria-label={unsaved ? "결과 열기 (저장 전)" : "결과 열기"}
        title={unsaved ? "저장하지 않은 결과가 있습니다" : "결과 열기"} onClick={() => setSideOpen(true)}>결과{unsaved && <span className="api-ai-result-dot" aria-hidden="true" />}</button>}
      {check && !running && sideOpen && <aside className="api-ai-terminal-side" aria-label="AI 결과">
        <header className="api-ai-terminal-side-head"><strong>결과</strong><button type="button" className="api-icon-button" aria-label="결과 닫기" title="결과 닫기" onClick={() => setSideOpen(false)}>×</button></header>
        {savedThis
          ? <div className="api-ai-quick-saved">
            <p role="status">저장했습니다.</p>
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
            notes={report && <div className="api-ai-author-notes">{quick.fixes ? `AI가 ${quick.fixes}번 고쳤지만 문제가 남았습니다. ` : "검사에서 문제가 나왔습니다. "}왼쪽 아래 내용 바꾸기에 바꿀 점을 적거나, 그대로 저장하면 초안이 됩니다.</div>} />}
      </aside>}
    </div>
  </section>;
}
