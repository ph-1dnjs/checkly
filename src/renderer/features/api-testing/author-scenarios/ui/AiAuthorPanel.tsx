import { problemReport } from "../model/problem-report";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiPicker, type PickableOperation } from "./ApiPicker";
import { AiResultReview } from "./AiResultReview";
import { AiTerminalPanel } from "./AiTerminalPanel";
import { AiQuickPanel } from "./AiQuickPanel";
import { AiToolSettings } from "./AiToolSettings";
import { BackendFolderSettings } from "./BackendFolderSettings";
import { McpConnect } from "./McpConnect";
import { Icon } from "../../../../shared/ui/Icon";
import { aiToolNames, backendFolderCount, chatTool } from "../../../../entities/api-testing";
import type { ApiAiChatSettings, ApiAiChatStatus, ApiAiImportResult, ApiCatalog, ApiEnvironmentScope, ApiMcpStatus, ApiSpecSync, ApiProject, ApiTestingBridge, SavedApiScenario } from "../../../../../app/api-testing/shared/workspace";

import { Button } from "../../../../shared/ui/Button";
const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

/**
 * The user writes scenarios with their own AI (Claude Code, Codex…). Three ways, one tab each:
 * - 앱에서 AI와 대화: when a CLI is installed and backend folders are set (here, in this tab), the app runs
 *   the AI itself and the chat happens here.
 * - MCP로 연결: the user's own AI app connects to Checkly and reads specs, saves and runs scenarios itself.
 * - 가이드 복사: the user pastes the guide into their AI, which writes a result file that Checkly checks and saves.
 */
