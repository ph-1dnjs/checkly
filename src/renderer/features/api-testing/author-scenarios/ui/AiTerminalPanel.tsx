import { useEffect, useRef, useState, type ReactNode } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { AiResultReview } from "./AiResultReview";
import { problemReport } from "../model/problem-report";
import type { ApiAiImportResult, ApiAiTerminal, ApiAiTool, ApiEnvironmentScope, ApiProject, ApiTestingBridge, SavedApiScenario } from "../../../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");
/** Pasted as one block so a multi-line problem list is not sent line by line. */
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;

/**
 * The user's Claude Code or Codex running in a terminal inside the app. The CLI shows the conversation
 * itself; Checkly checks the result file whenever the AI saves it and shows the save screen below.
 */
export function AiTerminalPanel({ project, scope, bridge, onBusy, onSaved, toolName, toolChoice, noSpec, specNote }: {
  project: ApiProject; scope: ApiEnvironmentScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onSaved: (first?: SavedApiScenario) => void;
  /** The AI a new session uses, e.g. "Claude". */
  toolName: string; noSpec: boolean; specNote: string;
  /** Which AI the next start uses, shown before the button; locked to the session's AI while one exists. */
  toolChoice?: (lockedTool?: ApiAiTool) => ReactNode;
}) {
  const [session, setSession] = useState<Omit<ApiAiTerminal, "buffer"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"starting" | "clearing" | null>(null);
  const [error, setError] = useState("");
  const [check, setCheck] = useState<{ modifiedAt: string; result: ApiAiImportResult } | null>(null);
  const [checkError, setCheckError] = useState("");
  const [saved, setSaved] = useState<{ modifiedAt: string; scenarioId?: string } | null>(null);
  const [sent, setSent] = useState("");
  // The results column: closed until there is a result, opened again by each new save of it.
  const [sideOpen, setSideOpen] = useState(false);
  // A result not saved yet opens it (also after a restart); an already saved one stays closed.
  const unsaved = Boolean(check && saved?.modifiedAt !== check.modifiedAt);
  useEffect(() => { if (unsaved) setSideOpen(true); }, [check?.modifiedAt, saved?.modifiedAt]);
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const live = useRef(true);
  // Read by the terminal event handler, which is set up once.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const projectId = scope.projectId;
  const sessionScope = session ? { projectId, environmentId: session.environmentId } : scope;
  const differentEnvironment = Boolean(session && session.environmentId !== scope.environmentId);
  const environmentName = (id: string) => project.environments.find(environment => environment.id === id)?.name ?? id;

  const size = () => ({ cols: Math.max(20, terminal.current?.cols ?? 100), rows: Math.max(5, terminal.current?.rows ?? 30) });
  const runCheck = async (checkScope: ApiEnvironmentScope) => {
    try {
      const next = await bridge.checkAiTerminalResult(checkScope);
      if (!live.current) return;
      setCheckError("");
      setCheck(next);
    } catch (e) { if (live.current) setCheckError(errorText(e)); }
  };

  // One xterm for the panel's lifetime; it shows the session's recent output and forwards keystrokes.
  useEffect(() => {
    live.current = true;
    const term = new Terminal({ fontFamily: "D2Coding, ui-monospace, Menlo, monospace", fontSize: 13, cursorBlink: true, scrollback: 5000, convertEol: false, theme: { background: "#14181c" } });
    const addon = new FitAddon();
    term.loadAddon(addon);
    term.open(host.current!);
    terminal.current = term; fit.current = addon;
    try { addon.fit(); } catch { /* Not laid out yet. */ }
    const input = term.onData(data => bridge.writeAiTerminal(projectId, data));
    const resized = term.onResize(next => bridge.resizeAiTerminal(projectId, next));
    const observer = new ResizeObserver(() => { try { addon.fit(); } catch { /* Hidden. */ } });
    observer.observe(host.current!);
    const unsubscribe = bridge.onAiTerminalEvent(event => {
      if (event.projectId !== projectId || !live.current) return;
      if (event.type === "data") term.write(event.data);
      else if (event.type === "exit") setSession(current => current && { ...current, running: false });
      else if (sessionRef.current) void runCheck({ projectId, environmentId: sessionRef.current.environmentId });
    });
    void bridge.getAiTerminal(projectId).then(current => {
      if (!live.current) return;
      if (current) {
        // After a restart the output is gone (it was never saved); say what the black screen means.
        term.write(current.buffer || (current.running ? "" : `\x1b[90m이전 ${current.tool === "claude" ? "Claude" : "Codex"} 대화가 있습니다. 이어서 열기를 누르면 같은 대화를 다시 엽니다.\x1b[0m\r\n`));
        const { buffer: _buffer, saved: savedBefore, ...rest } = current;
        setSession(rest);
        setSaved(savedBefore ?? null);
        void runCheck({ projectId, environmentId: current.environmentId });
      }
      setLoading(false);
    }).catch(e => { if (live.current) { setError(errorText(e)); setLoading(false); } });
    return () => { live.current = false; unsubscribe(); input.dispose(); resized.dispose(); observer.disconnect(); term.dispose(); terminal.current = null; };
  }, [bridge, projectId]);

  // The screen is hidden until a session exists; once it shows, size it and take the keyboard,
  // so keys (Enter, Esc, arrows for the CLI's own questions) reach the CLI without a click first.
  useEffect(() => {
    if (!session?.running) return;
    const frame = requestAnimationFrame(() => {
      try { fit.current?.fit(); } catch { /* Hidden. */ }
      terminal.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [session?.running]);
  useEffect(() => { onBusy(pending !== null); }, [pending, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);

  const start = async (resume: boolean) => {
    if (pending) return;
    setPending("starting"); setError("");
    try {
      if (!resume) { terminal.current?.reset(); setCheck(null); setSaved(null); setSent(""); }
      const next = resume ? await bridge.resumeAiTerminal({ scope, size: size() }) : await bridge.startAiTerminal({ scope, size: size() });
      if (!live.current) return;
      const { buffer: _buffer, saved: _saved, ...rest } = next;
      setSession(rest);
    } catch (e) { if (live.current) setError(errorText(e)); }
    finally { if (live.current) setPending(null); }
  };
  const clear = async () => {
    if (pending || !session) return;
    if (check && !saved && !window.confirm("저장하지 않은 결과가 사라집니다. 초기화할까요?")) return;
    setPending("clearing"); setError("");
    try {
      await bridge.clearAiTerminal(projectId);
      if (!live.current) return;
      terminal.current?.reset();
      setSession(null); setCheck(null); setSaved(null); setSent("");
    } catch (e) { if (live.current) setError(errorText(e)); }
    finally { if (live.current) setPending(null); }
  };
  const sendProblems = (report: string) => {
    if (!session?.running) return;
    bridge.writeAiTerminal(projectId, paste(report));
    bridge.writeAiTerminal(projectId, "\r");
    setSent(check?.modifiedAt ?? "");
    terminal.current?.focus();
  };

  const openSaved = async () => {
    try {
      const first = saved?.scenarioId ? (await bridge.listScenarios(projectId)).find(item => item.id === saved.scenarioId) : undefined;
      if (live.current) onSaved(first);
    } catch (e) { if (live.current) setError(errorText(e)); }
  };
  const report = check ? problemReport(check.result) : "";
  const savedThis = saved && check && saved.modifiedAt === check.modifiedAt;
  // With a session the panel fills the page: the terminal on the left at full height, its result checks
  // on the right in their own scroll, so the page itself never scrolls.
  return <section className={`api-ai-terminal${session ? " is-active" : ""}`} aria-label="AI 터미널">
    <header className="api-ai-chat-heading">
      <div>
        <strong>{session ? `${session.tool === "claude" ? "Claude" : "Codex"} 대화` : "AI 대화"}</strong>
        {session && <small className="api-field-help">대화 환경 · {environmentName(session.environmentId)}{session.running ? "" : " · 종료됨"}</small>}
      </div>
      <div className="api-ai-chat-heading-actions">
        {toolChoice?.(session?.tool)}
        {session && <button type="button" className={`api-ai-result-toggle${!sideOpen && unsaved ? " has-pending" : ""}`} aria-expanded={sideOpen}
          title={!sideOpen && unsaved ? "저장하지 않은 결과가 있습니다" : undefined} onClick={() => setSideOpen(!sideOpen)}>
          {sideOpen ? "결과 닫기" : check ? "결과 열기" : "결과 칸 열기"}{!sideOpen && unsaved && <span className="api-ai-result-badge">저장 전</span>}
        </button>}
        {session && !session.running && <button type="button" className="api-primary" disabled={pending !== null || differentEnvironment} title={differentEnvironment ? "대화를 시작한 환경으로 바꾸거나 대화를 초기화하세요" : undefined} onClick={() => void start(true)}>{pending === "starting" ? "여는 중…" : "이어서 열기"}</button>}
        {session
          ? <button type="button" disabled={pending !== null} onClick={() => void clear()}>{pending === "clearing" ? "초기화하는 중…" : "대화 초기화"}</button>
          : <button type="button" className="api-primary" disabled={loading || pending !== null || noSpec} title={noSpec ? "명세를 먼저 가져오세요" : undefined} onClick={() => void start(false)}>{loading ? "불러오는 중…" : pending === "starting" ? "시작하는 중…" : "대화 시작"}</button>}
      </div>
    </header>
    {!loading && !session && <div className="api-ai-chat-empty">
      <p><strong>대화 시작</strong>을 누르면 아래 터미널에서 {toolName}가 작성 가이드를 읽고 무엇을 테스트할지 묻습니다. AI가 결과를 저장하면 Checkly가 바로 검사해 아래에 저장 화면을 보여 줍니다.</p>
      {specNote && <div className="api-warning" role="note">{specNote}</div>}
    </div>}
    {differentEnvironment && session && <p className="api-warning" role="note">이 대화는 {environmentName(session.environmentId)}에서 시작했습니다. 검사와 저장도 {environmentName(session.environmentId)} 기준입니다. 현재 환경({environmentName(scope.environmentId)})으로 하려면 대화를 초기화하세요.</p>}
    {error && <p className="api-warning" role="alert">{error}</p>}
    <div className="api-ai-terminal-body">
    <div className={`api-ai-terminal-screen${session ? "" : " is-idle"}`} ref={host} aria-label="AI 터미널 화면" onMouseDown={() => terminal.current?.focus()} />
    {session && sideOpen && <aside className="api-ai-terminal-side" aria-label="AI 결과">
    {!check && !checkError && <div className="api-ai-terminal-waiting">
      <p>AI가 결과 파일을 저장하면 여기서 바로 검사하고 저장할 항목을 고를 수 있습니다.</p>
      {session.running && <p className="api-field-help">처음 열 때 폴더 신뢰 질문이 나오면 Checkly 전용 폴더이니 &lsquo;Yes, I trust this folder&rsquo;를 고르세요.</p>}
    </div>}
    {checkError && <p className="api-warning" role="alert">결과를 검사하지 못했습니다: {checkError}</p>}
    {check && <section className="api-ai-terminal-result" aria-label="AI 결과 검사">
      <p className="api-field-help">AI가 {new Date(check.modifiedAt).toLocaleTimeString()}에 저장한 결과를 검사했습니다.</p>
      {savedThis
        ? <p className="api-ai-step-status" role="status">저장했습니다 · <button type="button" className="api-issue-step-link" onClick={() => void openSaved()}>시나리오 보기</button></p>
        : <AiResultReview key={check.modifiedAt} result={check.result} scope={sessionScope} bridge={bridge} onBusy={onBusy}
          onSaved={first => {
            onBusy(false);
            const next = { modifiedAt: check.modifiedAt, ...(first ? { scenarioId: first.id } : {}) };
            setSaved(next);
            void bridge.markAiTerminalResultSaved(projectId, next).catch(() => undefined);
            // The AI reads the saved scenarios from the state file.
            void bridge.refreshAiTerminalFiles(sessionScope).catch(() => undefined);
          }}
          notes={report && <div className="api-ai-author-notes">검사에서 문제가 나왔습니다. AI에 보내면 고쳐서 같은 파일에 다시 저장합니다. 그대로 저장하면 초안이 됩니다.
            <div className="api-actions"><button type="button" disabled={!session?.running || sent === check.modifiedAt} onClick={() => sendProblems(report)}>{sent === check.modifiedAt ? "AI에 보냈습니다" : "문제를 AI에 보내기"}</button></div>
          </div>} />}
    </section>}
    </aside>}
    </div>
  </section>;
}
