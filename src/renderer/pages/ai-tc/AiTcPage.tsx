import { Button } from "../../shared/ui/Button";
import { PageLayout } from "../../shared/ui/PageLayout";
import type { AiTcEnvironment, AiTcModel, AiTcScreen } from "../../app/hooks/useAiTc";
import { ImportView } from "./ImportView";
import { PrepView } from "./PrepView";
import { RunView } from "./RunView";
import { ResultView } from "./ResultView";

const TABS: Array<{ id: AiTcScreen; label: string }> = [
  { id: "import", label: "가져오기" },
  { id: "prep", label: "준비" },
  { id: "run", label: "실행" },
  { id: "result", label: "결과" },
];

/** Excel TC를 가져와 AI가 브라우저를 직접 조작해 검증하는 화면. 가져오기 → 준비 → 실행 → 결과. */
export const AiTcPage = ({ model, environment }: { model: AiTcModel; environment: AiTcEnvironment | null }) => {
  const { screen, setScreen, run, workbook, notReady, progress, live } = model;
  const waiting = run?.status === "waiting";
  const tabs = (
    <div className="aitc-tabs" role="tablist" aria-label="AI TC 단계">
      {TABS.map((tab, index) => {
        const active = screen === tab.id;
        const disabled = (tab.id === "run" || tab.id === "result") && !run;
        const meta = tab.id === "prep" && notReady ? String(notReady) : tab.id === "run" && live && screen !== "run" ? `${progress.percent}%` : "";
        return (
          <Button key={tab.id} role="tab" aria-selected={active} disabled={disabled} className={`aitc-tab${active ? " active" : ""}`} onClick={() => setScreen(tab.id)}>
            <span className="aitc-tab-num">{String(index + 1).padStart(2, "0")}</span>
            <span>{tab.label}</span>
            {tab.id === "run" && live && <span className={`aitc-live${waiting ? " wait" : run?.status === "error" ? " error" : ""}`} aria-hidden="true" />}
            {meta && <span className={`aitc-tab-meta${tab.id === "prep" ? " wait" : ""}`}>{meta}</span>}
          </Button>
        );
      })}
    </div>
  );
  const extra = (
    <>
      {tabs}
      <div className="aitc-header-right">
        {workbook && (
          <div className="aitc-file-chip" title={`${workbook.fileName} · 원본 변경 없음`}>
            <span className="msi" aria-hidden="true">table_view</span>
            <span className="aitc-file-name">{workbook.fileName}</span>
            <span className="msi aitc-lock" aria-label="읽기 전용">lock</span>
          </div>
        )}
        <span className="aitc-divider" aria-hidden="true" />
        <Button className="aitc-env-chip" onClick={() => setScreen("prep")} title="실행 환경" disabled={live}>
          <span className="aitc-env-name">{model.endpointName || "로컬"}</span>
          <span className="aitc-env-value">{model.environmentName}</span>
          <span className="msi" aria-hidden="true">expand_more</span>
        </Button>
      </div>
    </>
  );
  return (
    <PageLayout icon="smart_toy" title="AI TC 실행" extra={extra} className="aitc-page">
      {!model.api ? (
        <div className="aitc-empty"><h2>데스크톱 앱에서 사용할 수 있습니다</h2><p>AI TC 실행은 브라우저와 AI CLI를 제어하므로 Checkly 데스크톱 앱이 필요합니다.</p></div>
      ) : screen === "import" ? <ImportView model={model} />
        : screen === "prep" ? <PrepView model={model} environment={environment} />
          : screen === "run" ? <RunView model={model} />
            : <ResultView model={model} />}
    </PageLayout>
  );
};