export function AiAuthorPanel({ project, scope, bridge, onBusy, onSaved, mcp, onOpenSpecs }: {
  project: ApiProject; scope: ApiEnvironmentScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onSaved: (first?: SavedApiScenario) => void;
  /** MCP connection state, kept by the page so the header shows it and it follows the environment. */
  mcp: { status: ApiMcpStatus; onStatus: (status: ApiMcpStatus) => void };
  onOpenSpecs?: () => void;
}) {
  // Every operation the AI could use, and the ones picked for it (empty = all).
  const [operations, setOperations] = useState<PickableOperation[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [specWarnings, setSpecWarnings] = useState<string[]>([]);
  const [catalogsLoaded, setCatalogsLoaded] = useState(false);
  // When each server's spec was last imported here, and from which URL (for 명세 새로고침 on this screen).
  const [specs, setSpecs] = useState<Array<{ serverId: string; name: string; importedAt?: string; sync: ApiSpecSync | null }>>([]);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [refreshingSpecs, setRefreshingSpecs] = useState(false);
  const [guide, setGuide] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ApiAiImportResult | null>(null);
  // A new check starts a fresh review (choices reset).
  const [resultKey, setResultKey] = useState(0);
  const [chatStatus, setChatStatus] = useState<ApiAiChatStatus | null>(null);
  const [chatSettings, setChatSettings] = useState<ApiAiChatSettings | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [checkingAi, setCheckingAi] = useState(true);
  const [statusRevision, setStatusRevision] = useState(0);
  // The chosen way, remembered per project on this PC; without one the chat opens when it is ready.
  const [way, setWay] = useState<AiWay | null>(() => readWay(project.id));
  // Inside the app: 바로 만들기 by default, the CLI's own terminal for those who want the conversation.
  const [style, setStyle] = useState<ChatStyle>(() => readStyle(project.id));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Which step the last message belongs to, so it shows next to the button that caused it.
  const [messageStep, setMessageStep] = useState<0 | 1 | 3>(3);
  const live = useRef(true);
  // Set on mount too: StrictMode (dev) runs the cleanup once before the real mount.
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    void Promise.all(project.servers.map(server => bridge.getCatalog({ ...scope, serverId: server.id }).catch(() => null)))
      .then(async catalogs => {
        const syncs = await Promise.all(project.servers.map(server => bridge.getSpecSync({ ...scope, serverId: server.id }).catch(() => null)));
        if (!live.current) return;
        setSpecs(project.servers.map((server, index) => ({ serverId: server.id, name: server.name, importedAt: catalogs[index]?.importedAt, sync: syncs[index] })));
        setSpecWarnings(specWarningsFor(project, catalogs));
        setCatalogsLoaded(true);
        setOperations(project.servers.flatMap((server, index) => (catalogs[index]?.operations ?? []).map(operation => ({
          id: `${server.id} ${operation.key}`, server: server.id, method: operation.method, path: operation.path, summary: operation.summary,
          tags: [...new Set([operation.tag, ...(operation.tags ?? [])].filter(Boolean))],
          ...(operation.warnings.length ? { unavailable: operation.warnings.join(" · ") } : {}),
        }))));
      });
  }, [catalogRevision]);
  const busy = checking || chatBusy || settingsBusy || reviewBusy || checkingAi || refreshingSpecs;
  useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  const chatActivity = useCallback((next: boolean) => { setChatBusy(next); if (next) onBusy(true); }, [onBusy]);
  useEffect(() => {
    let active = true;
    setCheckingAi(true);
    void bridge.getAiChatStatus(statusRevision > 0).catch((): ApiAiChatStatus => ({ tools: [], error: "AI 대화를 확인하지 못했습니다" }))
      .then(async status => {
        const settings = await bridge.getAiChatSettings(project.id).catch(() => ({ folders: {} }));
        if (live.current && active) { setChatSettings(settings); setChatStatus(status); setCheckingAi(false); }
      });
    return () => { active = false; };
  }, [bridge, project.id, statusRevision]);
  const tools = chatStatus?.tools ?? [];
  const tool = chatTool(chatSettings, tools);
  const chatReady = Boolean(tool) && backendFolderCount(chatSettings) > 0;
  // Without a remembered choice: the chat when it is ready, else MCP (no backend folders needed).
  const view: AiWay = way ?? (chatReady ? "chat" : "mcp");
  const choose = (next: AiWay) => { setWay(next); writeWay(project.id, next); };
  const chooseStyle = (next: ChatStyle) => { setStyle(next); writeStyle(project.id, next); };
  // No spec on any server: a guide would give the AI no APIs at all.
  const noSpec = catalogsLoaded && !operations.length;
  const guideRequest = () => ({ scope, ...(picked.length ? { operations: picked } : {}) });
  const act = async (task: () => Promise<void>, step: 0 | 1 | 3 = 3) => { setError(""); setMessage(""); setMessageStep(step); try { await task(); } catch (e) { if (live.current) setError(errorText(e)); } };

  const check = async (load?: () => Promise<string | null>) => {
    setChecking(true); setResult(null);
    await act(async () => {
      let text = answer;
      if (load) { const loaded = await load(); if (loaded === null || !live.current) return; text = loaded; setAnswer(loaded); }
      const next = await bridge.checkAiScenarios(scope, text);
      if (!live.current) return;
      setResult(next);
      setResultKey(key => key + 1);
    });
    if (live.current) setChecking(false);
  };
  const loadResult = () => check(async () => {
    const file = await bridge.readAiResult(scope);
    if (!file) { setError("아직 AI 결과가 없습니다. AI가 결과를 저장했는지 확인하세요."); return null; }
    setMessage(`${new Date(file.modifiedAt).toLocaleString()}에 저장된 결과를 불러왔습니다.`);
    return file.text;
  });

  // Fetches every server's spec again from its URL (saved docs account when there is one), like 명세 새로고침.
  const refreshSpecs = () => act(async () => {
    const targets = specs.filter(spec => spec.sync?.url);
    const needPassword = targets.filter(spec => spec.sync?.username && !spec.sync.hasSavedAccount);
    if (needPassword.length) throw new Error(`${needPassword.map(spec => spec.name).join(", ")} 명세는 문서 비밀번호가 필요합니다. API 문서 탭에서 새로고침하세요.`);
    setRefreshingSpecs(true);
    try {
      const failed: string[] = [];
      for (const spec of targets) {
        const url = spec.sync!.url!;
        try { await bridge.importSpec({ ...scope, serverId: spec.serverId }, { kind: "url", url, ...(spec.sync!.username ? { useSavedAuth: true } : {}) }); }
        catch { failed.push(spec.name); }
      }
      if (!live.current) return;
      setCatalogRevision(value => value + 1);
      if (failed.length) throw new Error(`${failed.join(", ")} 명세를 가져오지 못했습니다. 기존 명세를 그대로 씁니다. API 문서 탭에서 확인하세요.`);
      setMessage("명세를 새로 가져왔습니다.");
    } finally { if (live.current) setRefreshingSpecs(false); }
  }, 0);
  const oldestImport = specs.map(spec => spec.importedAt).filter((value): value is string => Boolean(value)).sort()[0];
  const canRefresh = specs.some(spec => spec.sync?.url);
  const problems = result ? problemReport(result) : "";
  const toolChoice = chatStatus && chatSettings && tools.length > 1 && <div className="api-ai-tool-row">
          <AiToolSettings projectId={project.id} bridge={bridge} status={chatStatus} settings={chatSettings} disabled={busy} onBusy={setSettingsBusy} onSaved={setChatSettings} />
          <Button variant="ghost" iconOnly className="api-icon-button api-ai-refresh" aria-label="AI 다시 확인" title="AI 다시 확인" disabled={busy} onClick={() => setStatusRevision(value => value + 1)}><Icon name="refresh" size={16} /></Button>
        </div>;
  // Switches the chat between 바로 만들기 and the CLI's terminal; it sits in the chat's own title row.
  const styleToggle = <Button variant="ghost" className="api-ai-style-toggle" disabled={busy} onClick={() => chooseStyle(style === "quick" ? "terminal" : "quick")}>{style === "quick" ? "터미널로 보기" : "간단히 보기"}</Button>;
  const specNote = noSpec ? "가져온 명세가 없어 AI에게 줄 API가 없습니다. API 문서 탭에서 명세를 가져오세요." : specWarnings.join(" · ");
  const usable = operations.filter(operation => !operation.unavailable).length;
  const unavailable = operations.length - usable;
  const status = (step: 1 | 3) => messageStep === step && <>
    {error && <p className="api-warning" role="alert">{error}</p>}
    {message && <p className="api-ai-step-status" role="status">{message}</p>}
  </>;
  return <section className="api-ai-author" aria-label="AI 시나리오 작성">
    {/* Two ways as tabs; the AI choice sits next to the chat's start button. */}
    {checkingAi ? <p role="status" className="api-field-help">설치된 AI를 확인하는 중…</p> : <div className="api-ai-author-heading">
      <div className="api-ai-mode" role="tablist" aria-label="작성 방식">
        <Button role="tab" aria-selected={view === "chat"} disabled={busy} onClick={() => choose("chat")}>앱에서 AI와 대화</Button>
        <Button role="tab" aria-selected={view === "mcp"} disabled={busy} onClick={() => choose("mcp")}>MCP로 연결</Button>
        <Button role="tab" aria-selected={view === "copy"} disabled={busy} onClick={() => choose("copy")}>가이드 복사</Button>
      </div>
      {/* AI works from the imported spec: show how old it is and refresh it here before writing. */}
      {oldestImport && <div className="api-ai-spec-freshness" title={specs.map(spec => `${spec.name} · ${spec.importedAt ? new Date(spec.importedAt).toLocaleString() : "명세 없음"}`).join("\n")}>
        <span>명세 갱신 · {relativeDay(oldestImport)}</span>
        {canRefresh && <Button variant="ghost" iconOnly className="api-icon-button" aria-label="명세 새로고침" title="명세 새로고침" disabled={busy} onClick={() => void refreshSpecs()}><Icon name="refresh" size={16} className={refreshingSpecs ? "is-spinning" : undefined} /></Button>}
      </div>}
    </div>}
    {!checkingAi && messageStep === 0 && <>{error && <p className="api-warning" role="alert">{error}</p>}{message && <p className="api-ai-step-status" role="status">{message}</p>}</>}
    {checkingAi ? null : view === "chat" ? <>
      {!chatReady ? <section className="api-ai-chat-requirements" aria-label="앱에서 AI와 대화 준비">
        <p>이 PC의 AI가 백엔드 코드를 읽으며 이 화면에서 함께 작성합니다. 아래 두 가지가 있어야 시작할 수 있습니다.</p>
        <ul className="api-ai-way-checks">
          <li className={tool ? "is-ok" : "is-missing"}>
            <span>AI</span>
            <strong title={tools.map(item => `${aiToolNames[item.tool]} ${item.version}`).join("\n") || undefined}>{tools.length ? tools.map(item => aiToolNames[item.tool]).join(" · ") : "없음"}</strong>
            <Button variant="ghost" iconOnly className="api-icon-button" aria-label="AI 다시 확인" title="AI 다시 확인" disabled={busy} onClick={() => setStatusRevision(value => value + 1)}><Icon name="refresh" size={16} /></Button>
          </li>
          <li className={backendFolderCount(chatSettings) ? "is-ok" : "is-missing"}>
            <span>백엔드 코드 폴더</span>
            <strong>{backendFolderCount(chatSettings) ? `${backendFolderCount(chatSettings)}개` : "없음"}</strong>
          </li>
        </ul>
        {!tools.length && <p className="api-field-help">{chatStatus?.error ?? "Claude Code나 Codex CLI를 설치한 뒤 다시 확인하세요"}</p>}
        {/* Folders can be set before the AI is installed. */}
        {chatSettings && <BackendFolderSettings project={project} settings={chatSettings} bridge={bridge} disabled={busy} onSaved={setChatSettings} />}
      </section> : style === "quick" ? <AiQuickPanel project={project} scope={scope} bridge={bridge} onBusy={chatActivity} onSaved={onSaved} onOpenSpecs={onOpenSpecs}
        toolChoice={toolChoice} styleToggle={styleToggle} noSpec={noSpec} specNote={specNote} /> : <AiTerminalPanel project={project} scope={scope} bridge={bridge} onBusy={chatActivity} onSaved={onSaved} toolName={aiToolNames[tool!]}
        toolChoice={toolChoice} styleToggle={styleToggle} noSpec={noSpec} specNote={specNote} />}
      {chatReady && chatSettings && <details className="api-ai-backend-folders-toggle"><summary>백엔드 코드 폴더 · {backendFolderCount(chatSettings)}개</summary>
        <BackendFolderSettings project={project} settings={chatSettings} bridge={bridge} disabled={busy} onSaved={setChatSettings} />
      </details>}
    </> : view === "mcp" ? <McpConnect project={project} environmentId={scope.environmentId} bridge={bridge} status={mcp.status} onStatus={mcp.onStatus} /> : <>
      <p className="api-field-help api-ai-way-intro">가이드를 AI에 붙여넣고, AI가 저장한 결과 파일을 불러와 저장합니다.</p>
      <ol className="api-ai-steps" aria-label="AI 작성 순서">
      <li>
        <header><strong>가이드 복사</strong><span>백엔드 프로젝트 폴더에서 Claude Code나 Codex를 열고 붙여넣습니다.</span></header>
        {noSpec
          ? <div className="api-warning" role="note"><strong>명세를 먼저 가져오세요</strong> 가져온 명세가 없어 AI에게 줄 API가 없습니다. API 문서 탭에서 명세를 가져오세요.</div>
          : specWarnings.length > 0 && <div className="api-warning" role="note"><strong>명세를 다시 가져오세요</strong><ul>{specWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>AI는 명세에 있는 API와 필드만 사용합니다. API 문서 탭에서 명세를 가져오거나 새로고침하세요.</div>}
        {operations.length > 0 && <details className="api-ai-author-tags"><summary>AI가 쓸 API (선택) · {picked.length ? `${picked.length}개 선택` : `전체 ${usable}개${unavailable ? ` (실행 미지원 ${unavailable}개 제외)` : ""}`}</summary>
          <ApiPicker operations={operations} servers={Object.fromEntries(project.servers.map(server => [server.id, server.name]))} picked={picked} disabled={busy} onChange={next => { setGuide(null); setPicked(next); }} />
        </details>}
        <div className="api-actions">
          <Button variant="primary" disabled={busy || noSpec} onClick={() => void act(async () => { await bridge.copyAiPrompt(guideRequest()); setMessage("가이드를 복사했습니다. AI에 붙여넣으세요."); }, 1)}>AI 가이드 복사</Button>
          <Button variant="secondary" aria-expanded={guide !== null} disabled={busy || noSpec} onClick={() => void act(async () => { if (guide !== null) { setGuide(null); return; } const text = await bridge.getAiPrompt(guideRequest()); if (live.current) setGuide(text); }, 1)}>{guide === null ? "가이드 보기" : "가이드 닫기"}</Button>
        </div>
        {status(1)}
        {guide !== null && <pre className="api-ai-author-guide" aria-label="AI 가이드 내용">{guide}</pre>}
      </li>
      <li>
        <header><strong>AI와 대화</strong><span>테스트할 흐름을 알려 주면 AI가 시나리오를 작성해 결과 파일로 저장합니다.</span></header>
      </li>
      <li>
        <header><strong>결과 불러오기</strong><span>검사 결과를 보고 저장할 시나리오를 고릅니다.</span></header>
        <div className="api-actions">
          <Button variant="primary" disabled={busy} onClick={() => void loadResult()}>{checking ? "검사 중…" : "AI 결과 불러오기"}</Button>
        </div>
        <details className="api-ai-author-paste"><summary>또는 YAML 직접 붙여넣기·파일 가져오기</summary>
          <textarea aria-label="AI가 만든 YAML" rows={10} value={answer} disabled={busy} placeholder="AI가 대화에 출력한 답이나 시나리오 YAML을 그대로 붙여넣으세요." onChange={e => { setAnswer(e.target.value); setResult(null); }} />
          <div className="api-actions">
            <Button variant="secondary" disabled={busy || !answer.trim()} onClick={() => void check()}>검사</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void act(async () => { const text = await bridge.readScenarioFile(); if (text !== null && live.current) { setAnswer(text); setResult(null); } })}>YAML 파일 가져오기</Button>
          </div>
        </details>
        {status(3)}
        {result && <AiResultReview key={resultKey} result={result} scope={scope} bridge={bridge} onBusy={setReviewBusy} onSaved={onSaved}
          notes={problems && <div className="api-ai-author-notes">검사에서 문제가 나왔습니다. 문제를 복사해 AI에 붙여넣고, AI가 고쳐 저장하면 다시 불러오세요. 그대로 저장하면 초안이 됩니다.
            <div className="api-actions"><Button variant="secondary" onClick={() => void act(async () => { await navigator.clipboard.writeText(problems); setMessage("문제를 복사했습니다. AI에 붙여넣으세요."); })}>문제 복사</Button></div>
          </div>} />}
      </li>
    </ol></>}
  </section>;
}

