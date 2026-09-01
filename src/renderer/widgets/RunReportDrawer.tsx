import {
  estimateDurationSeconds,
  type RunRecord,
  type Scenario,
} from "../shared/model/scenario";

type Props = {
  record: RunRecord | null;
  onClose: () => void;
  onRerun: (scenarios: Scenario[]) => void;
};

export const RunReportDrawer = ({ record, onClose, onRerun }: Props) => {
  if (!record) return null;
  const total = record.passed + record.failed;
  const title =
    record.scenarios.length > 1
      ? `전체 회귀 · ${record.scenarios.length}개 시나리오`
      : (record.scenarios[0]?.title ?? "시나리오 실행");
  const duration = record.scenarios.reduce(
    (sum, item) => sum + estimateDurationSeconds(item),
    0,
  );

  return (
    <div className="run-report-drawer" role="dialog" aria-modal="true">
      <button
        className="run-report-drawer-backdrop"
        aria-label="리포트 닫기"
        onClick={onClose}
      />
      <div className="run-report-drawer-panel">
        <div className="run-report-drawer-head">
          <div>
            <p className="eyebrow">RUN REPORT</p>
            <strong>{title}</strong>
          </div>
          <button
            className="run-report-drawer-close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <div className="run-report-drawer-body">
          <div className="run-report-drawer-stats">
            <div>
              <div>PASS RATE</div>
              <strong style={{ color: record.failed ? "#C1543F" : "#33806C" }}>
                {total ? Math.round((record.passed / total) * 100) : 0}%
              </strong>
            </div>
            <div>
              <div>DURATION</div>
              <strong>{formatSeconds(duration)}</strong>
            </div>
            <div>
              <div>STEPS</div>
              <strong>{total}</strong>
            </div>
          </div>
          {record.results.map((result) => (
            <div className="run-report-scenario" key={result.scenario.id}>
              <div className="run-report-scenario-head">
                <div
                  className="run-report-chip"
                  style={{
                    background: result.status === "passed" ? "#E9F5F1" : "#F8DED7",
                    color: result.status === "passed" ? "#33806C" : "#C1543F",
                  }}
                >
                  {result.status === "passed" ? "✓" : "!"}
                </div>
                <strong>{result.scenario.title}</strong>
                <span>{formatSeconds(estimateDurationSeconds(result.scenario))}</span>
              </div>
              <div className="run-report-tape">
                {result.scenario.steps.map((step, index) => (
                  <i
                    key={step.id}
                    className={
                      result.status === "failed" &&
                      result.failedStepIndex !== undefined &&
                      index >= result.failedStepIndex
                        ? "failed"
                        : ""
                    }
                  />
                ))}
              </div>
              {result.status === "failed" && (
                <div className="run-report-fail">
                  <div>
                    STEP {(result.failedStepIndex ?? 0) + 1} FAILED
                  </div>
                  <div>{result.message}</div>
                </div>
              )}
            </div>
          ))}
          <div className="run-report-drawer-actions">
            <button
              className="button button-primary"
              onClick={() => onRerun(record.scenarios)}
            >
              다시 실행
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const formatSeconds = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
