import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { YamlCode } from "../../../../entities/api-testing";
import { AiResultReview } from "./AiResultReview";
import type { ApiAiChat, ApiAiChatMessage, ApiAiChatSummary, ApiBackendFolders, ApiEnvironmentScope, ApiProject, ApiTestingBridge, SavedApiScenario } from "../../../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");
const modelSuggestions = ["sonnet", "opus", "haiku"];

/** Answer text with ```yaml blocks shown as code. */
function MessageText({ text }: { text: string }) {
  const parts = text.split(/```(?:ya?ml)?[ \t]*\r?\n([\s\S]*?)```/g);
  return <>{parts.map((part, index) => index % 2
    ? <YamlCode key={index} source={part} />
    : part.trim() && <p key={index} className="api-ai-chat-text">{part.trim()}</p>)}</>;
}

/** Backend folders per server on this PC; several per server, saved as soon as they change. */
function BackendFolders({ project, bridge, disabled }: { project: ApiProject; bridge: ApiTestingBridge; disabled: boolean }) {
  const [folders, setFolders] = useState<ApiBackendFolders>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  useEffect(() => { void bridge.getBackendFolders(project.id).then(setFolders).catch(e => setError(errorText(e))); }, [project.id]);
  const save = async (next: ApiBackendFolders) => {
    setError("");
    try { setFolders(await bridge.saveBackendFolders(project.id, next)); } catch (e) { setError(errorText(e)); }
  };
  const add = (serverId: string, paths: string[]) => paths.length && void save({ ...folders, [serverId]: [...(folders[serverId] ?? []), ...paths] });
  return <section className="api-ai-chat-folders" aria-label="백엔드 코드 폴더">
    <header><strong>백엔드 코드 폴더</strong><small>AI가 읽기만 합니다. 이 PC에만 저장되고 프로젝트 내보내기에는 들어가지 않습니다.</small></header>
    {project.servers.map(server => <div key={server.id} className="api-ai-chat-folder-server">
      <span>{server.name}</span>
      <ul>{(folders[server.id] ?? []).map(folder => <li key={folder}><code title={folder}>{folder}</code>
        <button type="button" disabled={disabled} aria-label={`${server.name} 폴더 ${folder} 제거`} onClick={() => void save({ ...folders, [server.id]: (folders[server.id] ?? []).filter(item => item !== folder) })}>제거</button></li>)}</ul>
      <div className="api-actions">
        <button type="button" disabled={disabled} onClick={() => void bridge.chooseDirectories().then(paths => add(server.id, paths)).catch(e => setError(errorText(e)))}>폴더 선택…</button>
        <input aria-label={`${server.name} 폴더 경로`} placeholder="또는 절대 경로 입력" value={drafts[server.id] ?? ""} disabled={disabled} onChange={e => setDrafts({ ...drafts, [server.id]: e.target.value })} />
        <button type="button" disabled={disabled || !drafts[server.id]?.trim()} onClick={() => { add(server.id, [drafts[server.id].trim()]); setDrafts({ ...drafts, [server.id]: "" }); }}>추가</button>
      </div>
    </div>)}
    {error && <p className="api-warning" role="alert">{error}</p>}
  </section>;
}

/**
 * Chat with Claude Code on this PC, one session per chat: the guide goes first, the AI asks
 * what to test and proposes a plan, writes YAML; Checkly checks it and sends problems back
 * on its own, then the result waits here to be saved.
 */
