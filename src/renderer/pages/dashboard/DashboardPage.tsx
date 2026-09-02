import {
  estimateDurationSeconds,
  formatClock,
  type RunRecord,
  type RunSummary,
} from "../../shared/model/scenario";

type Props = {
  history: RunRecord[];
  summary: RunSummary;
  onOpenRun: () => void;
  onOpenPicker: () => void;
  onOpenReport: (record: RunRecord) => void;
};

const TAPE_HEIGHTS = [20, 26, 30, 23, 28];

const durationOf = (record: RunRecord) =>
  record.scenarios.reduce(
    (total, item) => total + estimateDurationSeconds(item),
    0,
  );

export const DashboardPage = ({
  history,
  summary,
  onOpenRun,
  onOpenPicker,
  onOpenReport,
}: Props) => {
  const passRate = summary.total
    ? Math.round((summary.passed / summary.total) * 100)
    : 0;
  const durations = history.map(durationOf).sort((a, b) => a - b);
  const medianDur = durations.length
    ? durations[Math.floor(durations.length / 2)]
    : 0;

  return (
    <div className="dash">
      <div className="dash-title">
        <div className="dash-heading">실행 기록</div>
        <div className="dash-title-actions">
          <button className="button button-secondary" onClick={onOpenPicker}>
            시나리오 선택
          </button>
          <button className="button button-primary" onClick={onOpenRun}>
            전체 실행 <span className="dash-kbd">⌘R</span>
          </button>
        </div>
      </div>

      <div className="dash-stats">
        <div className="dash-stat">
          <div className="dash-stat-label">실행률</div>
          <div className="dash-stat-row">
            <div className="dash-stat-value">{passRate}%</div>
            <div className="dash-stat-sub">최근 {summary.total}회 실행</div>
          </div>
        </div>
        <div className="dash-stat-group">
          <div className="dash-stat">
            <div className="dash-stat-label">실패</div>
            <div className="dash-stat-value dash-stat-fail">
              {summary.failed}
            </div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-label">중간 소요</div>
            <div className="dash-stat-value">{formatClock(medianDur)}</div>
          </div>
        </div>
        <div className="dash-tape">
          {Array.from({ length: 28 }, (_, index) => {
            const record = history.length
              ? history[index % history.length]
              : undefined;
            const bad = record?.status === "failed";
            return (
              <div
                key={index}
                className={`dash-tape-bar${bad ? " failed" : ""}`}
                style={{ height: `${bad ? 12 : TAPE_HEIGHTS[index % TAPE_HEIGHTS.length]}px` }}
                title={record ? (bad ? "실패" : "통과") : "기록 없음"}
              />
            );
          })}
        </div>
      </div>

      <div className="dash-table-head">
        <div />
        <div>RUN</div>
        <div className="dash-col-right">PASS RATE</div>
        <div className="dash-col-right">TIME</div>
        <div className="dash-col-right">STARTED</div>
      </div>

      {history.length ? (
        history.map((record) => {
          const total = record.passed + record.failed;
          const rate = total ? Math.round((record.passed / total) * 100) : 0;
          return (
            <div
              className="dash-row"
              key={record.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenReport(record)}
            >
              <div>
                <div
                  className={`dash-dot${record.status === "failed" ? " failed" : ""}`}
                />
              </div>
              <div className="dash-row-name">
                <div className="dash-row-title">
                  {record.scenarios.length > 1
                    ? `전체 회귀 · ${record.scenarios.length}개 시나리오`
                    : (record.scenarios[0]?.title ?? "시나리오 실행")}
                </div>
                <div className="dash-row-subtitle">
                  {record.scenarios.map((scenario) => scenario.title).join(" · ")}
                </div>
              </div>
              <div
                className={`dash-col-right dash-mono${record.status === "failed" ? " failed" : ""}`}
              >
                {rate}%
              </div>
              <div className="dash-col-right dash-mono dash-muted">
                {formatClock(durationOf(record))}
              </div>
              <div className="dash-col-right dash-mono dash-muted">
                {new Date(record.ranAt).toLocaleTimeString("ko-KR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          );
        })
      ) : (
        <div className="dash-empty">
          <strong>아직 실행 기록이 없습니다.</strong>
          <p>시나리오를 선택해 실행하면 최근 5개의 기록이 여기에 저장됩니다.</p>
          <button className="button button-secondary" onClick={onOpenPicker}>
            시나리오 선택으로 이동
          </button>
        </div>
      )}
    </div>
  );
};
