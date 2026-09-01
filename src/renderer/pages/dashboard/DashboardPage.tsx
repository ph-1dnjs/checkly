import {
  estimateDurationSeconds,
  type RunRecord,
  type RunSummary,
  type Scenario,
} from "../../shared/model/scenario";

type Props = {
  history: RunRecord[];
  summary: RunSummary;
  onQuickStart: (scenarios: Scenario[]) => void;
  onOpenRun: () => void;
  onOpenLibrary: () => void;
  onOpenReport: (record: RunRecord) => void;
};

export const DashboardPage = ({
  history,
  summary,
  onQuickStart,
  onOpenRun,
  onOpenLibrary,
  onOpenReport,
}: Props) => (
  <>
    <div className="page-title">
      <div>
        <p className="eyebrow">DASHBOARD</p>
        <h1>안정적으로 운영되고 있습니다</h1>
      </div>
      <div className="dashboard-actions"><button className="button button-secondary" onClick={onOpenLibrary}>시나리오</button><button className="button button-primary" onClick={onOpenRun}>▶ 전체 실행</button></div>
    </div>
    <section className="dashboard-overview" aria-label="실행 요약">
      <div className="dashboard-rate">
        <strong>{summary.total ? Math.round((summary.passed / summary.total) * 100) : 0}<small>%</small></strong>
        {summary.total > 0 && <span className="dashboard-change">▲ 최근 실행 기준</span>}
        <div className="run-history-tape" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => {
            const record = history[index % Math.max(history.length, 1)];
            return <i key={index} className={record?.status === "failed" ? "failed" : "passed"} />;
          })}
        </div>
      </div>
    </section>
    <section className="recent-runs">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">RECENT RUNS</p>
        </div>
        <span className="dashboard-history-link">전체 기록 →</span>
      </div>
      {history.length ? (
        <ol className="recent-run-list">
          {history.map((record) => (
            <li key={record.id} onClick={() => onOpenReport(record)} role="button" tabIndex={0}>
              <div
                className={
                  record.status === "passed"
                    ? "run-result passed"
                    : "run-result failed"
                }
              >
                {record.status === "passed" ? "✓" : "!"}
              </div>
              <div className="recent-run-info">
                <strong>{record.scenarios.length > 1 ? `전체 회귀 · ${record.scenarios.length}개 시나리오` : record.scenarios[0]?.title ?? "시나리오 실행"}</strong>
                <span>{record.scenarios.map((scenario) => scenario.title).join(" · ")}</span>
              </div>
              <div className="recent-run-meta">
                <span>{Math.round((record.passed / Math.max(record.passed + record.failed, 1)) * 100)}%</span>
                <span>{formatSeconds(record.scenarios.reduce((total, item) => total + estimateDurationSeconds(item), 0))}</span>
                <time dateTime={record.ranAt}>{new Date(record.ranAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</time>
              </div>
              <div className="recent-run-actions">
                <button
                  className="button button-secondary"
                  onClick={(event) => {
                    event.stopPropagation();
                    onQuickStart(record.scenarios);
                  }}
                >
                  다시 실행
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty-runs">
          <strong>아직 실행 기록이 없습니다.</strong>
          <p>
            실행 탭에서 시나리오를 시작하면 최근 5개의 기록이 여기에 저장됩니다.
          </p>
          <button className="button button-secondary" onClick={onOpenRun}>
            실행 화면으로 이동
          </button>
        </div>
      )}
    </section>
  </>
);

const formatSeconds = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
