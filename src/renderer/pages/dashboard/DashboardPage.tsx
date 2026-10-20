import { useEffect } from "react";
import { Button } from "../../shared/ui/Button";
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
  onOpenReport: (record: RunRecord) => void;
};

const TAPE_SIZE = 28;
const TAPE_MAX_HEIGHT = 34;
const TAPE_MIN_HEIGHT = 4;

/** 통과율(0~100)을 막대 높이(px)로 바꾼다. 0%여도 보이도록 최소 높이를 둔다. */
const tapeHeightOf = (rate: number) =>
  Math.max(TAPE_MIN_HEIGHT * 2, Math.round((rate / 100) * TAPE_MAX_HEIGHT));

const STATUS_LABEL: Record<RunRecord["status"], string> = {
  passed: "통과",
  failed: "실패",
  cancelled: "취소",
};

const passRateOf = (record: RunRecord) => {
  const total = record.passed + record.failed;
  return total ? Math.round((record.passed / total) * 100) : 0;
};

const durationOf = (record: RunRecord) =>
  record.results.every(result => result.elapsedSeconds !== undefined)
    ? record.results.reduce((total, result) => total + (result.elapsedSeconds ?? 0), 0)
    : record.scenarios.reduce(
    (total, item) => total + estimateDurationSeconds(item),
    0,
  );

export const DashboardPage = ({
  history,
  summary,
  onOpenRun,
  onOpenReport,
}: Props) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.code !== "KeyP"
      ) return;

      event.preventDefault();
      if (!event.repeat) onOpenRun();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenRun]);

  const passRate = summary.total
    ? Math.round((summary.passed / summary.total) * 100)
    : 0;
  const durations = history.map(durationOf).sort((a, b) => a - b);
  const medianDur = durations.length
    ? durations[Math.floor(durations.length / 2)]
    : 0;
  // 실행 1건당 막대 1개. history는 최신순이므로 최근 28건을 뒤집어 왼쪽(오래된 것) → 오른쪽(최신)으로 놓고, 빈 칸은 앞쪽에 채운다.
  const recent = history.slice(0, TAPE_SIZE).reverse();
  const tape: (RunRecord | undefined)[] = [
    ...Array<undefined>(TAPE_SIZE - recent.length).fill(undefined),
    ...recent,
  ];
  const tapePassCount = recent.filter((record) => record.status === "passed").length;
  const tapeFailCount = recent.filter((record) => record.status === "failed").length;

  return (
    <div className="dash">
      <div className="dash-title">
        <div className="dash-heading">대시보드</div>
        <div className="dash-title-actions">
          <Button variant="primary" onClick={onOpenRun}>
            실행 화면 열기 <span className="dash-kbd">⌘P</span>
          </Button>
        </div>
      </div>

      <div className="dash-stats">
        <div className="dash-stat">
          <div className="dash-stat-label">실행률</div>
          <div className="dash-stat-row">
            <div className="dash-stat-value">{passRate}%</div>
            <div className="dash-stat-sub">최근 {summary.total}회 실행</div>
          </div>
          <div className="dash-stat-progress">
            <i style={{ width: `${passRate}%` }} />
          </div>
        </div>
        <div className="dash-stat-group">
          <div className="dash-stat">
            <div className="dash-stat-label">성공</div>
            <div className="dash-stat-value dash-stat-pass">
              {summary.passed}
            </div>
          </div>
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
        <div className="dash-tape-cell">
          <div className="dash-tape-head">
            <span>최근 {TAPE_SIZE}회</span>
            <span className="dash-mono dash-muted">
              pass {tapePassCount} · fail {tapeFailCount}
            </span>
          </div>
          <div className="dash-tape">
            {tape.map((record, index) => {
              if (!record) {
                return (
                  <div
                    key={`empty-${index}`}
                    className="dash-tape-bar empty"
                    style={{ height: `${TAPE_MIN_HEIGHT}px` }}
                    title="기록 없음"
                  />
                );
              }
              // 전부 통과한 실행만 초록(passed), 하나라도 실패하면 빨강(failed), 취소는 회색. 높이는 시나리오 통과율.
              const rate = passRateOf(record);
              return (
                <div
                  key={record.id}
                  className={`dash-tape-bar ${record.status}`}
                  style={{ height: `${tapeHeightOf(rate)}px` }}
                  title={`${STATUS_LABEL[record.status]} · ${rate}% (${record.passed}/${record.passed + record.failed})`}
                />
              );
            })}
          </div>
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
          const rate = passRateOf(record);
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
                  className={`dash-dot ${record.status}`}
                />
              </div>
              <div className="dash-row-name">
                <div className="dash-row-title">
                  {record.scenarios.length > 1
                    ? `전체 회귀 · ${record.scenarios.length}개 시나리오`
                    : (record.scenarios[0]?.title ?? "시나리오 실행")}
                </div>
                <div className="dash-row-subtitle">
                  {record.status === "cancelled" ? "취소 · " : ""}{record.scenarios.map((scenario) => scenario.title).join(" · ")}
                </div>
              </div>
              <div
                className={`dash-col-right dash-mono ${record.status}`}
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
          <p>시나리오를 실행하면 최근 50개의 기록이 여기에 저장됩니다.</p>
          <Button variant="secondary" onClick={onOpenRun}>
            실행 화면으로 이동
          </Button>
        </div>
      )}
    </div>
  );
};
