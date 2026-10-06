import { problemReport } from "../model/problem-report";
import { useEffect, useRef, useState } from "react";
import { ApiPicker, type PickableOperation } from "./ApiPicker";
import { AiResultReview } from "./AiResultReview";
import { AiChatPanel } from "./AiChatPanel";
import type { ApiAiChatStatus, ApiAiImportResult, ApiCatalog, ApiEnvironmentScope, ApiProject, ApiTestingBridge, SavedApiScenario } from "../../../../../app/api-testing/shared/workspace";

const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, "");

/**
 * The user writes scenarios with their own AI (Claude Code, Codex…) opened in the
 * backend project: Checkly hands over a guide, the AI asks what to test and writes a
 * result file, and Checkly checks it and saves the chosen scenarios and suite.
 */
export function AiAuthorPanel({ project, scope, bridge, onBusy, onSaved }: {
  project: ApiProject; scope: ApiEnvironmentScope; bridge: ApiTestingBridge; onBusy: (busy: boolean) => void; onSaved: (first?: SavedApiScenario) => void;
}) {
  // Every operation the AI could use, and the ones picked for it (empty = all).
  const [operations, setOperations] = useState<PickableOperation[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [specWarnings, setSpecWarnings] = useState<string[]>([]);
  const [catalogsLoaded, setCatalogsLoaded] = useState(false);
  const [guide, setGuide] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ApiAiImportResult | null>(null);
  // A new check starts a fresh review (choices reset).
  const [resultKey, setResultKey] = useState(0);
  const [mode, setMode] = useState<"chat" | "copy">("chat");
  const [chatStatus, setChatStatus] = useState<ApiAiChatStatus | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Which step the last message belongs to, so it shows next to the button that caused it.
  const [messageStep, setMessageStep] = useState<1 | 3>(3);
  const live = useRef(true);
  // Set on mount too: StrictMode (dev) runs the cleanup once before the real mount.
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    void Promise.all(project.servers.map(server => bridge.getCatalog({ ...scope, serverId: server.id }).catch(() => null)))
      .then(catalogs => {
        if (!live.current) return;
        setSpecWarnings(specWarningsFor(project, catalogs));
        setCatalogsLoaded(true);
        setOperations(project.servers.flatMap((server, index) => (catalogs[index]?.operations ?? []).map(operation => ({
          id: `${server.id} ${operation.key}`, server: server.id, method: operation.method, path: operation.path, summary: operation.summary,
          tags: [...new Set([operation.tag, ...(operation.tags ?? [])].filter(Boolean))],
          ...(operation.warnings.length ? { unavailable: operation.warnings.join(" · ") } : {}),
        }))));
      });
  }, []);
  const busy = checking;
  useEffect(() => { void bridge.getAiChatStatus().then(status => { if (live.current) { setChatStatus(status); if (!status.available) setMode("copy"); } }).catch(() => { if (live.current) { setChatStatus({ available: false, error: "AI 대화를 확인하지 못했습니다" }); setMode("copy"); } }); }, []);
  // No spec on any server: a guide would give the AI no APIs at all.
  const noSpec = catalogsLoaded && !operations.length;
  const guideRequest = () => ({ scope, ...(picked.length ? { operations: picked } : {}) });
  const act = async (task: () => Promise<void>, step: 1 | 3 = 3) => { setError(""); setMessage(""); setMessageStep(step); try { await task(); } catch (e) { if (live.current) setError(errorText(e)); } };

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

  const problems = result ? problemReport(result) : "";
  const usable = operations.filter(operation => !operation.unavailable).length;
  const unavailable = operations.length - usable;
  const status = (step: 1 | 3) => messageStep === step && <>
    {error && <p className="api-warning" role="alert">{error}</p>}
    {message && <p className="api-ai-step-status" role="status">{message}</p>}
  </>;
  return <section className="api-ai-author" aria-label="AI 시나리오 작성">
    <h2>AI 작성 도우미</h2>
    <div className="api-ai-mode" role="tablist" aria-label="AI 작성 방식">
      <button type="button" role="tab" aria-selected={mode === "chat"} disabled={!chatStatus?.available} title={chatStatus && !chatStatus.available ? chatStatus.error : undefined} onClick={() => setMode("chat")}>AI 대화</button>
      <button type="button" role="tab" aria-selected={mode === "copy"} onClick={() => setMode("copy")}>가이드 복사로 쓰기</button>
    </div>
    {chatStatus && !chatStatus.available && <p className="api-field-help">AI 대화를 쓸 수 없습니다: {chatStatus.error}</p>}
    {mode === "chat" && chatStatus?.available ? <AiChatPanel project={project} scope={scope} bridge={bridge} onBusy={onBusy} onSaved={onSaved}
      picker={operations.length > 0 && <details className="api-ai-author-tags"><summary>AI가 쓸 API (선택) · {picked.length ? `${picked.length}개 선택` : `전체 ${usable}개${unavailable ? ` (실행 미지원 ${unavailable}개 제외)` : ""}`}</summary>
        <ApiPicker operations={operations} servers={Object.fromEntries(project.servers.map(server => [server.id, server.name]))} picked={picked} disabled={busy} onChange={setPicked} />
      </details>}
      picked={picked} noSpec={noSpec} specNote={noSpec ? "가져온 명세가 없어 AI에게 줄 API가 없습니다. API 문서 탭에서 명세를 가져오세요." : specWarnings.join(" · ")} /> : <ol className="api-ai-steps" aria-label="AI 작성 순서">
      <li>
        <header><strong>가이드 복사</strong><span>백엔드 프로젝트 폴더에서 Claude Code나 Codex를 열고 붙여넣습니다.</span></header>
        {noSpec
          ? <div className="api-warning" role="note"><strong>명세를 먼저 가져오세요</strong> 가져온 명세가 없어 AI에게 줄 API가 없습니다. API 문서 탭에서 명세를 가져오세요.</div>
          : specWarnings.length > 0 && <div className="api-warning" role="note"><strong>명세를 다시 가져오세요</strong><ul>{specWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul>AI는 명세에 있는 API와 필드만 사용합니다. API 문서 탭에서 명세를 가져오거나 새로고침하세요.</div>}
        {operations.length > 0 && <details className="api-ai-author-tags"><summary>AI가 쓸 API (선택) · {picked.length ? `${picked.length}개 선택` : `전체 ${usable}개${unavailable ? ` (실행 미지원 ${unavailable}개 제외)` : ""}`}</summary>
          <ApiPicker operations={operations} servers={Object.fromEntries(project.servers.map(server => [server.id, server.name]))} picked={picked} disabled={busy} onChange={next => { setGuide(null); setPicked(next); }} />
        </details>}
        <div className="api-actions">
          <button type="button" className="api-primary" disabled={busy || noSpec} onClick={() => void act(async () => { await bridge.copyAiPrompt(guideRequest()); setMessage("가이드를 복사했습니다. AI에 붙여넣으세요."); }, 1)}>AI 가이드 복사</button>
          <button type="button" aria-expanded={guide !== null} disabled={busy || noSpec} onClick={() => void act(async () => { if (guide !== null) { setGuide(null); return; } const text = await bridge.getAiPrompt(guideRequest()); if (live.current) setGuide(text); }, 1)}>{guide === null ? "가이드 보기" : "가이드 닫기"}</button>
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
          <button type="button" className="api-primary" disabled={busy} onClick={() => void loadResult()}>{checking ? "검사 중…" : "AI 결과 불러오기"}</button>
        </div>
        <details className="api-ai-author-paste"><summary>또는 YAML 직접 붙여넣기·파일 가져오기</summary>
          <textarea aria-label="AI가 만든 YAML" rows={10} value={answer} disabled={busy} placeholder="AI가 대화에 출력한 답이나 시나리오 YAML을 그대로 붙여넣으세요." onChange={e => { setAnswer(e.target.value); setResult(null); }} />
          <div className="api-actions">
            <button type="button" disabled={busy || !answer.trim()} onClick={() => void check()}>검사</button>
            <button type="button" disabled={busy} onClick={() => void act(async () => { const text = await bridge.readScenarioFile(); if (text !== null && live.current) { setAnswer(text); setResult(null); } })}>YAML 파일 가져오기</button>
          </div>
        </details>
        {status(3)}
        {result && <AiResultReview key={resultKey} result={result} scope={scope} bridge={bridge} onBusy={onBusy} onSaved={onSaved}
          notes={problems && <div className="api-ai-author-notes">검사에서 문제가 나왔습니다. 문제를 복사해 AI에 붙여넣고, AI가 고쳐 저장하면 다시 불러오세요. 그대로 저장하면 초안이 됩니다.
            <div className="api-actions"><button type="button" onClick={() => void act(async () => { await navigator.clipboard.writeText(problems); setMessage("문제를 복사했습니다. AI에 붙여넣으세요."); })}>문제 복사</button></div>
          </div>} />}
      </li>
    </ol>}
  </section>;
}

/** Text to paste back into the user's AI; empty when everything passed. */

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