/** Text to paste back into the user's AI; empty when everything passed. */

type AiWay = "chat" | "mcp" | "copy";
const wayKey = (projectId: string) => `checkly.api-testing.ai-way.${projectId}`;
function readWay(projectId: string): AiWay | null {
  try { const value = localStorage.getItem(wayKey(projectId)); return value === "chat" || value === "mcp" || value === "copy" ? value : null; } catch { return null; }
}
function writeWay(projectId: string, value: AiWay | null) {
  try { if (value) localStorage.setItem(wayKey(projectId), value); else localStorage.removeItem(wayKey(projectId)); } catch { /* only a convenience */ }
}

type ChatStyle = "quick" | "terminal";
const styleKey = (projectId: string) => `checkly.api-testing.ai-style.${projectId}`;
function readStyle(projectId: string): ChatStyle {
  try { return localStorage.getItem(styleKey(projectId)) === "terminal" ? "terminal" : "quick"; } catch { return "quick"; }
}
function writeStyle(projectId: string, value: ChatStyle) {
  try { localStorage.setItem(styleKey(projectId), value); } catch { /* only a convenience */ }
}

const staleDays = 30;
/** Servers whose spec is missing, lacks the original document (schemas unresolved) or is old. */
function specWarningsFor(project: ApiProject, catalogs: Array<ApiCatalog | null>): string[] {
  return project.servers.flatMap((server, index) => {
    const catalog = catalogs[index];
    if (!catalog) return [`${server.name}: 가져온 명세가 없습니다.`];
    if (catalog.spec === undefined) return [`${server.name}: 예전 방식으로 저장된 명세라 요청·응답 구조를 AI에 전달하지 못합니다.`];
    const days = Math.floor((Date.now() - Date.parse(catalog.importedAt)) / 86_400_000);
    return days >= staleDays ? [`${server.name}: ${days}일 전에 가져온 명세입니다.`] : [];
  });
}

/** "오늘", "어제", "N일 전" — how old the imported spec is. */
function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "오늘" : days === 1 ? "어제" : `${days}일 전`;
}