export function AiChatPanel({ project, scope, bridge, onBusy, onSaved, picker, picked, noSpec, specNote }: {
  project: ApiProject; scope: ApiEnvironmentScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onSaved: (first?: SavedApiScenario) => void;
  /** The API picker shown before starting; `picked` is its selection (empty = all). */
  picker: ReactNode; picked: string[]; noSpec: boolean; specNote: string;
}) {
  const [chats, setChats] = useState<ApiAiChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chat, setChat] = useState<ApiAiChat | null>(null);
  const [model, setModel] = useState("");
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  // The checked result saved from this chat: the chat stays open so the user can keep asking for changes.
  const [saved, setSaved] = useState<{ messageId: string; first?: SavedApiScenario } | null>(null);
  const live = useRef(true);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const refreshList = () => bridge.listAiChats(scope.projectId).then(next => { if (live.current) setChats(next); }).catch(() => undefined);
  useEffect(() => { void refreshList(); }, [scope.projectId]);
  useEffect(() => {
    if (!chatId) { setChat(null); return; }
    let stop = false;
    const load = async () => {
      const next = await bridge.getAiChat(scope.projectId, chatId).catch(() => null);
      if (stop || !live.current) return;
      setChat(next);
      if (next?.running) setTimeout(() => void load(), 600); else void refreshList();
    };
    void load();
    return () => { stop = true; };
  }, [chatId, chat?.messages.length, chat?.running === undefined]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [chat?.messages.length, chat?.running?.text.length]);

  const running = Boolean(chat?.running);
  const start = async () => {
    setStarting(true); setError("");
    try {
      const created = await bridge.startAiChat({ scope, ...(picked.length ? { operations: picked } : {}), ...(model.trim() ? { model: model.trim() } : {}) });
      if (!live.current) return;
      setChat(created); setChatId(created.id); void refreshList();
    } catch (e) { if (live.current) setError(errorText(e)); }
    finally { if (live.current) setStarting(false); }
  };
  const send = async () => {
    if (!chatId || !text.trim()) return;
    setError("");
    try {
      await bridge.sendAiChatMessage(scope.projectId, chatId, text);
      setText("");
      setChat(await bridge.getAiChat(scope.projectId, chatId));
    } catch (e) { setError(errorText(e)); }
  };
  // Only the newest checked result can be saved; older ones are history.
  const lastResult = chat && !running ? [...chat.messages].reverse().find(message => message.result) : undefined;
  const message = (item: ApiAiChatMessage) => <li key={item.id} className={`api-ai-chat-message is-${item.role}${item.error ? " is-error" : ""}`}>
    {item.role === "checkly" && <small className="api-ai-chat-from">Checkly</small>}
    {item.error ? <p className="api-warning" role="alert">{item.text}</p> : item.role === "assistant" ? <MessageText text={item.text} /> : <p className="api-ai-chat-text">{item.text}</p>}
    {item.tools && item.tools.length > 0 && <details className="api-ai-chat-tools"><summary>파일 {item.tools.length}번 확인</summary><ul>{item.tools.map((tool, index) => <li key={index}><code>{tool}</code></li>)}</ul></details>}
    {item.result && item !== lastResult && <small className="api-field-help">검사 결과 · 시나리오 {item.result.drafts.length}개{item.result.drafts.some(draft => draft.issues.length) ? " · 문제 있음" : ""}</small>}
    {item === lastResult && item.result && (saved?.messageId === item.id
      ? <p className="api-ai-step-status" role="status">저장했습니다 · <button type="button" className="api-issue-step-link" onClick={() => onSaved(saved.first)}>시나리오 보기</button></p>
      : <AiResultReview key={item.id} result={item.result} scope={scope} bridge={bridge} onBusy={onBusy} onSaved={first => { onBusy(false); setSaved({ messageId: item.id, ...(first ? { first } : {}) }); }} />)}
  </li>;

  return <div className="api-ai-chat">
    <aside aria-label="AI 대화 목록">
      <button type="button" className="api-primary" disabled={starting} onClick={() => { setChatId(null); setError(""); }}>+ 새 대화</button>
      <ul>{chats.map(item => <li key={item.id}><button type="button" className={item.id === chatId ? "selected" : undefined} onClick={() => { setChatId(item.id); setError(""); }}>
        <strong>{item.title}</strong><small>{item.running ? "답하는 중…" : new Date(item.updatedAt).toLocaleString()}</small>
      </button></li>)}</ul>
    </aside>
    <section className="api-ai-chat-main" aria-label="AI 대화">
      {!chatId ? <div className="api-ai-chat-setup">
        <p>시작하면 Checkly가 작성 가이드를 AI에 넘기고, AI가 무엇을 테스트할지 물어봅니다. 계획을 함께 정한 뒤 AI가 작성하면 Checkly가 검사하고, 문제가 있으면 AI에 다시 보내 고치게 합니다.</p>
        {specNote && <div className="api-warning" role="note">{specNote}</div>}
        <BackendFolders project={project} bridge={bridge} disabled={starting} />
        {picker}
        <label className="api-ai-chat-model">모델 (선택)<input list="api-ai-chat-models" value={model} placeholder="기본값" disabled={starting} onChange={e => setModel(e.target.value)} /><datalist id="api-ai-chat-models">{modelSuggestions.map(item => <option key={item} value={item} />)}</datalist></label>
        <div className="api-actions"><button type="button" className="api-primary" disabled={starting || noSpec} onClick={() => void start()}>{starting ? "가이드 전달 중…" : "AI와 시작"}</button></div>
      </div> : chat && <>
        <header className="api-ai-chat-heading"><strong>{chat.title}</strong>
          <button type="button" disabled={running} onClick={() => void bridge.deleteAiChat(scope.projectId, chat.id).then(() => { setChatId(null); void refreshList(); }).catch(e => setError(errorText(e)))}>대화 삭제</button>
        </header>
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
          <textarea aria-label="AI에게 보낼 메시지" rows={3} value={text} disabled={running} placeholder={running ? "AI가 답하는 중입니다" : "답하거나 수정할 내용을 적으세요 (Enter 보내기, Shift+Enter 줄바꿈)"}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
          <div className="api-actions">
            {running ? <button type="button" onClick={() => void bridge.cancelAiChat(scope.projectId, chat.id)}>중단</button>
              : <button type="submit" className="api-primary" disabled={!text.trim()}>보내기</button>}
          </div>
        </form>
      </>}
      {error && <p className="api-warning" role="alert">{error}</p>}
    </section>
  </div>;
}
