import { useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui/Button";
import { PageLayout } from "../../shared/ui/PageLayout";
import type { AiTcEnvironment, AiTcModel } from "../../app/hooks/useAiTc";
// 이전 4단 화면(디자인: Checkly AI TC v2). 대화 패널 디자인으로 바꾸며 렌더링을 멈췄다.
// 새 디자인에 아직 없는 기능은 이 파일들과 각 새 컴포넌트의 "디자인 미반영" 주석을 참고한다.
// import { ImportView } from "./ImportView";
// import { PrepView } from "./PrepView";
// import { RunView } from "./RunView";
// import { ResultView } from "./ResultView";
import { BrowserStage, type Control } from "./BrowserStage";
import { ChatPanel, SCREENS, stepMessage, type ChatContext, type ChatMessage } from "./ChatPanel";
import { EnvPicker } from "./EnvPicker";
import { ImportTable } from "./ImportTable";
import { PrepTable } from "./PrepTable";
import { ProcessBar } from "./ProcessBar";
import { ResultTable } from "./ResultTable";
import { RunListPanel } from "./RunListPanel";

type Pane = "chat" | "list" | "";

/** Excel TC를 가져와 AI가 브라우저를 직접 조작해 검증하는 화면. 디자인: Checkly AI TC 대화 패널(시안 4a) — 왼쪽 대화로 진행, 오른쪽은 단계별 작업 영역. */
export const AiTcPage = ({ model, environment }: { model: AiTcModel; environment: AiTcEnvironment | null }) => {
  const { screen, run, workbook } = model;
  const step = SCREENS.indexOf(screen);
  const [pane, setPane] = useState<Pane>("chat");
  const [control, setControl] = useState<Control>("ai");
  const [history, setHistory] = useState<Array<{ message: ChatMessage } | { reply: string }>>([]);
  const previousWait = useRef("");
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // 사용자 대기가 끝나거나 바뀌면 AI 제어로 되돌린다.
  useEffect(() => { setControl("ai"); }, [run?.runId, run?.status, run?.wait?.kind, run?.wait?.title]);
  useEffect(() => { setHistory([]); setDraft(""); previousWait.current = ""; }, [run?.runId]);
  useEffect(() => {
    if (!model.live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [model.live]);

  const canReply = screen === "run" && run?.status === "waiting" && run.wait?.kind !== "confirm";
  const giveBack = () => {
    const text = draft.trim();
    if (text) setHistory(current => [...current, { reply: text }]);
    setDraft("");
    setControl("ai");
    model.decide("resume", text || undefined);
  };
  const ctx: ChatContext = {
    model, environment, control, settingsOpen, now,
    toggleSettings: () => setSettingsOpen(open => !open),
    takeover: () => setControl("user"),
    giveBack,
    skip: () => model.decide("block"),
  };
  const waitKey = run?.status === "waiting" && run.wait ? JSON.stringify([run.current, run.wait]) : "";
  useEffect(() => {
    if (waitKey && waitKey !== previousWait.current) {
      const message = stepMessage(2, ctx).at(-1);
      if (message) setHistory(current => [...current, { message }]);
    }
    previousWait.current = waitKey;
  }, [run?.runId, waitKey]);
  const shownPane: Pane = pane === "list" && screen !== "run" ? "" : pane;
  const last = stepMessage(step, ctx).at(-1);
  const awaiting = Boolean(last?.cta && !last.cta.locked);
  const tabs: Array<{ id: Exclude<Pane, "">; label: string }> = [{ id: "chat", label: "대화" }, ...(screen === "run" ? [{ id: "list" as const, label: "목록" }] : [])];

  const extra = (
    <>
      <span className="aitc-beta">BETA</span>
      <div className="aitcx-header">
        {workbook && (
          <div className="aitc-file-chip" title={`${workbook.fileName} · 원본 변경 없음`}>
            <span className="msi" aria-hidden="true">table_view</span>
            <span className="aitc-file-name">{workbook.fileName}</span>
          </div>
        )}
        <span className="aitc-divider" aria-hidden="true" />
        <EnvPicker model={model} environment={environment} />
      </div>
    </>
  );

  return (
    <PageLayout icon="smart_toy" title="AI TC 실행" extra={extra} className="aitc-page">
      {!model.api ? (
        <div className="aitc-empty"><h2>데스크톱 앱에서 사용할 수 있습니다</h2><p>AI TC 실행은 브라우저와 AI CLI를 제어하므로 Checkly 데스크톱 앱이 필요합니다.</p></div>
      ) : (
        <div className="aitcx-root">
          <ProcessBar model={model} step={step} control={control} now={now} />
          <div className={`aitcx-body${shownPane ? " open" : ""}`}>
            <div className="aitcx-pane-tabs" role="tablist" aria-label="왼쪽 패널">
              {tabs.map(tab => {
                const on = shownPane === tab.id;
                return (
                  <Button key={tab.id} role="tab" aria-selected={on} aria-label={`${tab.label} 패널 ${on ? "닫기" : "열기"}`} className={`aitcx-pane-tab${on ? " on" : ""}`} onClick={() => setPane(on ? "" : tab.id)}>
                    <span>{tab.label}</span>{tab.id === "chat" && !on && awaiting && <i aria-hidden="true" />}
                  </Button>
                );
              })}
            </div>
            <div className="aitcx-side">
              {shownPane === "chat" && (
                <ChatPanel ctx={ctx} step={step} history={history} draft={draft} setDraft={setDraft} canReply={canReply} onClose={() => setPane("")}
                  onSend={() => { if (canReply && draft.trim()) giveBack(); }} />
              )}
              {shownPane === "list" && <RunListPanel model={model} onClose={() => setPane("")} />}
            </div>
            <div className="aitcx-work">
              {screen === "import" ? <ImportTable model={model} />
                : screen === "prep" ? <PrepTable model={model} />
                  : screen === "run" ? <BrowserStage model={model} control={control} onTakeover={() => setControl("user")} onGiveBack={giveBack} onSkip={() => model.decide("block")} />
                    : <ResultTable key={run?.runId} model={model} />}
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
};
