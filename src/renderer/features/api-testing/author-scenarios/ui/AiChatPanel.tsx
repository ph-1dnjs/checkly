import { Fragment, useEffect, useRef, useState } from "react";
import { YamlCode } from "../../../../entities/api-testing";
import { AiResultReview } from "./AiResultReview";
import type { ApiAiChat, ApiAiChatMessage, ApiEnvironmentScope, ApiProject, ApiTestingBridge, SavedApiScenario } from "../../../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");
type ChatAction = "starting" | "resetting" | "sending" | "stopping" | "marking";

/** Answer text with ```yaml blocks shown as code. */
function MessageText({ text }: { text: string }) {
  const parts = text.split(/```(?:ya?ml)?[ \t]*\r?\n([\s\S]*?)```/g);
  return <>{parts.map((part, index) => index % 2
    ? <YamlCode key={index} source={part} />
    : part.trim() && <p key={index} className="api-ai-chat-text">{part.trim()}</p>)}</>;
}

/** One persistent conversation per project. Reset prepares a new session before replacing it. */
export function AiChatPanel({ project, scope, bridge, onBusy, onSaved, toolName, noSpec, specNote }: {
  project: ApiProject; scope: ApiEnvironmentScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onSaved: (first?: SavedApiScenario) => void;
  /** The AI a new session uses, e.g. "Claude Code". */
  toolName: string; noSpec: boolean; specNote: string;
}) {
  const [chat, setChat] = useState<ApiAiChat | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<ChatAction | null>(null);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  // Keep a successful scenario save visible even if recording its status fails.
  const [savedLocally, setSavedLocally] = useState<{ messageId: string; scenarioId?: string } | null>(null);
  const live = useRef(true);
  const action = useRef<ChatAction | null>(null);
  const savingNow = useRef(false);
  // Invalidates both polling and mutation responses when another request takes over.
  const generation = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current += 1; }; }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = ++generation.current;
    const load = async () => {
      try {
        const next = await bridge.getAiChat(scope.projectId);
        if (stopped || !live.current || current !== generation.current) return;
        setChat(next);
        setLoading(false);
        if (next?.running) timer = setTimeout(() => void load(), 600);
      } catch (e) {
        if (stopped || !live.current || current !== generation.current) return;
        setLoading(false);
        setError(errorText(e));
      }
    };
    void load();
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); };
  }, [bridge, scope.projectId, revision]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [chat?.messages.length, chat?.running?.text.length]);

  const running = Boolean(chat?.running);
  const busy = loading || running || pending !== null || saving;
  const differentEnvironment = Boolean(chat && chat.environmentId !== scope.environmentId);
  const environmentName = (id: string) => project.environments.find(environment => environment.id === id)?.name ?? id;
  const latestResult = chat ? [...chat.messages].reverse().find(item => item.result) : undefined;
  const lastResult = !running ? latestResult : undefined;
  const savedStatus = (item: ApiAiChatMessage) => item.saved ?? (savedLocally?.messageId === item.id ? savedLocally : undefined);
  // The page is locked only while a request or a save is in flight. An answer runs in the main
  // process and the chat is restored when the panel opens again, so the user may leave meanwhile.
  const lockPage = pending !== null || saving;
  useEffect(() => { onBusy(lockPage); }, [lockPage, onBusy]);
  useEffect(() => () => { onBusy(false); }, [onBusy]);

  const begin = (next: ChatAction) => {
    if (action.current || savingNow.current || loading || running) return null;
    action.current = next;
    setPending(next);
    onBusy(true);
    setError("");
    return ++generation.current;
  };
  const currentRequest = (current: number) => live.current && current === generation.current;
  const finish = (current: number) => {
    if (!currentRequest(current)) return;
    action.current = null;
    setPending(null);
    setRevision(value => value + 1);
  };
  const start = async (reset: boolean) => {
    if (noSpec || action.current || savingNow.current || loading || running) return;
    if (reset && latestResult && !savedStatus(latestResult) && !window.confirm("저장하지 않은 결과가 사라집니다. 초기화할까요?")) return;
    const current = begin(reset ? "resetting" : "starting");
    if (current === null) return;
    try {
      const next = reset && chat ? await bridge.resetAiChat({ scope }, chat.id) : await bridge.startAiChat({ scope });
      if (!currentRequest(current)) return;
      setChat(next);
      setText("");
      setSavedLocally(null);
    } catch (e) { if (currentRequest(current)) setError(errorText(e)); }
    finally { finish(current); }
  };
  const send = async () => {
    if (!chat || !text.trim() || differentEnvironment) return;
    const current = begin("sending");
    if (current === null) return;
    try {
      await bridge.sendAiChatMessage(scope.projectId, chat.id, text);
      if (!currentRequest(current)) return;
      setText("");
      const next = await bridge.getAiChat(scope.projectId);
      if (currentRequest(current)) setChat(next);
    } catch (e) { if (currentRequest(current)) setError(errorText(e)); }
    finally { finish(current); }
  };
  const stop = async () => {
    if (!chat || action.current || savingNow.current) return;
    action.current = "stopping";
    setPending("stopping");
    setError("");
    const current = ++generation.current;
    try { await bridge.cancelAiChat(scope.projectId, chat.id); }
    catch (e) { if (currentRequest(current)) setError(errorText(e)); }
    finally { finish(current); }
  };
  const resultBusy = (next: boolean) => {
    savingNow.current = next;
    if (!live.current) return;
    setSaving(next);
    if (next) onBusy(true);
  };
  const markSaved = async (item: ApiAiChatMessage, first?: SavedApiScenario) => {
    if (!chat) return;
    const current = ++generation.current;
    if (live.current) {
      setSavedLocally({ messageId: item.id, ...(first ? { scenarioId: first.id } : {}) });
      action.current = "marking";
      setPending("marking");
      setError("");
    }
    try {
      // A scenario save continues after switching screens; its marker must continue too.
      const next = await bridge.markAiChatResultSaved(scope.projectId, chat.id, item.id, first?.id);
      if (currentRequest(current)) { setChat(next); setSavedLocally(null); }
    } catch (e) {
      if (currentRequest(current)) setError(`시나리오는 저장했지만 대화의 저장 상태를 기록하지 못했습니다. ${errorText(e)}`);
    } finally { finish(current); }
  };
  const openSaved = async (item: ApiAiChatMessage) => {
    try {
      const id = savedStatus(item)?.scenarioId;
      const first = id ? (await bridge.listScenarios(scope.projectId)).find(scenario => scenario.id === id) : undefined;
      if (live.current) onSaved(first);
    } catch (e) { if (live.current) setError(errorText(e)); }
  };
  const message = (item: ApiAiChatMessage) => <li key={item.id} className={`api-ai-chat-message is-${item.role}${item.error ? " is-error" : ""}`}>
    {item.role === "checkly" && <small className="api-ai-chat-from">Checkly</small>}
    {item.error ? <p className="api-warning" role="alert">{item.text}</p> : item.role === "assistant" ? <MessageText text={item.text} /> : <p className="api-ai-chat-text">{item.text}</p>}
    {item.tools && item.tools.length > 0 && <details className="api-ai-chat-tools"><summary>파일 {item.tools.length}번 확인</summary><ul>{item.tools.map((tool, index) => <li key={index}><code>{tool}</code></li>)}</ul></details>}
    {item.result && item !== lastResult && <small className="api-field-help">검사 결과 · 시나리오 {item.result.drafts.length}개{item.result.drafts.some(draft => draft.issues.length) ? " · 문제 있음" : ""}</small>}
    {item === lastResult && item.result && (savedStatus(item)
      ? <p className="api-ai-step-status" role="status">저장했습니다 · <button type="button" className="api-issue-step-link" disabled={busy} onClick={() => void openSaved(item)}>시나리오 보기</button></p>
      : <AiResultReview key={`${chat!.id}:${item.id}`} result={item.result} scope={{ projectId: scope.projectId, environmentId: chat!.environmentId }} bridge={bridge}
        readOnly={differentEnvironment || pending !== null} onBusy={resultBusy} onSaved={first => { void markSaved(item, first); }} />)}
  </li>;

  return <div className="api-ai-chat">
    <section className="api-ai-chat-main" aria-label="AI 대화">
      <header className="api-ai-chat-heading">
        <div><strong>{chat?.title ?? "AI 대화"}</strong>{chat && <small className="api-field-help">대화 환경 · {environmentName(chat.environmentId)}</small>}</div>
        {chat
          ? <button type="button" disabled={busy || noSpec} title={noSpec ? "명세를 먼저 가져오세요" : undefined} onClick={() => void start(true)}>{pending === "resetting" ? "초기화하는 중…" : "대화 초기화"}</button>
          : <button type="button" className="api-primary" disabled={busy || noSpec} title={noSpec ? "명세를 먼저 가져오세요" : undefined} onClick={() => void start(false)}>{loading ? "불러오는 중…" : pending === "starting" ? "시작하는 중…" : "대화 시작"}</button>}
      </header>
      {loading ? <p className="api-field-help" role="status">대화를 불러오는 중…</p> : !chat ? <div className="api-ai-chat-empty">
        <p><strong>대화 시작</strong>을 누르면 {toolName}에 작성 가이드를 넘기고 바로 시작합니다. AI가 무엇을 테스트할지 먼저 묻고, 계획을 함께 정한 뒤 작성합니다. Checkly가 결과를 검사하고, 문제가 있으면 AI에 다시 보내 고치게 합니다.</p>
        {specNote && <div className="api-warning" role="note">{specNote}</div>}
      </div> : <>
        {differentEnvironment && <p className="api-warning" role="note">이 대화는 {environmentName(chat.environmentId)}에서 시작했습니다. 현재 환경({environmentName(scope.environmentId)})에서 이어가려면 대화를 초기화하세요. 기존 기록은 읽기 전용입니다.</p>}
        <ol className="api-ai-chat-messages">
          {chat.messages.map(item => <Fragment key={item.id}>{message(item)}</Fragment>)}
          {chat.running && <li className="api-ai-chat-message is-assistant is-running" role="status">
            {chat.running.phase === "checking" ? <p className="api-ai-chat-text">Checkly가 결과를 검사하는 중…</p> : <>
              {chat.running.text ? <MessageText text={chat.running.text} /> : <p className="api-ai-chat-text">AI가 생각하는 중…</p>}
              {chat.running.tools.length > 0 && <small className="api-field-help">확인 중: {chat.running.tools[chat.running.tools.length - 1]}</small>}
            </>}
          </li>}
        </ol>
        <div ref={bottom} />
        <form className="api-ai-chat-input" onSubmit={event => { event.preventDefault(); void send(); }}>
          <textarea aria-label="AI에게 보낼 메시지" rows={3} value={text} disabled={busy || differentEnvironment} placeholder={differentEnvironment ? "현재 환경에서 이어가려면 대화를 초기화하세요" : running ? "AI가 답하는 중입니다" : "답하거나 수정할 내용을 적으세요 (Enter 보내기, Shift+Enter 줄바꿈)"}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
          <div className="api-actions">
            {running ? <button type="button" disabled={pending !== null || saving} onClick={() => void stop()}>{pending === "stopping" ? "중단하는 중…" : "중단"}</button>
              : <button type="submit" className="api-primary" disabled={busy || differentEnvironment || !text.trim()}>{pending === "sending" ? "보내는 중…" : "보내기"}</button>}
          </div>
        </form>
      </>}
      {error && <p className="api-warning" role="alert">{error}</p>}
    </section>
  </div>;
}
