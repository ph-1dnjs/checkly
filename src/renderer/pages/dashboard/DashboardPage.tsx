import type { RunRecord, RunSummary, Scenario } from "../../shared/model/scenario";

type Props = {
  history: RunRecord[];
  summary: RunSummary;
  onQuickStart: (scenarios: Scenario[]) => void;
  onOpenRun: () => void;
};

export const DashboardPage = ({
  history,
  summary,
  onQuickStart,
  onOpenRun,
}: Props) => (
  <>
    <div className="page-title">
      <div>
        <p className="eyebrow">DASHBOARD</p>
        <h1>대시보드</h1>
        <p>최근 실행 현황을 확인하고 이전 실행 묶음을 빠르게 다시 시작하세요.</p>
      </div>
    </div>
    <section className="run-summary" aria-label="실행 요약">
      <article>
        <span>평균 통과율</span>
        <strong>
          {summary.total
            ? Math.round((summary.passed / summary.total) * 100)
            : 0}
          %
        </strong>
        <small>통과 {summary.passed}회</small>
      </article>
      <article>
        <span>실패율</span>
        <strong>
          {summary.total
            ? Math.round((summary.failed / summary.total) * 100)
            : 0}
          %
        </strong>
        <small>실패 {summary.failed}회</small>
      </article>
      <article>
        <span>전체 실행 수</span>
        <strong>{summary.total}</strong>
        <small>누적 실행 기준</small>
      </article>
    </section>
    <section className="recent-runs">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">RECENT RUNS</p>
          <h2>이전 실행 기록</h2>
        </div>
        <span>최근 {history.length}/5</span>
      </div>
      {history.length ? (
        <ol className="recent-run-list">
          {history.map((record) => (
            <li key={record.id}>
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
                <strong>{record.scenarios[0]?.title ?? "시나리오 실행"}{record.scenarios.length > 1 ? ` 외 ${record.scenarios.length - 1}개` : ""}</strong>
                <span>{record.scenarios.map((scenario) => scenario.title).join(" · ")}</span>
                <small>
                  {record.scenarios.length}개 시나리오 · 성공 {record.passed} · 실패 {record.failed} ·{" "}
                  {new Date(record.ranAt).toLocaleString("ko-KR")}
                </small>
              </div>
              <div className="recent-run-actions">
                <button
                  className="button button-primary"
                  onClick={() => onQuickStart(record.scenarios)}
                >
                  전체 퀵 스타트
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
