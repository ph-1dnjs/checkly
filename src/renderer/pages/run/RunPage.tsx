import {
  actionText,
  estimateDurationSeconds,
  formatDuration,
  type RunProgress,
  type Scenario,
  type Step,
} from "../../shared/model/scenario";

type Props = {
  scenario: Scenario;
  scenarioCount: number;
  running: boolean;
  manual: Step | null;
  runLog: string[];
  runProgress: RunProgress;
  elapsedSeconds: number;
  runStartedAt: number | null;
  livePreview: boolean;
  previewImage: string;
  onRun: () => void;
  onImport: () => void;
  onCancel: () => void;
  onLivePreviewChange: (value: boolean) => void;
};

export const RunPage = ({
  scenario,
  scenarioCount,
  running,
  manual,
  runLog,
  runProgress,
  elapsedSeconds,
  runStartedAt,
  livePreview,
  previewImage,
  onRun,
  onImport,
  onCancel,
  onLivePreviewChange,
}: Props) => {
  const estimatedSeconds = estimateDurationSeconds(scenario);
  const progressPercent = runProgress.total
    ? Math.round((runProgress.current / runProgress.total) * 100)
    : 0;
  const estimatedCompletion = runStartedAt
    ? new Date(runStartedAt + estimatedSeconds * 1000).toLocaleTimeString(
        "ko-KR",
        { hour: "2-digit", minute: "2-digit" },
      )
    : null;
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">RUN CONSOLE</p>
          <h1>QA 실행</h1>
          <p>
            {running
              ? "브라우저 상태를 유지하며 실행 중입니다."
              : "실행할 시나리오를 선택하세요."}
          </p>
        </div>
        {running ? (
          <button className="button danger" onClick={onCancel}>
            실행 취소
          </button>
        ) : (
          <div className="run-header-actions">
            <button className="button button-secondary" onClick={onImport}>
              시나리오 불러오기
            </button>
            <button className="button button-primary" onClick={onRun}>
              ▶ 실행 시작
            </button>
          </div>
        )}
      </div>
      <div className="run-layout">
        <section className="run-main">
          <div className="run-state">
            <span className={running ? "pulse" : "check"}>
              {running ? "◌" : "✓"}
            </span>
            <div>
              <strong>
                {manual
                  ? "수동 입력 대기 중"
                  : running
                    ? "시나리오 실행 중"
                    : "실행 준비됨"}
              </strong>
              <p>
                {manual
                  ? `${manual.target} 값을 기다리고 있습니다.`
                  : `${scenarioCount}개 시나리오 · ${scenario.steps.length}개 단계`}
              </p>
            </div>
          </div>
          <section
            className="run-scenario-preview"
            aria-label="실행 시나리오 미리보기"
          >
            <div>
              <strong>{scenario.title}</strong>
              <span>{scenario.url}</span>
            </div>
            <ol>
              {scenario.steps.map((step) => (
                <li
                  key={step.id}
                  className={
                    running && step.id === String(runProgress.current)
                      ? "current"
                      : ""
                  }
                >
                  <b>{step.id}</b>
                  {actionText(step)}
                </li>
              ))}
            </ol>
          </section>
          <div className="run-timing">
            <span>
              진행 {runProgress.current}/{runProgress.total} · {progressPercent}
              %
            </span>
            <span>경과 {formatDuration(elapsedSeconds)}</span>
            <span>
              예상 {formatDuration(estimatedSeconds)}
              {estimatedCompletion ? ` · 완료 ${estimatedCompletion}` : ""}
            </span>
          </div>
          <div
            className="progress"
            aria-label={`실행 진행률 ${progressPercent}%`}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          {livePreview && (
            <section className="live-preview" aria-label="실시간 테스트 화면">
              <div>
                <strong>실시간 테스트 화면</strong>
                <span>
                  단계마다 캡처되어 실행 속도가 다소 느려질 수 있습니다.
                </span>
              </div>
              {previewImage ? (
                <img src={previewImage} alt="현재 테스트 실행 화면" />
              ) : (
                <p>첫 실행 화면을 기다리고 있습니다.</p>
              )}
            </section>
          )}
          <div className="log-box" aria-live="polite">
            {runLog.length ? (
              runLog.map((log, index) => (
                <p key={index}>
                  <time>{String(index + 9).padStart(2, "0")}:24</time>
                  {log}
                </p>
              ))
            ) : (
              <p className="muted">실행 로그가 여기에 표시됩니다.</p>
            )}
          </div>
        </section>
        <aside className="run-side">
          <h2>실행 설정</h2>
          <label>
            브라우저
            <select>
              <option>Chromium</option>
              <option>Firefox</option>
            </select>
          </label>
          <label>
            워커 수
            <select>
              <option>1</option>
            </select>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={livePreview}
              onChange={(event) => onLivePreviewChange(event.target.checked)}
              disabled={running}
            />{" "}
            실시간 테스트 화면 보기
          </label>
          <p className="run-setting-help">
            화면을 캡처해 보여주므로 실행 시간이 조금 늘어날 수 있습니다. 끄면
            백그라운드에서 더 빠르게 실행합니다.
          </p>
          <label className="toggle">
            <input type="checkbox" /> 실패 즉시 중단
          </label>
        </aside>
      </div>
    </>
  );
};
